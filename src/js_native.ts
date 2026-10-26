// The C glue between Fish and the vendored JS engine, appended to the runtime's source for a
// program that calls the engine, so it reaches the runtime's own helpers.
//
// One runtime and context serve the whole program, made on first use. Every call into them holds
// fsh_js_lock, so tasks on any thread may use JS while JS never runs in parallel with itself. A
// JsValue is a counted box holding one JS value; the last release frees the value under the lock.
// The engine is never torn down: its last values may be held by constants still alive at exit.
export const JS_NATIVE = String.raw`
#include "quickjs.h"

typedef struct {
  int64_t count;
  JSValue value;
} fsh_js;

static pthread_mutex_t fsh_js_lock = PTHREAD_MUTEX_INITIALIZER;
static JSRuntime *fsh_js_runtime = NULL;
static JSContext *fsh_js_context = NULL;

static JSContext *fsh_js_enter(void) {
  pthread_mutex_lock(&fsh_js_lock);
  if (!fsh_js_runtime) {
    fsh_js_runtime = JS_NewRuntime();
    fsh_js_context = JS_NewContext(fsh_js_runtime);
  }
  // The engine measures its stack from the thread that last entered it, and tasks move threads.
  JS_UpdateStackTop(fsh_js_runtime);
  return fsh_js_context;
}

static void fsh_js_leave(void) {
  pthread_mutex_unlock(&fsh_js_lock);
}

static fsh_js *fsh_js_box(JSValue value) {
  fsh_js *b = fsh_rt_alloc(sizeof(fsh_js));
  b->count = 1;
  b->value = value;
  return b;
}

void fsh_rt_js_release(fsh_js *b) {
  if (!b || __atomic_sub_fetch(&b->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  JSContext *cx = fsh_js_enter();
  JS_FreeValue(cx, b->value);
  fsh_js_leave();
  fsh_rt_free(b);
}

// The same, inside the engine.
static void fsh_js_drop(JSContext *cx, fsh_js *b) {
  if (__atomic_sub_fetch(&b->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  JS_FreeValue(cx, b->value);
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
  JSContext *cx = fsh_js_enter();
  JSAtom name = JS_NewAtomLen(cx, key->bytes, key->length);
  JSValue v = JS_GetProperty(cx, b->value, name);
  JS_FreeAtom(cx, name);
  if (JS_IsException(v)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(v);
}

fsh_js *fsh_rt_js_at(fsh_js *b, int64_t i, const char *where) {
  JSContext *cx = fsh_js_enter();
  JSValue v = JS_GetPropertyInt64(cx, b->value, i);
  if (JS_IsException(v)) fsh_js_throw(cx, where);
  fsh_js_leave();
  return fsh_js_box(v);
}

int32_t fsh_rt_js_has(fsh_js *b, fsh_str *key, const char *where) {
  JSContext *cx = fsh_js_enter();
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
  JSContext *cx = fsh_js_enter();
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
  JSContext *cx = fsh_js_enter();
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
  JSContext *cx = fsh_js_enter();
  fsh_js_expect(cx, b, JS_IsNumber(b->value), what, declared, where);
  double d = 0;
  JS_ToFloat64(cx, &d, b->value);
  fsh_js_drop(cx, b);
  fsh_js_leave();
  return d;
}

int32_t fsh_rt_js_as_boolean(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter();
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
  JSContext *cx = fsh_js_enter();
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
// string, 3 a number, 4 a boolean, 5 the string text, 6 false, 7 true, 8 the number number.
int32_t fsh_rt_js_is(fsh_js *b, int32_t kind, fsh_str *text, double number) {
  JSValue v = b->value;
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
      if (!JS_IsNumber(v)) return 0;
      JS_ToFloat64(fsh_js_context, &d, v);
      return d == number;
    }
  }
  if (!JS_IsString(v)) return 0;
  JSContext *cx = fsh_js_enter();
  size_t length;
  const char *bytes = JS_ToCStringLen(cx, &length, v);
  int32_t same = bytes && (int64_t)length == text->length && memcmp(bytes, text->bytes, length) == 0;
  JS_FreeCString(cx, bytes);
  fsh_js_leave();
  return same;
}

// A JS value none of its declaration's types took.
void fsh_rt_js_mismatch(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter();
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
  JSContext *cx = fsh_js_enter();
  fsh_js_expect(cx, b, JS_IsObject(b->value), what, declared, where);
  fsh_js_leave();
}

// An array's length, panicking, giving up the box, when the value isn't an array.
int64_t fsh_rt_js_length(fsh_js *b, const char *what, const char *declared, const char *where) {
  JSContext *cx = fsh_js_enter();
  fsh_js_expect(cx, b, JS_IsArray(b->value), what, declared, where);
  int64_t length = 0;
  if (JS_GetLength(cx, b->value, &length) < 0) fsh_js_throw(cx, where);
  fsh_js_leave();
  return length;
}
// Writes a property of a JS object, giving up the value's box.
void fsh_rt_js_set(fsh_js *object, fsh_str *key, fsh_js *part, const char *where) {
  JSContext *cx = fsh_js_enter();
  JSAtom name = JS_NewAtomLen(cx, key->bytes, key->length);
  int done = JS_SetProperty(cx, object->value, name, JS_DupValue(cx, part->value));
  JS_FreeAtom(cx, name);
  fsh_js_drop(cx, part);
  if (done < 0) fsh_js_throw(cx, where);
  fsh_js_leave();
}

// new of a JS class, giving up its box and every argument's.
fsh_js *fsh_rt_js_new(fsh_js *made, int64_t argc, fsh_js **argv, const char *where) {
  JSContext *cx = fsh_js_enter();
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
`;
