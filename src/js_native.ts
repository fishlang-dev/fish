// The C glue between Fish and the vendored JS engine, appended to the runtime's source for a
// program that calls the engine, so it reaches the runtime's own helpers.
//
// One runtime and context serve the whole program, made on first use. Every call into them holds
// fsh_js_lock, so tasks on any thread may use JS while JS never runs in parallel with itself. A
// JsValue is a counted box holding one JS value; the last release frees the value under the lock.
// The engine is torn down at exit only for the leak check, which runs after every value is dropped.
export const JS_NATIVE = String.raw`
#include "quickjs.h"

typedef struct {
  int64_t count;
  JSValue value;
} fsh_js;

// The lock is reentrant: a Fish callback JS calls may call into JS again.
static pthread_mutex_t fsh_js_lock;
static pthread_once_t fsh_js_once = PTHREAD_ONCE_INIT;
static JSRuntime *fsh_js_runtime = NULL;
static JSContext *fsh_js_context = NULL;

static void fsh_js_lock_init(void) {
  pthread_mutexattr_t reentrant;
  pthread_mutexattr_init(&reentrant);
  pthread_mutexattr_settype(&reentrant, PTHREAD_MUTEX_RECURSIVE);
  pthread_mutex_init(&fsh_js_lock, &reentrant);
  pthread_mutexattr_destroy(&reentrant);
}

static void fsh_js_end(void);
static void fsh_js_host(JSContext *cx);
__attribute__((constructor)) static void fsh_js_begin(void) {
  fsh_engine_end = fsh_js_end;
}

// How deep the thread holding the lock is in it: the engine's stack is measured from the first
// entry only, as a callback entering again is deeper on the same stack.
static int32_t fsh_js_depth = 0;
// Whether this thread is inside the engine already, as a callback JS runs is.
static _Thread_local int32_t fsh_js_mine = 0;
// Where the call into JS this thread is making was written, for a panic entering it.
static _Thread_local const char *fsh_js_site = NULL;

// Handles let go of under a Fish lock, freed once the engine is next entered.
static fsh_js **fsh_js_deferred = NULL;
static int64_t fsh_js_deferred_count = 0, fsh_js_deferred_room = 0;
static pthread_mutex_t fsh_js_deferred_lock = PTHREAD_MUTEX_INITIALIZER;

static JSContext *fsh_js_enter(void) {
  pthread_once(&fsh_js_once, fsh_js_lock_init);
  // A thread holding a Fish lock waits here while JS on another thread may run a callback
  // waiting for that lock, so neither would go on.
  if (fsh_locks_held > 0 && fsh_js_mine == 0) {
    const char *at = fsh_js_site ? fsh_js_site : "panicked in a call into JS:\n";
    const char *why = "called into JS while holding a Lock, which a callback JS runs may wait for; call the package before 'update' or after it\n";
    char *message = malloc(strlen(at) + strlen(why) + 1);
    if (!message) {
      fputs("out of memory\n", stderr);
      exit(101);
    }
    strcpy(message, at);
    strcat(message, why);
    fsh_rt_panic(message);
  }
  pthread_mutex_lock(&fsh_js_lock);
  fsh_js_mine++;
  if (!fsh_js_runtime) {
    fsh_js_runtime = JS_NewRuntime();
    fsh_js_context = JS_NewContext(fsh_js_runtime);
    fsh_js_host(fsh_js_context);
  }
  pthread_mutex_lock(&fsh_js_deferred_lock);
  for (int64_t i = 0; i < fsh_js_deferred_count; i++) {
    JS_FreeValueRT(fsh_js_runtime, fsh_js_deferred[i]->value);
    fsh_rt_free(fsh_js_deferred[i]);
  }
  fsh_js_deferred_count = 0;
  pthread_mutex_unlock(&fsh_js_deferred_lock);
  // The engine measures its stack from the thread that last entered it, and tasks move threads.
  if (fsh_js_depth++ == 0) JS_UpdateStackTop(fsh_js_runtime);
  return fsh_js_context;
}

// Entering for a call written at where, which a panic entering names.
static JSContext *fsh_js_enter_at(const char *where) {
  fsh_js_site = where;
  JSContext *cx = fsh_js_enter();
  fsh_js_site = NULL;
  return cx;
}

static void fsh_js_leave(void) {
  fsh_js_mine--;
  fsh_js_depth--;
  pthread_mutex_unlock(&fsh_js_lock);
}

static fsh_js *fsh_js_box(JSValue value) {
  fsh_js *b = fsh_rt_alloc(sizeof(fsh_js));
  b->count = 1;
  b->value = value;
  return b;
}

// A value is freed through the runtime, not the context, as a callback JS drops while the engine
// is torn down at exit lets go of what it holds after the context is gone.
void fsh_rt_js_release(fsh_js *b) {
  if (!b || __atomic_sub_fetch(&b->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  // Under a Fish lock, waiting for the engine could wait forever, so the value waits instead.
  if (fsh_locks_held > 0 && fsh_js_mine == 0) {
    pthread_mutex_lock(&fsh_js_deferred_lock);
    if (fsh_js_deferred_count == fsh_js_deferred_room) {
      fsh_js_deferred_room = fsh_js_deferred_room ? fsh_js_deferred_room * 2 : 8;
      fsh_js_deferred = realloc(fsh_js_deferred, fsh_js_deferred_room * sizeof(fsh_js *));
      if (!fsh_js_deferred) {
        fputs("out of memory\n", stderr);
        exit(101);
      }
    }
    fsh_js_deferred[fsh_js_deferred_count++] = b;
    pthread_mutex_unlock(&fsh_js_deferred_lock);
    return;
  }
  fsh_js_enter();
  JS_FreeValueRT(fsh_js_runtime, b->value);
  fsh_js_leave();
  fsh_rt_free(b);
}

// The same, inside the engine.
static void fsh_js_drop(JSContext *cx, fsh_js *b) {
  if (__atomic_sub_fetch(&b->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  JS_FreeValueRT(fsh_js_runtime, b->value);
  fsh_rt_free(b);
}

// Leaves the engine and panics at where with the exception pending in it, which no Fish code can
// catch yet.
static void fsh_js_throw(JSContext *cx, const char *where) {
  JSValue exception = JS_GetException(cx);
  const char *text = JS_ToCString(cx, exception);
  const char *shown = text ? text : "a value that can't be shown";
  size_t size = strlen(where) + strlen(shown) + 32;
  char *message = malloc(size);
  if (!message) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  snprintf(message, size, "%suncaught exception in JS: %s\n", where, shown);
  JS_FreeCString(cx, text);
  JS_FreeValue(cx, exception);
  fsh_js_leave();
  fsh_rt_panic(message);
}

// Whether typeof gives name for the value, or for "null", whether it is null.
int32_t fsh_rt_js_typeof(fsh_js *b, fsh_str *name) {
  if (name->length == 4 && memcmp(name->bytes, "null", 4) == 0) return JS_IsNull(b->value);
  JSContext *cx = fsh_js_enter();
  JSValue v = b->value;
  const char *found = JS_IsUndefined(v) ? "undefined" : JS_IsNull(v) ? "object" : JS_IsString(v) ? "string"
    : JS_IsNumber(v) ? "number" : JS_IsBool(v) ? "boolean" : JS_IsBigInt(v) ? "bigint" : JS_IsSymbol(v) ? "symbol"
    : JS_IsFunction(cx, v) ? "function" : "object";
  fsh_js_leave();
  return (int64_t)strlen(found) == name->length && memcmp(found, name->bytes, name->length) == 0;
}

// The value as a string, a number or a boolean, which typeof has said it is.
// ponytail: a lone surrogate comes out as its 3 bytes, not valid UTF-8; replace it with U+FFFD
// if a package hands one back
fsh_str *fsh_rt_js_string(fsh_js *b) {
  JSContext *cx = fsh_js_enter();
  size_t length;
  const char *bytes = JS_ToCStringLen(cx, &length, b->value);
  if (!bytes) fsh_js_throw(cx, "panicked while reading a string out of JS:\n");
  fsh_str *s = fsh_str_of(bytes, length);
  JS_FreeCString(cx, bytes);
  fsh_js_leave();
  return s;
}

double fsh_rt_js_number(fsh_js *b) {
  double d = 0;
  JSContext *cx = fsh_js_enter();
  JS_ToFloat64(cx, &d, b->value);
  fsh_js_leave();
  return d;
}

int32_t fsh_rt_js_boolean(fsh_js *b) {
  JSContext *cx = fsh_js_enter();
  int32_t yes = JS_ToBool(cx, b->value);
  fsh_js_leave();
  return yes;
}

// A property, an element, or whether there is a property, as JS reads them; reading one of
// undefined or null throws, as a getter may.
fsh_js *fsh_rt_js_get(fsh_js *b, fsh_str *key, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  JSAtom name = JS_NewAtomLen(cx, key->bytes, key->length);
  JSValue v = JS_GetProperty(cx, b->value, name);
  JS_FreeAtom(cx, name);
  if (JS_IsException(v)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(v);
}

fsh_js *fsh_rt_js_at(fsh_js *b, int64_t i, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  JSValue v = JS_GetPropertyInt64(cx, b->value, i);
  if (JS_IsException(v)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(v);
}

int32_t fsh_rt_js_has(fsh_js *b, fsh_str *key, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  if (!JS_IsObject(b->value)) {
    JS_ThrowTypeError(cx, "cannot use 'in' operator to search for a key in a value that isn't an object");
    fsh_js_throw(cx, where);
  }
  JSAtom name = JS_NewAtomLen(cx, key->bytes, key->length);
  int found = JS_HasProperty(cx, b->value, name);
  JS_FreeAtom(cx, name);
  if (found < 0) fsh_js_throw(cx, where);
  fsh_js_leave();
  return found;
}

// Runs a module's source, NUL-terminated, to its end, its top-level awaits included, and gives
// its namespace, inside the engine.
static JSValue fsh_js_run(JSContext *cx, const char *text, size_t length, const char *where) {
  JSValue compiled = JS_Eval(cx, text, length, "<module>", JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
  if (JS_IsException(compiled)) fsh_js_throw(cx, where);
  JSModuleDef *module = JS_VALUE_GET_PTR(compiled);
  JSValue finished = JS_EvalFunction(cx, compiled);
  if (JS_IsException(finished)) fsh_js_throw(cx, where);
  JSContext *ran;
  for (int done; (done = JS_ExecutePendingJob(fsh_js_runtime, &ran)) != 0;) {
    if (done < 0) {
      JS_FreeValue(cx, finished);
      fsh_js_throw(cx, where);
    }
  }
  JSPromiseStateEnum state = JS_PromiseState(cx, finished);
  if (state == JS_PROMISE_REJECTED) JS_Throw(cx, JS_PromiseResult(cx, finished));
  JS_FreeValue(cx, finished);
  if (state == JS_PROMISE_REJECTED) fsh_js_throw(cx, where);
  if (state == JS_PROMISE_PENDING) {
    JS_ThrowInternalError(cx, "the module awaits something that never settles");
    fsh_js_throw(cx, where);
  }
  return JS_GetModuleNamespace(cx, module);
}

// Runs a module's source and gives its default export.
fsh_js *fsh_rt_js_evaluate(fsh_str *source, const char *where) {
  // The engine reads source up to a NUL; this copy outlives a panic in it, uncounted.
  char *text = malloc(source->length + 1);
  if (!text) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  memcpy(text, source->bytes, source->length);
  text[source->length] = 0;
  JSContext *cx = fsh_js_enter();
  JSValue names = fsh_js_run(cx, text, source->length, where);
  free(text);
  JSValue exported = JS_GetPropertyStr(cx, names, "default");
  JS_FreeValue(cx, names);
  if (JS_IsException(exported)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(exported);
}

// The program's packages, bundled into one module, run on the first use of any of them.
static int32_t fsh_js_bundled = 0;
static JSValue fsh_js_packages;

// An export of the program's n-th package.
fsh_js *fsh_rt_js_export(const char *bundle, int64_t package, const char *name, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  if (!fsh_js_bundled) {
    fsh_js_packages = fsh_js_run(cx, bundle, strlen(bundle), where);
    fsh_js_bundled = 1;
  }
  char key[32];
  snprintf(key, sizeof key, "p%lld", (long long)package);
  JSValue names = JS_GetPropertyStr(cx, fsh_js_packages, key);
  JSValue v = JS_GetPropertyStr(cx, names, name);
  JS_FreeValue(cx, names);
  if (JS_IsException(v)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(v);
}

// What kind of value a JS value is, as a message says it.
static const char *fsh_js_kind(JSContext *cx, JSValue v) {
  return JS_IsUndefined(v) ? "undefined" : JS_IsNull(v) ? "null" : JS_IsString(v) ? "a string"
    : JS_IsNumber(v) ? "a number" : JS_IsBool(v) ? "a boolean" : JS_IsBigInt(v) ? "a bigint"
    : JS_IsSymbol(v) ? "a symbol" : JS_IsFunction(cx, v) ? "a function" : JS_IsArray(v) ? "an array" : "an object";
}

// Panics, leaving the engine, when a JS value isn't what its declaration says: what gave it, as
// "'f' from 'pkg' gave", and the declared type.
static void fsh_js_unexpected(JSContext *cx, const char *kind, const char *what, const char *declared, const char *where) {
  size_t size = strlen(where) + strlen(what) + strlen(kind) + strlen(declared) + 64;
  char *message = malloc(size);
  if (!message) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  snprintf(message, size, "%s%s %s, where its declaration says '%s'\n", where, what, kind, declared);
  fsh_js_leave();
  fsh_rt_panic(message);
}

// Panics, giving up the box, unless its value is what its declaration says.
static void fsh_js_expect(JSContext *cx, fsh_js *b, bool fits, const char *what, const char *declared, const char *where) {
  if (fits) return;
  JSValue v = JS_DupValue(cx, b->value);
  fsh_js_drop(cx, b);
  const char *kind = fsh_js_kind(cx, v);
  JS_FreeValue(cx, v);
  fsh_js_unexpected(cx, kind, what, declared, where);
}

// A JS value read as the string, number or boolean its declaration says it is, its box given up.
fsh_str *fsh_rt_js_as_string(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, JS_IsString(b->value), what, declared, where);
  size_t length;
  const char *bytes = JS_ToCStringLen(cx, &length, b->value);
  if (!bytes) fsh_js_throw(cx, where);
  fsh_str *s = fsh_str_of(bytes, length);
  JS_FreeCString(cx, bytes);
  fsh_js_drop(cx, b);
  fsh_js_leave();
  return s;
}

double fsh_rt_js_as_number(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, JS_IsNumber(b->value), what, declared, where);
  double d = 0;
  JS_ToFloat64(cx, &d, b->value);
  fsh_js_drop(cx, b);
  fsh_js_leave();
  return d;
}

int32_t fsh_rt_js_as_boolean(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, JS_IsBool(b->value), what, declared, where);
  int32_t yes = JS_ToBool(cx, b->value);
  fsh_js_drop(cx, b);
  fsh_js_leave();
  return yes;
}
// Fish values as new JS values, each in a box of its own; an empty one is undefined when
// undefined is set, and null otherwise.
fsh_js *fsh_rt_js_of_string(fsh_str *s) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_NewStringLen(cx, s->bytes, s->length);
  fsh_js_leave();
  return fsh_js_box(v);
}

fsh_js *fsh_rt_js_of_number(double d) {
  return fsh_js_box(JS_NewFloat64(NULL, d));
}

fsh_js *fsh_rt_js_of_boolean(int32_t yes) {
  return fsh_js_box(JS_NewBool(NULL, yes));
}

fsh_js *fsh_rt_js_of_empty(int32_t undefined) {
  return fsh_js_box(undefined ? JS_UNDEFINED : JS_NULL);
}

// Calls a JS function with self as this, or undefined when there is none, giving up every box
// it is given; the jobs the call queued run before it returns, as they would once JS's own call
// stack emptied.
fsh_js *fsh_rt_js_call(fsh_js *fn, fsh_js *self, int64_t argc, fsh_js **argv, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  JSValue args[argc > 0 ? argc : 1];
  for (int64_t i = 0; i < argc; i++) {
    args[i] = JS_DupValue(cx, argv[i]->value);
    fsh_js_drop(cx, argv[i]);
  }
  JSValue f = JS_DupValue(cx, fn->value);
  fsh_js_drop(cx, fn);
  JSValue me = self ? JS_DupValue(cx, self->value) : JS_UNDEFINED;
  if (self) fsh_js_drop(cx, self);
  JSValue result = JS_Call(cx, f, me, argc, args);
  JS_FreeValue(cx, f);
  JS_FreeValue(cx, me);
  for (int64_t i = 0; i < argc; i++) JS_FreeValue(cx, args[i]);
  if (JS_IsException(result)) fsh_js_throw(cx, where);
  JSContext *ran;
  for (int done; (done = JS_ExecutePendingJob(fsh_js_runtime, &ran)) != 0;) {
    if (done < 0) {
      JS_FreeValue(cx, result);
      fsh_js_throw(cx, where);
    }
  }
  fsh_js_leave();
  return fsh_js_box(result);
}

// Whether a JS value is of a kind a declared type has: 0 anything, 1 null or undefined, 2 a
// string, 3 a number, 4 a boolean, 5 the string text, 6 false, 7 true, 8 the number number, 9
// an object that isn't an array, 10 an array, 11 anything but undefined. Inside the engine.
static int32_t fsh_js_is(JSContext *cx, JSValue v, int32_t kind, fsh_str *text, double number) {
  switch (kind) {
    case 0: return 1;
    case 1: return JS_IsNull(v) || JS_IsUndefined(v);
    case 2: return JS_IsString(v);
    case 3: return JS_IsNumber(v);
    case 4: return JS_IsBool(v);
    case 6: return JS_IsBool(v) && !JS_VALUE_GET_BOOL(v);
    case 7: return JS_IsBool(v) && JS_VALUE_GET_BOOL(v);
    case 8: {
      double d = 0;
      return JS_IsNumber(v) && JS_ToFloat64(cx, &d, v) == 0 && d == number;
    }
    case 9: return JS_IsObject(v) && !JS_IsArray(v);
    case 10: return JS_IsArray(v);
    case 11: return !JS_IsUndefined(v);
  }
  if (!JS_IsString(v)) return 0;
  size_t length;
  const char *bytes = JS_ToCStringLen(cx, &length, v);
  int32_t same = bytes && (int64_t)length == text->length && memcmp(bytes, text->bytes, length) == 0;
  JS_FreeCString(cx, bytes);
  return same;
}

int32_t fsh_rt_js_is(fsh_js *b, int32_t kind, fsh_str *text, double number) {
  JSContext *cx = fsh_js_enter();
  int32_t yes = fsh_js_is(cx, b->value, kind, text, number);
  fsh_js_leave();
  return yes;
}

// The same, of an object's property; a property that throws as it is read isn't one.
int32_t fsh_rt_js_field_is(fsh_js *b, const char *name, int32_t kind, fsh_str *text, double number) {
  JSContext *cx = fsh_js_enter();
  int32_t yes = 0;
  if (JS_IsObject(b->value)) {
    JSValue v = JS_GetPropertyStr(cx, b->value, name);
    if (JS_IsException(v)) JS_FreeValue(cx, JS_GetException(cx));
    else yes = fsh_js_is(cx, v, kind, text, number);
    JS_FreeValue(cx, v);
  }
  fsh_js_leave();
  return yes;
}

// A JS number read as an integer type's value, panicking, giving up the box, unless it is a whole
// number from min up to, but not including, past.
double fsh_rt_js_as_integer(fsh_js *b, double min, double past, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  double d = 0;
  int whole = JS_IsNumber(b->value) && JS_ToFloat64(cx, &d, b->value) == 0 && d == trunc(d) && d >= min && d < past;
  fsh_js_expect(cx, b, whole, what, declared, where);
  fsh_js_drop(cx, b);
  fsh_js_leave();
  return d;
}

// A JS value none of its declaration's types took.
void fsh_rt_js_mismatch(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, false, what, declared, where);
}
// New JS arrays and objects, filled a part at a time, each part's box given up.
fsh_js *fsh_rt_js_array(void) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_NewArray(cx);
  fsh_js_leave();
  return fsh_js_box(v);
}

fsh_js *fsh_rt_js_object(void) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_NewObject(cx);
  fsh_js_leave();
  return fsh_js_box(v);
}

void fsh_rt_js_push(fsh_js *array, fsh_js *part) {
  JSContext *cx = fsh_js_enter();
  int64_t length = 0;
  JS_GetLength(cx, array->value, &length);
  JS_SetPropertyInt64(cx, array->value, length, JS_DupValue(cx, part->value));
  fsh_js_drop(cx, part);
  fsh_js_leave();
}

void fsh_rt_js_put(fsh_js *object, const char *name, fsh_js *part) {
  JSContext *cx = fsh_js_enter();
  JS_SetPropertyStr(cx, object->value, name, JS_DupValue(cx, part->value));
  fsh_js_drop(cx, part);
  fsh_js_leave();
}

// Panics, giving up the box, unless the value is an object, as a handle's declaration says.
void fsh_rt_js_object_is(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, JS_IsObject(b->value), what, declared, where);
  fsh_js_leave();
}

// An array's length, panicking, giving up the box, when the value isn't an array.
int64_t fsh_rt_js_length(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  fsh_js_expect(cx, b, JS_IsArray(b->value), what, declared, where);
  int64_t length = 0;
  if (JS_GetLength(cx, b->value, &length) < 0) fsh_js_throw(cx, where);
  fsh_js_leave();
  return length;
}
// Writes a property of a JS object, giving up the value's box.
void fsh_rt_js_set(fsh_js *object, fsh_str *key, fsh_js *part, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  JSAtom name = JS_NewAtomLen(cx, key->bytes, key->length);
  int done = JS_SetProperty(cx, object->value, name, JS_DupValue(cx, part->value));
  JS_FreeAtom(cx, name);
  fsh_js_drop(cx, part);
  if (done < 0) fsh_js_throw(cx, where);
  fsh_js_leave();
}

// new of a JS class, giving up its box and every argument's.
fsh_js *fsh_rt_js_new(fsh_js *made, int64_t argc, fsh_js **argv, const char *where) {
  JSContext *cx = fsh_js_enter_at(where);
  JSValue args[argc > 0 ? argc : 1];
  for (int64_t i = 0; i < argc; i++) {
    args[i] = JS_DupValue(cx, argv[i]->value);
    fsh_js_drop(cx, argv[i]);
  }
  JSValue c = JS_DupValue(cx, made->value);
  fsh_js_drop(cx, made);
  JSValue result = JS_CallConstructor(cx, c, argc, args);
  JS_FreeValue(cx, c);
  for (int64_t i = 0; i < argc; i++) JS_FreeValue(cx, args[i]);
  if (JS_IsException(result)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(result);
}
// A property, by name, or an element, by index when name is NULL, read for a test: anything that
// throws as it is read, or isn't there to read, is undefined.
fsh_js *fsh_rt_js_peek(fsh_js *b, const char *name, int64_t index) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_UNDEFINED;
  if (JS_IsObject(b->value)) {
    v = name ? JS_GetPropertyStr(cx, b->value, name) : JS_GetPropertyInt64(cx, b->value, index);
    if (JS_IsException(v)) {
      JS_FreeValue(cx, JS_GetException(cx));
      v = JS_UNDEFINED;
    }
  }
  fsh_js_leave();
  return fsh_js_box(v);
}

// An array's length for a test, 0 where it can't be read.
int64_t fsh_rt_js_count(fsh_js *b) {
  JSContext *cx = fsh_js_enter();
  int64_t length = 0;
  if (JS_GetLength(cx, b->value, &length) < 0) {
    JS_FreeValue(cx, JS_GetException(cx));
    length = 0;
  }
  fsh_js_leave();
  return length;
}
// Runs the jobs JS has queued, as it would once its own call stack emptied; one that throws is
// dropped, as nothing awaits it.
static void fsh_js_settle(JSContext *cx) {
  JSContext *ran;
  for (int done; (done = JS_ExecutePendingJob(fsh_js_runtime, &ran)) != 0;) {
    if (done < 0) JS_FreeValue(cx, JS_GetException(ran));
  }
}

// What a promise's settling runs: it wakes the task awaiting it. Each of the two functions holds
// the task until JS drops it, settled or never settled.
static JSValue fsh_js_woken(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv, int magic, void *task) {
  fsh_rt_wake(task);
  return JS_UNDEFINED;
}

static void fsh_js_unwoken(void *task) {
  fsh_task_release(task);
}

// Awaits a JS value: 1 with what a promise fulfilled with, or anything else as itself, in out; 5
// with what it rejected with; or 0 while it is pending, the task woken once it settles. waiting
// says the task already waits for it.
int32_t fsh_rt_js_await(fsh_js *b, int32_t *waiting, fsh_task *task, fsh_js **out) {
  JSContext *cx = fsh_js_enter();
  // A thenable that isn't a promise is adopted by one, as JS's await does.
  if (!*waiting && JS_PromiseState(cx, b->value) == JS_PROMISE_NOT_A_PROMISE && JS_IsObject(b->value)) {
    JSValue then = JS_GetPropertyStr(cx, b->value, "then");
    if (JS_IsException(then)) JS_FreeValue(cx, JS_GetException(cx));
    else if (JS_IsFunction(cx, then)) {
      JSValue settle[2];
      JSValue adopted = JS_NewPromiseCapability(cx, settle);
      JS_FreeValue(cx, JS_Call(cx, settle[0], JS_UNDEFINED, 1, &b->value));
      JS_FreeValue(cx, settle[0]);
      JS_FreeValue(cx, settle[1]);
      JS_FreeValue(cx, b->value);
      b->value = adopted;
    }
    JS_FreeValue(cx, then);
  }
  fsh_js_settle(cx);
  int32_t outcome = 0;
  switch (JS_PromiseState(cx, b->value)) {
    case JS_PROMISE_NOT_A_PROMISE:
      *out = fsh_js_box(JS_DupValue(cx, b->value));
      outcome = 1;
      break;
    case JS_PROMISE_FULFILLED:
      *out = fsh_js_box(JS_PromiseResult(cx, b->value));
      outcome = 1;
      break;
    case JS_PROMISE_REJECTED:
      *out = fsh_js_box(JS_PromiseResult(cx, b->value));
      outcome = 5;
      break;
    default:
      if (*waiting) break;
      *waiting = 1;
      __atomic_fetch_add(&task->refs, 2, __ATOMIC_RELAXED);
      JSValue handlers[2] = {
        JS_NewCClosure(cx, fsh_js_woken, "woken", fsh_js_unwoken, 1, 0, task),
        JS_NewCClosure(cx, fsh_js_woken, "woken", fsh_js_unwoken, 1, 0, task),
      };
      JSValue then = JS_GetPropertyStr(cx, b->value, "then");
      JS_FreeValue(cx, JS_Call(cx, then, b->value, 2, handlers));
      JS_FreeValue(cx, then);
      JS_FreeValue(cx, handlers[0]);
      JS_FreeValue(cx, handlers[1]);
  }
  fsh_js_leave();
  return outcome;
}

// The message a thrown JS value gives a JsError: its message property when it is a string, or
// the value as a string.
fsh_str *fsh_rt_js_message(fsh_js *b) {
  JSContext *cx = fsh_js_enter();
  JSValue message = JS_IsObject(b->value) ? JS_GetPropertyStr(cx, b->value, "message") : JS_UNDEFINED;
  if (JS_IsException(message)) {
    JS_FreeValue(cx, JS_GetException(cx));
    message = JS_UNDEFINED;
  }
  JSValue shown = JS_IsString(message) ? JS_DupValue(cx, message) : JS_ToString(cx, b->value);
  JS_FreeValue(cx, message);
  size_t length = 0;
  const char *bytes = JS_IsException(shown) ? NULL : JS_ToCStringLen(cx, &length, shown);
  if (!bytes) JS_FreeValue(cx, JS_GetException(cx));
  fsh_str *s = fsh_str_of(bytes ? bytes : "a value that can't be shown", bytes ? length : 26);
  JS_FreeCString(cx, bytes);
  JS_FreeValue(cx, shown);
  fsh_js_leave();
  return s;
}
// A Fish callback as a JS function: the stored callable's data and table, and the function
// codegen made for its type, which converts what JS gives it, calls it, and converts what it
// gives back; called with a count below zero, it drops the callable.
typedef fsh_js *(*fsh_js_trampoline)(void *data, void *table, int64_t argc, fsh_js **argv);
// Every callback JS holds is listed, so tearing the engine down drops each before JS frees it.
typedef struct fsh_js_callback {
  void *data;
  void *table;
  fsh_js_trampoline run;
  int32_t length;
  int32_t dropped;
  struct fsh_js_callback *prev, *next;
} fsh_js_callback;

static fsh_js_callback *fsh_js_callbacks = NULL;
// Set while the engine is torn down, when the records stay listed until the runtime is freed, as
// dropping one callable may free other callbacks' functions.
static int32_t fsh_js_tearing = 0;

// JS calling a Fish callback, with undefined for each parameter it left out.
static JSValue fsh_js_called(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv, int magic, void *opaque) {
  fsh_js_callback *c = opaque;
  fsh_js *boxes[c->length > 0 ? c->length : 1];
  for (int32_t i = 0; i < c->length; i++) boxes[i] = fsh_js_box(i < argc ? JS_DupValue(cx, argv[i]) : JS_UNDEFINED);
  fsh_js *gives = c->run(c->data, c->table, c->length, boxes);
  if (!gives) return JS_UNDEFINED;
  JSValue v = JS_DupValue(cx, gives->value);
  fsh_js_drop(cx, gives);
  return v;
}

// JS's garbage collector dropping the function, and with it the callable, unless the teardown
// dropped it first.
static void fsh_js_forget(void *opaque) {
  fsh_js_callback *c = opaque;
  if (!c->dropped) c->run(c->data, c->table, -1, NULL);
  c->dropped = 1;
  if (fsh_js_tearing) return;
  if (c->prev) c->prev->next = c->next;
  else fsh_js_callbacks = c->next;
  if (c->next) c->next->prev = c->prev;
  fsh_rt_free(c);
}

fsh_js *fsh_rt_js_function(void *data, void *table, fsh_js_trampoline run, int32_t length) {
  fsh_js_callback *c = fsh_rt_alloc(sizeof(fsh_js_callback));
  c->data = data;
  c->table = table;
  c->run = run;
  c->length = length;
  c->dropped = 0;
  JSContext *cx = fsh_js_enter();
  c->prev = NULL;
  c->next = fsh_js_callbacks;
  if (fsh_js_callbacks) fsh_js_callbacks->prev = c;
  fsh_js_callbacks = c;
  JSValue f = JS_NewCClosure(cx, fsh_js_called, "callback", fsh_js_forget, length, 0, c);
  fsh_js_leave();
  return fsh_js_box(f);
}
// Tears the engine down at exit, for the leak check: its finalizers drop the callbacks JS kept.
static void fsh_js_end(void) {
  if (!fsh_js_runtime) return;
  JSContext *cx = fsh_js_enter();
  // The callables JS still holds let go of what they hold while the engine still runs.
  fsh_js_tearing = 1;
  for (fsh_js_callback *c = fsh_js_callbacks; c; c = c->next) {
    if (c->dropped) continue;
    c->dropped = 1;
    c->run(c->data, c->table, -1, NULL);
  }
  if (fsh_js_bundled) JS_FreeValue(cx, fsh_js_packages);
  JS_FreeContext(cx);
  fsh_js_context = NULL;
  // What finalizers let go of while the collector removes cycles is collected by a later pass.
  JS_RunGC(fsh_js_runtime);
  JS_RunGC(fsh_js_runtime);
  JS_FreeRuntime(fsh_js_runtime);
  fsh_js_runtime = NULL;
  while (fsh_js_callbacks) {
    fsh_js_callback *next = fsh_js_callbacks->next;
    fsh_rt_free(fsh_js_callbacks);
    fsh_js_callbacks = next;
  }
  fsh_js_leave();
  free(fsh_js_deferred);
  fsh_js_deferred = NULL;
  fsh_js_deferred_room = 0;
}
// A new JS promise, its resolving function boxed at settle.
fsh_js *fsh_rt_js_promise(fsh_js **settle) {
  JSContext *cx = fsh_js_enter();
  JSValue functions[2];
  JSValue promise = JS_NewPromiseCapability(cx, functions);
  JS_FreeValue(cx, functions[1]);
  *settle = fsh_js_box(functions[0]);
  fsh_js_leave();
  return fsh_js_box(promise);
}

// Resolves a JS promise with a value, giving up both boxes, then runs what that queued.
void fsh_rt_js_settle(fsh_js *settle, fsh_js *value) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_DupValue(cx, value->value);
  JS_FreeValue(cx, JS_Call(cx, settle->value, JS_UNDEFINED, 1, &v));
  JS_FreeValue(cx, v);
  fsh_js_drop(cx, value);
  fsh_js_drop(cx, settle);
  fsh_js_settle(cx);
  fsh_js_leave();
}
// What the bundle's shims of Node's os and process call: Fish's own runtime, as host functions
// on a global __fish object made with the engine.
static JSValue fsh_js_text(JSContext *cx, const char *text) {
  return text ? JS_NewString(cx, text) : JS_UNDEFINED;
}

// A Uint8Array's bytes read as UTF-8, each bad sequence a U+FFFD, as Node's Buffer decodes.
static JSValue fsh_host_decode(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  size_t size = 0;
  const uint8_t *bytes = argc > 0 ? JS_GetUint8Array(cx, &size, argv[0]) : NULL;
  if (!bytes) return JS_EXCEPTION;
  return JS_NewStringLen(cx, (const char *)bytes, size);
}

static JSValue fsh_host_cwd(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return fsh_js_text(cx, fsh_rt_cwd());
}

static JSValue fsh_host_hostname(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return fsh_js_text(cx, fsh_rt_os_hostname());
}

static JSValue fsh_host_tmpdir(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return fsh_js_text(cx, fsh_rt_os_tmpdir());
}

static JSValue fsh_host_homedir(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return fsh_js_text(cx, fsh_rt_os_homedir());
}

static JSValue fsh_host_platform(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return fsh_js_text(cx, fsh_rt_os_platform());
}

static JSValue fsh_host_parallelism(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  return JS_NewInt64(cx, fsh_rt_os_parallelism());
}

static JSValue fsh_host_getenv(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  if (argc < 1 || !JS_IsString(argv[0])) return JS_UNDEFINED;
  const char *name = JS_ToCString(cx, argv[0]);
  JSValue v = name ? fsh_js_text(cx, fsh_rt_getenv(name)) : JS_UNDEFINED;
  JS_FreeCString(cx, name);
  return v;
}

static JSValue fsh_host_argv(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  JSValue all = JS_NewArray(cx);
  int64_t n = fsh_rt_argc();
  for (int64_t i = 0; i < n; i++) JS_SetPropertyInt64(cx, all, i, fsh_js_text(cx, fsh_rt_arg(i)));
  return all;
}

static JSValue fsh_host_exit(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv) {
  int64_t code = 0;
  if (argc > 0 && !JS_IsUndefined(argv[0])) JS_ToInt64(cx, &code, argv[0]);
  fsh_rt_exit(code);
  return JS_UNDEFINED;
}

// fs/promises' readFile and writeFile: a job on Fish's blocking pool, polled by a task of its
// own that settles the JS promise when the job is done, so JS isn't held while the file is read.
// Without the async runtime running, the file is read or written at once.
typedef struct {
  fsh_str *path;
  fsh_array bytes;
  fsh_file_job *job;
  JSValue settle[2];
  int32_t op;
  int32_t text;
} fsh_js_file;

// A file's failure as Node's fs gives it: an Error with its code, system call and path.
static JSValue fsh_js_file_error(JSContext *cx, fsh_str **parts) {
  JSValue error = JS_NewError(cx);
  const char *names[] = {"message", "code", "syscall", "path"};
  for (int i = 0; i < 4; i++) {
    if (!parts[i]) continue;
    JS_SetPropertyStr(cx, error, names[i], JS_NewStringLen(cx, parts[i]->bytes, parts[i]->length));
    fsh_rt_str_release(parts[i]);
  }
  return error;
}

// Settles the promise with a finished job's outcome, 1 being done, and lets go of the file.
static void fsh_js_file_settled(JSContext *cx, fsh_js_file *f, int32_t outcome, fsh_array *out, fsh_str **parts) {
  JSValue v = JS_UNDEFINED;
  if (outcome != 1) v = fsh_js_file_error(cx, parts);
  else if (f->op == 0) v = f->text ? JS_NewStringLen(cx, out->data ? out->data : "", out->length) : JS_NewUint8ArrayCopy(cx, (const uint8_t *)out->data, out->length);
  fsh_rt_free(out->data);
  JS_FreeValue(cx, JS_Call(cx, f->settle[outcome == 1 ? 0 : 1], JS_UNDEFINED, 1, &v));
  JS_FreeValue(cx, v);
  JS_FreeValue(cx, f->settle[0]);
  JS_FreeValue(cx, f->settle[1]);
  fsh_rt_str_release(f->path);
  fsh_rt_free(f->bytes.data);
}

static int32_t fsh_js_file_poll(fsh_task *task, void *frame) {
  fsh_js_file *f = frame;
  fsh_array out = { 0 };
  fsh_str *parts[4] = { 0 };
  int32_t outcome = fsh_rt_file_poll(f->path, &f->bytes, &f->job, f->op, task, &out, parts);
  if (outcome == 0) return 0;
  JSContext *cx = fsh_js_enter();
  fsh_js_file_settled(cx, f, outcome, &out, parts);
  fsh_js_settle(cx);
  fsh_js_leave();
  fsh_rt_file_job_release(f->job);
  return 1;
}

// A job the runtime drops unfinished as the program ends.
static void fsh_js_file_drop(void *frame) {
  fsh_js_file *f = frame;
  fsh_js_enter();
  JS_FreeValueRT(fsh_js_runtime, f->settle[0]);
  JS_FreeValueRT(fsh_js_runtime, f->settle[1]);
  fsh_js_leave();
  fsh_rt_str_release(f->path);
  fsh_rt_free(f->bytes.data);
  fsh_rt_file_job_release(f->job);
}

static void fsh_js_nothing(void *output) {}

static JSValue fsh_host_file(JSContext *cx, JSValueConst self, int argc, JSValueConst *argv, int op) {
  fsh_js_file f = { 0 };
  f.op = op;
  size_t length = 0;
  const char *path = argc > 0 ? JS_ToCStringLen(cx, &length, argv[0]) : NULL;
  if (!path) return JS_ThrowTypeError(cx, "the path must be a string");
  f.path = fsh_str_of(path, length);
  JS_FreeCString(cx, path);
  if (op == 0 && argc > 1) {
    // "utf8", or { encoding: "utf8" }, reads text.
    JSValue encoding = JS_IsObject(argv[1]) ? JS_GetPropertyStr(cx, argv[1], "encoding") : JS_DupValue(cx, argv[1]);
    const char *name = JS_IsString(encoding) ? JS_ToCString(cx, encoding) : NULL;
    f.text = name && (strcmp(name, "utf8") == 0 || strcmp(name, "utf-8") == 0);
    JS_FreeCString(cx, name);
    JS_FreeValue(cx, encoding);
  }
  if (op == 1) {
    size_t size = 0;
    const char *text = argc > 1 && JS_IsString(argv[1]) ? JS_ToCStringLen(cx, &size, argv[1]) : NULL;
    const uint8_t *bytes = text ? (const uint8_t *)text : argc > 1 ? JS_GetUint8Array(cx, &size, argv[1]) : NULL;
    if (!bytes) {
      fsh_rt_str_release(f.path);
      JS_FreeValue(cx, JS_GetException(cx));
      return JS_ThrowTypeError(cx, "the data must be a string or a Uint8Array");
    }
    f.bytes.data = size ? fsh_rt_alloc(size) : NULL;
    if (size) memcpy(f.bytes.data, bytes, size);
    f.bytes.length = f.bytes.capacity = size;
    JS_FreeCString(cx, text);
  }
  JSValue promise = JS_NewPromiseCapability(cx, f.settle);
  if (!fsh_main_task) {
    fsh_array out = { 0 };
    fsh_str *parts[4] = { 0 };
    int32_t outcome = op == 0 ? fsh_rt_fs_read_sync(f.path, &out, parts) : fsh_rt_fs_write_sync(f.path, &f.bytes, parts);
    // The call that reached here runs the queued jobs once the calling JS finishes.
    fsh_js_file_settled(cx, &f, outcome, &out, parts);
    return promise;
  }
  fsh_task *task = fsh_rt_spawn(fsh_js_file_poll, fsh_js_file_drop, fsh_js_nothing, &f, sizeof f, 0);
  fsh_rt_handle_drop(task);
  return promise;
}

static void fsh_js_host(JSContext *cx) {
  JSValue host = JS_NewObject(cx);
  JS_SetPropertyStr(cx, host, "readFile", JS_NewCFunctionMagic(cx, (JSCFunctionMagic *)fsh_host_file, "readFile", 2, JS_CFUNC_generic_magic, 0));
  JS_SetPropertyStr(cx, host, "writeFile", JS_NewCFunctionMagic(cx, (JSCFunctionMagic *)fsh_host_file, "writeFile", 2, JS_CFUNC_generic_magic, 1));
  JS_SetPropertyStr(cx, host, "decode", JS_NewCFunction(cx, fsh_host_decode, "decode", 1));
  JS_SetPropertyStr(cx, host, "cwd", JS_NewCFunction(cx, fsh_host_cwd, "cwd", 0));
  JS_SetPropertyStr(cx, host, "hostname", JS_NewCFunction(cx, fsh_host_hostname, "hostname", 0));
  JS_SetPropertyStr(cx, host, "tmpdir", JS_NewCFunction(cx, fsh_host_tmpdir, "tmpdir", 0));
  JS_SetPropertyStr(cx, host, "homedir", JS_NewCFunction(cx, fsh_host_homedir, "homedir", 0));
  JS_SetPropertyStr(cx, host, "platform", JS_NewCFunction(cx, fsh_host_platform, "platform", 0));
  JS_SetPropertyStr(cx, host, "parallelism", JS_NewCFunction(cx, fsh_host_parallelism, "parallelism", 0));
  JS_SetPropertyStr(cx, host, "getenv", JS_NewCFunction(cx, fsh_host_getenv, "getenv", 1));
  JS_SetPropertyStr(cx, host, "argv", JS_NewCFunction(cx, fsh_host_argv, "argv", 0));
  JS_SetPropertyStr(cx, host, "exit", JS_NewCFunction(cx, fsh_host_exit, "exit", 1));
  JSValue global = JS_GetGlobalObject(cx);
  JS_SetPropertyStr(cx, global, "__fish", host);
  JS_FreeValue(cx, global);
}
`;
