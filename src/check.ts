import { checkOverrides, declareClass, extend, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import { stdFor } from "./std.ts";
import { comptimeArgument, comptimeChecks, stringsType, untagged } from "./comptime.ts";
import type { ClassNode, Declarator, Expr, Func as Declared, Interface, ObjectProp, Param, Pattern, Span, Stmt, TypeAlias, TypeNode } from "./parser.ts";
import { lowerPattern, type PatternInfo } from "./match.ts";

type Arrow = Extract<Expr, { kind: "arrow" }>;
import { alwaysReturns, assignedNames } from "./flow.ts";
import { declareEnum, type EnumInfo } from "./enums.ts";
import { either, guard, type Facts } from "./narrow.ts";
import { comparable, objectsMeet } from "./unions.ts";
import { comptimeName, genericClasses, instancing } from "./generics.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { registry } from "./registry.ts";
import { addAlias, paramName, resolver, restParams, tagStrings, typeName } from "./resolve.ts";
import { openParam } from "./typefns.ts";
import { functionType, holdsPattern, isTuple, type ObjectType, promiseInterface, closureType, field, fits, literalType, typeParameter, stored, interiorMutable, lockCallbacks, sharedCallbacks, futureType, YIELD_NOW, generatorElement, generatorType, promiseElement, yieldsOf, type FutureType, holdsRef, isCopy, objectType, type Field, type GeneratorType, widenLet, isInteger, isNumeric, unionType, lower, refType, lowersClasses, lowersVariants, replaced, show, widenEnum, type ClassType, type ClosureType, type FunctionType, type Integer, type RefType, type Type } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { checkMoves } from "./moves.ts";
import { NATIVE } from "./native.ts";
import { RUNTIME } from "./runtime.ts";
import { expressions, substituted, stringLike } from "./values.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: number };

// Every function to compile: the top-level ones, then each class's constructor and methods.
export type Checked = { instances: Instance[] };

// One compiled function: a body checked with concrete types, and the tables codegen reads
// to lower it. `symbol` names it in the IR.
export type Instance = {
  body: Body;
  symbol: string;
  // What a generic body's type parameters stand for in this instance. An instance holding a
  // type parameter is the definition check, which is never compiled.
  bindings: Map<string, Type>;
  concrete: boolean;
  // How many generic instantiations led to this one, which bounds instantiations that never end.
  depth: number;
  // Its return type, written or inferred.
  returns: Type;
  // Every value expression's type.
  types: Map<Expr, Type>;
  // The binding each name use, declaration, parameter and shorthand property refers to,
  // after shadowing.
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  // The function each call of a user function or method runs, and the getter each read of
  // an accessor runs.
  calls: Map<Expr, Instance>;
  // The setter each assignment to an accessor runs.
  setters: Map<Expr, Instance>;
  // Each expression whose value meets a narrower declared type, and the type it is copied
  // down to.
  coercions: Map<Expr, Type>;
  // The loop, switch or labeled statement each `break` leaves and each `continue` repeats.
  jumps: Map<Stmt, Stmt>;
  // The arguments, or the receiver, each call returning a reference borrows from.
  borrowsFrom: Map<Expr, Expr[]>;
  // The error type a `throws` clause declares.
  throws?: Type;
  // Each fallible call and `throw`, the error it raises, and the error type that error
  // becomes where it goes: the function's own, which returns it.
  // An error the function's type doesn't take is first wrapped by a class's static `from`.
  raises: Map<Expr | Stmt, { from: Type; to: Type; wrapper?: ClassType; param?: Type; via?: Instance }>;
  // The type of what each `try` catches.
  caught: Map<Stmt, Type>;
  // Each place whose value is handed over rather than copied, which leaves it empty.
  consumes: Set<Expr | ObjectProp>;
  // What each match pattern tests, and the type of the value it meets.
  patterns: Map<Pattern, PatternInfo>;
  // Each read of a shared value's plain field: a copy made under its lock, not a place.
  copiesOut: Set<Expr>;
  // For a closure: the binding standing in its body for each variable it captures, and that
  // variable, or `this`, in the body it is written in, in the order its environment holds them;
  // and where it, or a closure inside it, first uses each.
  captures?: Map<Local, Local | "this">;
  captureUses?: Map<Local, Expr | ObjectProp>;
  // The captures it changes, which it captures mutably, and those it moves out of itself.
  changed?: Set<Local>;
  moved?: Set<Local>;
  // A closure's own type.
  closure?: ClosureType;
  // A C function's parameter types, for its declaration.
  signature?: Type[];
  // An async function's own future, which calling it gives.
  future?: FutureType;
  // A generator's own type, which calling it gives, and where each variable and each
  // `for...of` loop's state lives in its frame.
  generator?: GeneratorType;
  frame?: { locals: Map<Local, number>; loops: Map<Stmt, number>; awaits: Map<Expr, number> };
};

// What a closure's body sees of the body it is written in, as it is where the closure is made.
type Outer = {
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  narrowed(l: Local): Type | undefined;
  thisReady(e: Expr): boolean;
  noteThis(e: Expr): void;
  changesLocal(l: Local, path: string, action: string, target: Expr, throughMut: boolean): void;
  changesThis(path: string, action: string, target: Expr): void;
  // Whether a variable, followed through captures to where it is declared, can't change.
  constant(l: Local): boolean;
  // Whether a name is a local or parameter in sight of a type written at `at`, without capturing it.
  inSight(name: string, at: Span): boolean;
};

type Jump = Extract<Stmt, { kind: "break" | "continue" }>;

// What a `break` or `continue` can name: a loop, a switch, or a labeled statement, whose
// `loop` is the loop it labels, if any. A match arm's block is where its `return`s go, with
// whether the match gives a value and what they gave.
type Target = { stmt: Stmt; kind: "loop" | "switch" | "label" | "arm"; label?: string; loop?: Stmt; facts?: number; wanted?: boolean; gives?: [Expr, Type][] };

// What a loop keeps of what it iterates over. An array it borrows is kept as a view with the
// array's layout that owns nothing, so dropping the frame leaves the array to its owner, and
// moving the generator doesn't leave a pointer to the frame behind.
function iterated(instance: Instance, e: Expr): Type {
  const type = instance.coercions.get(e) ?? instance.types.get(e)!;
  // A fixed array it borrows is kept as a pointer to where it lives.
  if (typeof type !== "string" && type.kind === "fixed" && borrowed(instance, e) && !throughShared(instance, e)) return refType(type, false);
  if (typeof type === "string" || type.kind !== "array" || !borrowed(instance, e)) return type;
  return objectType([{ name: "a", type: refType(type.element, false) }, { name: "b", type: "i64" }, { name: "c", type: "i64" }]);
}

// Whether a place is read through a shared value, whose fields are copied out under its lock
// rather than borrowed where they live.
function throughShared(instance: Instance, e: Expr): boolean {
  if (e.kind !== "member" && e.kind !== "index") return false;
  const held = instance.types.get(e.object);
  const object = typeof held !== "string" && held?.kind === "ref" ? held.to : held;
  return (typeof object !== "string" && object?.kind === "shared") || throughShared(instance, e.object);
}

// Whether an expression reads a value where it lives rather than making one.
function borrowed(instance: Instance, e: Expr): boolean {
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind === "member") return !instance.calls.has(e) && borrowed(instance, e.object);
  if (e.kind === "index" || e.kind === "nonNull") return borrowed(instance, e.kind === "index" ? e.object : e.expr);
  return false;
}

// `await e`, which the parser reads as a unary operator.
export function isAwait(e: Expr): e is Extract<Expr, { kind: "unary" }> {
  return e.kind === "unary" && e.op === "await";
}

// A generator's frame, everything it keeps between `next()` calls: its state, its parameters
// in order, every other variable, then each `for...of` loop's array or generator and its
// position. A closure's loops are its own.
// An async method's object as its future holds it.
function receiverField(self: NonNullable<Body["self"]>, laid: (t: Type) => Type): Field {
  return { name: "this", type: laid(self.owned ? self.type : refType(self.type, self.mutable)) };
}

function frameOf(instance: Instance, generator: GeneratorType | FutureType) {
  const fields: Field[] = [{ name: "state", type: "i32" }];
  const locals = new Map<Local, number>();
  const loops = new Map<Stmt, number>();
  // Each `await` keeps the future it awaits in the frame while it is pending.
  const awaits = new Map<Expr, number>();
  const add = (l: Local) => {
    if (locals.has(l)) return;
    locals.set(l, fields.length);
    fields.push({ name: `${l.name}.${l.id}`, type: l.type });
  };
  // An async arrow's frame holds what it captured, first, and an async method's its object.
  if (instance.body.closure) fields.push({ name: "env", type: "void" });
  const self = instance.body.self;
  if (self && !self.constructor) fields.push(receiverField(self, (t) => (instance.concrete ? lower(t) : t)));
  instance.body.params.forEach((p) => add(instance.locals.get(p)!));
  [...new Set(instance.locals.values())].sort((a, b) => a.id - b.id).forEach(add);
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || (node as Expr).kind === "arrow") return;
    const s = node as Stmt;
    if (s.kind === "forOf") {
      loops.set(s, fields.length);
      fields.push({ name: "loop", type: iterated(instance, s.right) }, { name: "at", type: "i64" });
    }
    const e = node as Expr;
    if (isAwait(e)) {
      awaits.set(e, fields.length);
      fields.push({ name: "await", type: instance.types.get(e.operand)! });
    }
    Object.values(node).forEach(visit);
  };
  visit(instance.body.body);
  generator.frame = fields;
  instance.frame = { locals, loops, awaits };
}

// Resolves every name and gives every value expression a type. Codegen trusts the result.
// A function body is checked when first needed, so return types can be inferred in any order.
// Names an export can't take in C: its and C++'s keywords and the standard type names a header
// uses, and the C functions the runtime and its IR call, which an export would replace.
export const C_KEYWORDS = new Set(["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "bool", "true", "false", "size_t", "ptrdiff_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "class", "namespace", "template", "this", "new", "delete", "public", "private", "protected", "virtual", "operator", "friend", "using", "try", "catch", "throw", "typename", "explicit", "mutable", "nullptr", "decltype", "constexpr", "noexcept", "export", "and", "or", "not", "xor"]);
// The runtime's own calls are read from its code without its comments and strings, then the
// math and unwinding functions the IR, or LLVM lowering it, calls, which no text names.
const NATIVE_CODE = NATIVE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, " ");
const LOWERED = ["pow", "powf", "fmod", "fmodf", "sqrt", "sqrtf", "floor", "floorf", "ceil", "ceilf", "trunc", "truncf", "round", "roundf", "fabs", "fabsf", "exp", "expf", "log", "logf", "sin", "sinf", "cos", "cosf", "memset", "memmove", "memcpy", "memcmp", "bzero", "abort", "exit", "fflush", "dprintf", "printf", "malloc", "calloc", "realloc", "free", "write", "qsort"];
const RUNTIME_NAMES = new Set([
  ...[...NATIVE_CODE.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]!).filter((n) => !C_KEYWORDS.has(n)),
  ...RUNTIME.flatMap((line) => /^declare [^@]*@([\w.]+)\(/.exec(line)?.[1] ?? []),
  ...LOWERED,
]);

// The names a loop's pattern binds, made as declarations of the parts; a generic body checked
// again for another instance meets them already made.
const loopParts = new WeakSet<Declarator>();

// A library is checked with `library` set: it needs no `main`, and its exports cross to C.
export function check(written: Stmt[], library = false): Checked {
  const program = [...stdFor(written), ...written];
  const funcs: Func[] = [];
  const aliases = new Map<string, TypeAlias>();
  const classes = new Map<string, ClassInfo>();
  // Generic classes, declared again for each set of type arguments they are used with.
  const templates = new Map<string, ClassNode & { name: string }>();
  const interfaces = new Map<string, Interface>();
  const enums = new Map<string, EnumInfo>();
  // For each class declaring lifetimes, which of its type parameters are lifetimes.
  const slots = new Map<string, boolean[]>();
  for (const s of program) {
    if (s.kind === "enum") {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      enums.set(s.name, declareEnum(s));
      continue;
    }
    if (s.kind === "typeAlias") {
      addAlias(aliases, s, classes, templates, interfaces, enums);
      continue;
    }
    if (s.kind === "interface") {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      interfaces.set(s.name, s);
      continue;
    }
    if (s.kind === "class" && s.name !== undefined) {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      // A class's lifetimes are checked and erased, never instanced, so they are set aside.
      const node = { ...s, name: s.name, typeParams: s.typeParams.filter((p) => !isLifetime(p)) };
      if (s.typeParams.some(isLifetime)) slots.set(s.name, s.typeParams.map(isLifetime));
      if (node.typeParams.length > 0) templates.set(s.name, node);
      else classes.set(s.name, declareClass(node));
      continue;
    }
    // `declare function f(...): T;` names a C function, called inside `unsafe`.
    if (s.kind === "declare" && s.body.kind === "function" && !hasBody(s.body)) {
      const rest = s.body.params.find((p) => p.rest);
      if (rest) throw unsupported("variadic C functions", rest);
      funcs.push(Object.assign({ ...s.body, body: [] }, { foreign: true }));
      continue;
    }
    // `export function f() {}` is an ordinary function, and in a library a C function too.
    if (s.kind === "export" && s.body.kind === "function" && hasBody(s.body)) {
      funcs.push(Object.assign({ ...s.body }, { exported: true }));
      continue;
    }
    const declaration = unsupportedDeclaration(s);
    if (declaration) throw declaration;
    if (s.kind === "empty") continue;
    // A top-level `const` is computed while compiling: comptime runs a function of no parameters
    // giving its value. A `comptime { }` block is a function giving nothing, run the same way.
    const made = { kind: "function" as const, async: false, generator: false, macro: false, typeParams: [], params: [], start: s.start, end: s.end };
    if (s.kind === "let" && s.keyword === "const") {
      for (const d of s.declarations) {
        if (d.target.kind !== "ident") throw unsupported("destructuring top-level consts", d.target);
        if (["undefined", "console", "print"].includes(d.target.name)) throw new CompileError(`'${d.target.name}' already names something every program has; call the const something else`, d.target.start, d.target.end);
        if (!d.init) throw new CompileError("a top-level 'const' needs its value", d.start, d.end);
        const giving: Stmt = { kind: "return", value: d.init, start: d.init.start, end: d.init.end };
        funcs.push(Object.assign({ ...made, name: `const ${d.target.name}`, returnType: d.type, body: [giving], start: d.start, end: d.end }, { comptime: "const" as const }));
      }
      continue;
    }
    if (s.kind === "comptime") {
      funcs.push(Object.assign({ ...made, name: `comptime ${s.start}`, returnType: undefined, body: s.body }, { comptime: "block" as const }));
      continue;
    }
    if (s.kind === "let") throw new CompileError("a top-level 'let' would be a global that changes; use 'const', whose value is computed while compiling, or a const holding an Atomic or a Lock", s.start, s.end);
    // Top-level code with side effects belongs in main(); the migration lint moves it there.
    if (s.kind !== "function") throw new CompileError("only declarations are allowed at the top level; move this into main()", s.start, s.end);
    if (s.macro) throw unsupported("macros", s);
    if (!hasBody(s)) throw unsupported("functions without a body", s);
    funcs.push(s);
  }
  const byName = new Map<string, Func>();
  for (const f of funcs) {
    // Only a tag's values fill a rest parameter so far.
    if (f.params.length === 2 && tagStrings(f.params[0]) && f.params[1]!.rest) restParams.add(f.params[1]!);
    else if (f.params.length === 2 && f.params[1]!.rest && (f.params[0]!.comptime || (f.params[0]!.type?.kind === "ref" && f.params[0]!.type.name === "TemplateStringsArray"))) {
      const strings = f.params[0]!;
      throw new CompileError(`'${f.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, strings.start, strings.end);
    } else if (f.params[0]?.comptime && f.params.at(-1)?.rest) {
      const rest = f.params.at(-1)!;
      throw new CompileError("a tag's rest parameter comes right after its strings, as in 'comptime strings: TemplateStringsArray, ...values: T[]'; rest parameters elsewhere aren't supported yet", rest.start, rest.end);
    }
    if (f.async && f.generator) throw unsupported("async generators", f);
    const named = f.name.startsWith("const ") ? f.name.slice("const ".length) : f.name;
    if (byName.has(f.name) || byName.has(named) || byName.has(`const ${named}`) || classes.has(named) || templates.has(named) || enums.has(named)) throw new CompileError(`'${named}' is already defined`, f.start, f.end);
    byName.set(f.name, f);
  }
  const main = byName.get("main");
  if (!main && !library) throw new CompileError("no main() function; execution starts there", 0, 0);

  // A class's members, for interface satisfaction. Like the resolver and generic classes,
  // which need each other, it reaches what is set up below lazily.
  const members: Members = {
    classOf: (t) => classOf(t),
    returnOf: (b, at) => returnOf(definition(b), at),
    paramTypesOf: (b) => declaredParams(b),
  };
  const { register, settle, link, layout, laying, classOf, bodiesOf, infoOf, unsettled, wrapsOf } = registry({
    classes, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
    instanceOf: (f) => instanceOf(f), definition: (f) => definition(f), checkBody: (i) => checkBody(i),
  });
  classes.forEach(register);
  const { classNamed, construct, start, define } = genericClasses({
    classes, templates, register, layout, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
  });
  const { resolveType, paramType, withScope, withSight, setSight, enumInstance, validate } = resolver(aliases, classNamed, interfaces, enums, slots, (c) => layout(classOf(c)), (name, at, shadowed) => valueTypeOf(name, at, shadowed),
    // An interface is met by shape, as a conditional type's `extends` asks of it.
    (from, to, at) => (typeof to !== "string" && to.kind === "interface" ? unsatisfied(from, to, members, at) === undefined : fits(from, to)));
  // A generic enum's variant made with other type arguments, while lowering.
  lowersVariants((v, args) => enumInstance(enums.get(v.enum)!, args, checking?.body ?? { start: 0, end: 0 }).variants.get(v.member)!);
  // A class first made while lowering is reported at the function being checked.
  lowersClasses((c, args) => classNamed(c.generic!.name, args, checking?.body ?? { start: 0, end: 0 })!);
  // The instance being checked, which new instantiations count their depth from.
  let checking: Instance | undefined;
  const done = new Set<Instance>();
  // Comptime runs a function only once the checker has been through it.
  comptimeChecks((i) => {
    if (inProgress.has(i)) return false;
    checkBody(i);
    return true;
  });
  // Each concrete instance's return type as its own body saw it, before lowering.
  const views = new Map<Instance, Type>();
  // Each unannotated `let` of integer literals a use needs as another integer type, as Rust
  // infers it, and the variables still open to that in the pass being checked.
  const demands = new Map<Stmt, Integer>();
  const candidates = new Map<Local, Stmt>();
  // How many new demands the body being checked made itself, not counting its callees'.
  let demanded = 0;
  const { instanceOf, instantiate, paramTypes, scopeOf, declaredParams, implicitOf, definition, pending, all, siteOf, returnTypeOf, constructs } = instancing({
    resolveType, paramType, withScope, members, checking: () => checking,
    signing: (f, run) => withSight((n, at) => writtenIn(f, at) && f.params.some((p) => p.pattern.kind === "ident" && p.pattern.name === n), run),
    classParams: (f) => (f.scope?.size && f.owner ? classOf(f.owner).node.typeParams : []),
    comptimeArgument: (arg) => comptimeLiteral(arg),
  });
  // What `typeof name` names in a type: a top-level const's type, or a non-generic function's,
  // whose result is checked from its body when it isn't written.
  function valueTypeOf(name: string, at: Span, shadowed: boolean): Type {
    if (shadowed) throw new CompileError(`'typeof' of the local '${name}' isn't supported yet; 'typeof' in a type names a top-level function or const`, at.start, at.end);
    if (classes.has(name)) throw new CompileError(`'typeof' of the class '${name}' isn't supported yet, since classes aren't values in Fish; name the class itself as the type`, at.start, at.end);
    const constant = byName.get(`const ${name}`);
    const f = constant ?? byName.get(name);
    if (!f) throw new CompileError(`'typeof' in a type names a top-level function or const, and there is none named '${name}'`, at.start, at.end);
    if (querying.has(name)) throw new CompileError(`'typeof ${name}' is used in working out ${name}'s own type, so that type would depend on itself; write it out`, at.start, at.end);
    querying.add(name);
    try {
      if (!constant) return functionTypeOf(f, at);
      const declared = returnTypeOf(constant, new Map());
      if (!declared || isInterface(declared)) unlaid(name, at);
      return widenLet(returnOf(instanceOf(constant), at));
    } finally {
      querying.delete(name);
    }
  }
  const querying = new Set<string>();

  // Whether a type written at `at` sits inside a body.
  function writtenIn(f: Body, at: Span): boolean {
    return at.start >= f.start && at.end <= f.end;
  }

  // A result worked out from a body may need the class being laid out, whose fields aren't known.
  function unlaid(name: string, at: Span) {
    const [mid] = laying;
    if (mid) throw new CompileError(`'typeof ${name}' needs ${name}'s result, worked out from its body, while the field types of '${mid.type.name}' are being worked out; write ${name}'s return type`, at.start, at.end);
  }

  // A function's type for `typeof`: a parameter typed with an object type, an interface or a
  // function type makes it generic in Fish, but its declared type is what `typeof` names.
  function functionTypeOf(f: Func, at: Span): Type {
    const explicit = f.typeParams.filter((p) => !(p.constraint?.kind === "ref" && p.constraint.name === "Lifetime"));
    if (explicit.length > 0 || f.params.some((p) => p.comptime)) {
      throw new CompileError(`'typeof' of the generic function '${f.name}' isn't supported yet: it has a type per instance, and none is chosen here`, at.start, at.end);
    }
    if (f.generator) throw unsupported("generator functions in 'typeof' types", at);
    const def = definition(f);
    // An async function's written `Promise<T>` is its type; any other interface result, or one
    // left to inference, is worked out from the body.
    const declared = returnTypeOf(f, def.bindings);
    let result: Type;
    if (declared && (f.async || !isInterface(declared))) result = declared;
    else {
      unlaid(f.name, at);
      const returns = returnOf(def, at);
      result = f.async && typeof returns !== "string" && returns.kind === "future" ? promiseInterface(returns.gives) : returns;
    }
    const open = openParam(result, true);
    if (open) {
      const i = f.params.findIndex((_, i) => def.bindings.get(`#${i}`) === open);
      const param = f.params[i]?.pattern;
      throw new CompileError(`'typeof ${f.name}' can't name its result, which depends on the type of the argument given for '${param?.kind === "ident" ? param.name : open.name}'; write the return type`, at.start, at.end);
    }
    return functionType(f.params.map((p) => (p.pattern.kind === "ident" ? p.pattern.name : "_")), declaredParams(f), result);
  }

  // A comptime parameter's argument: its value, computed in the calling instance, as a literal
  // type. Inside a generic definition the caller's own values aren't known, so it stays open.
  function comptimeLiteral(arg: Expr): Type {
    // The caller's own comptime parameter passed on: the same value, or in a definition the same
    // placeholder, so a call passing it on shares the caller's instance.
    const local = arg.kind === "ident" ? checking?.locals.get(arg) : undefined;
    const own = local && checking?.body.params.find((p) => p.comptime && checking!.locals.get(p) === local);
    if (own && checking) return checking.bindings.get(comptimeName(own))!;
    if (!checking?.concrete) {
      let open = placeholders.get(arg);
      if (!open) placeholders.set(arg, open = typeParameter("comptime argument", undefined));
      return open;
    }
    // The argument was checked in the innermost body being checked, a closure's perhaps.
    const site = [...inProgress].reverse().find((i) => i.types.has(arg)) ?? checking;
    const given = site.types.get(arg);
    if (typeof given !== "string" && given?.kind === "literal" && given.owner) return given;
    const tagged = comptimeArgument(site, arg);
    const tag = tagged && typeof tagged === "object" && tagged.kind === "member" ? tagged.type : undefined;
    if (typeof tag !== "string" && tag?.kind === "literal") return tag;
    const v = untagged(tagged);
    if (typeof v === "bigint" || typeof v === "string" || typeof v === "boolean") return literalType(v);
    if (typeof v === "object" && v?.kind === "array" && v.items.every((x) => typeof x === "string")) return stringsType(v.items as string[]);
    throw new CompileError("a comptime parameter takes an integer, a boolean, a string, an enum member or a string array", arg.start, arg.end);
  }
  // A generic definition's placeholder for each comptime argument, one per argument.
  const placeholders = new WeakMap<Expr, Type>();
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new Set<Stmt>();
  const continued = new Set<Stmt>();
  const inProgress = new Set<Instance>();
  let nextId = 0;
  // Every closure's instance, and the instance each closure type calls.
  const closures: Instance[] = [];
  const closureBodies = new Map<ClosureType, Instance>();

  classes.forEach((c) => link(c, new Set()));
  classes.forEach(checkOverrides);
  // Classes are laid out before any body is checked, since checking one may need another's
  // fields. Until the resolver exists, a generic class's instance waits for `start`.
  infoOf.forEach(layout);
  start();
  define();
  // Aliases are checked once classes are laid out, since one may read a class's fields or a
  // function's inferred result, and so is an enum with no type parameters, made now so a
  // payload naming no type is caught unused.
  validate();
  for (const e of enums.values()) if (e.data && e.data.params.length === 0) e.type = enumInstance(e, [], e.data.at).type;
  funcs.forEach((f) => checkBody(definition(f)));
  while (unsettled.length > 0 || pending.length > 0) {
    if (unsettled.length > 0) settle(unsettled.shift()!);
    else checkBody(pending.shift()!);
  }
  if (main && main.params.length > 0) throw new CompileError("main() takes no parameters", main.start, main.end);
  const started = main && instanceOf(main).returns;
  if (main && (typeof started !== "string" && started?.kind === "future" ? started.gives : started) !== "void") throw new CompileError("main() can't return a value yet", main.start, main.end);
  if (library) funcs.filter((f) => (f as Body).exported).forEach((f) => exportable(definition(f)));
  if (library && !funcs.some((f) => (f as Body).exported)) throw new CompileError("a library has nothing for C to call; mark functions with 'export'", 0, 0);
  const compiled = new Set([...funcs, ...[...infoOf.values()].flatMap(bodiesOf)]);
  return { instances: [...all().filter((i) => i.concrete && compiled.has(i.body)), ...closures.filter((i) => i.concrete)] };

  // What a function's returned reference borrows from: the parameters with its written
  // lifetime, or by elision `this` for a method, or the only reference parameter.
  function originsOf(f: Body, params: Type[], returns: RefType): Origin[] {
    const at = f.returnType ?? f;
    if (returns.life) {
      const found: Origin[] = f.params.flatMap((p, i) => (named(p.type).has(returns.life!) ? [i] : []));
      // A lifetime of the method's own class is the object's.
      if (f.owner && classLifetimes(f).has(returns.life)) found.push("this");
      if (found.length === 0) throw new CompileError(`no parameter is borrowed for lifetime '${returns.life}'; write 'Ref<T, ${returns.life}>' on the parameter the result points into`, at.start, at.end);
      return found;
    }
    if (f.self && !f.self.constructor && !f.self.owned) return ["this"];
    const refs = params.flatMap((p, i) => (holdsRef(p) ? [i] : []));
    if (refs.length === 1) return refs;
    throw new CompileError(refs.length === 0
      ? "this function returns a reference but borrows nothing it could point into; return an owned value instead"
      : "this function returns a reference and takes several, so say which it points into: declare '<A extends Lifetime>' and write 'Ref<T, A>' on that parameter and the return type", at.start, at.end);
  }

  // What a value holding references a body returns may point into: the parameters whose
  // annotations name a lifetime its type names, or, naming none, whatever was lent.
  function heldOrigins(f: Body): Origin[] | undefined {
    const names = named(f.returnType);
    if (names.size === 0) return undefined;
    const found: Origin[] = f.params.flatMap((p, i) => ([...named(p.type)].some((n) => names.has(n)) ? [i] : []));
    if ([...classLifetimes(f)].some((n) => names.has(n))) found.push("this");
    return found;
  }

  // The lifetime names an annotation writes: on references, and in classes' lifetime slots.
  function named(t: TypeNode | undefined): Set<string> {
    const found = new Set<string>();
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const node = n as { kind?: string; name?: string; args?: (TypeNode & { name?: string })[] };
      if (node.kind === "ref" && node.args) {
        if ((node.name === "Ref" || node.name === "Mut") && node.args.length === 2) found.add(node.args[1]!.name!);
        const lifetime = slots.get(node.name!);
        if (lifetime && node.args.length === lifetime.length) node.args.forEach((a, i) => lifetime[i] && found.add(a.name!));
      }
      for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
    };
    visit(t);
    return found;
  }

  // What a call's returned reference, or returned value holding references, borrows from, as
  // the callee's signature says; with no lifetime written, whatever was lent to the call.
  function sourcesOf(instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[] {
    const f = instance.body;
    const returns = returnOf(instance, at);
    if (!holdsRef(returns)) return [];
    const origins = isRef(returns) ? originsOf(f, paramTypes(instance), returns) : heldOrigins(f);
    if (!origins) return [...args.filter(lends), ...(receiver ? [receiver] : [])];
    return origins.flatMap((o) => (o === "this" ? (receiver ? [receiver] : []) : [args[o]!]));
  }

  // Every lifetime a body writes must be one it declares.
  function lifetimes(f: Body) {
    const declared = new Set([...(f.typeParams ?? []), ...(f.owner ? classNode(f.owner.name)?.typeParams ?? [] : [])].filter(isLifetime).map((p) => p.name));
    const visit = (t: unknown): void => {
      if (!t || typeof t !== "object") return;
      const node = t as { kind?: string; name?: string; args?: TypeNode[] };
      const lives = node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args?.length === 2 ? [node.args[1]!]
        : node.kind === "ref" && slots.get(node.name!)?.length === node.args?.length ? node.args!.filter((_, i) => slots.get(node.name!)![i]) : [];
      for (const life of lives as (Span & { name: string })[]) {
        if (!declared.has(life.name)) throw new CompileError(`cannot find lifetime '${life.name}'; declare it as '<${life.name} extends Lifetime>'`, life.start, life.end);
      }
      for (const v of Object.values(t)) if (v && typeof v === "object") visit(v);
    };
    f.params.forEach((p) => visit(p.type));
    visit(f.returnType);
  }

  // The lifetimes a method's class declares.
  function classLifetimes(f: Body): Set<string> {
    return new Set((f.owner ? classNode(f.owner.name)?.typeParams ?? [] : []).filter(isLifetime).map((p) => p.name));
  }

  // A class's declaration as written, lifetimes included.
  function classNode(name: string): ClassNode | undefined {
    const base = name.split("<")[0]!;
    return program.find((s): s is ClassNode & Stmt => s.kind === "class" && s.name === base);
  }

  // Codegen sees each type parameter as the concrete type it stands for.
  function lowerTables(instance: Instance) {
    views.set(instance, instance.returns);
    for (const table of [instance.types, instance.coercions]) table.forEach((t, e) => table.set(e, lower(t)));
    // A pipe's topic written in as a field read would run a getter once for each `%`.
    for (const e of instance.types.keys()) {
      if (e.kind !== "member" || !substituted.has(e)) continue;
      const held = instance.types.get(e.object);
      const object = typeof held !== "string" && held?.kind === "ref" ? held.to : held;
      if (typeof object !== "string" && object?.kind === "class" && !field(object, e.name)) throw unsupported("pipes over a field a getter provides", e);
    }
    instance.patterns.forEach((info, p) => instance.patterns.set(p, lowerPattern(info)));
    instance.raises.forEach((r, at) => instance.raises.set(at, { ...r, from: lower(r.from), to: lower(r.to), ...(r.param && { param: lower(r.param) }) }));
    instance.caught.forEach((t, s) => instance.caught.set(s, lower(t)));
    if (instance.throws) instance.throws = lower(instance.throws);
    for (const local of new Set(instance.locals.values())) local.type = lower(local.type);
    for (const table of [instance.calls, instance.setters]) table.forEach((target, e) => table.set(e, counterpart(target)));
    instance.returns = lower(instance.returns);
  }

  // A member of a generic class made from a type parameter runs as the same member of the
  // class made from what the parameter stands for. Both come from one template, so their
  // members are in the same order.
  function counterpart(target: Instance): Instance {
    const owner = target.body.owner;
    const to = owner && (lower(owner) as ClassType);
    if (!owner || to === owner) return target;
    const body = bodiesOf(classOf(to!))[bodiesOf(classOf(owner)).indexOf(target.body)]!;
    const implicit = [...implicitOf(body).keys()].map((i): [string, Type] => [`#${i}`, target.bindings.get(`#${i}`)!]);
    // Its comptime parameters' values carry over too.
    const fixed = [...target.bindings].filter(([name]) => name.startsWith("comptime "));
    return instanceOf(body, new Map([...body.scope!, ...implicit, ...fixed]));
  }

  // An export in a library is a C function too, so its signature crosses to C as a declared
  // function's does, and it can't throw, be generic or be a generator, which C can't call.
  function exportable(instance: Instance) {
    const f = instance.body;
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || (typeof t !== "string" && t.kind === "pointer");
    if (f.typeParams?.length) throw new CompileError("a library can't export a generic function to C, which has no generics; export one for each type", f.start, f.end);
    if (f.generator) throw new CompileError("a library can't export a generator to C, which has no generators", f.start, f.end);
    if (f.throws) throw new CompileError("a library can't export a function that throws to C, which has no exceptions; return a status instead", f.throws.start, f.throws.end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name) || C_KEYWORDS.has(f.name)) {
      throw new CompileError(`a library can't export '${f.name}' to C, which needs a name of ASCII letters, digits and underscores that isn't a C or C++ keyword`, f.start, f.end);
    }
    // C reserves names starting with an underscore and a capital, or two underscores, for itself
    // and its runtime: the unwinder's `_Unwind_Resume` among them.
    if (f.name === "main" || f.name.startsWith("fsh_") || /^_[A-Z_]/.test(f.name) || RUNTIME_NAMES.has(f.name)) {
      throw new CompileError(`a library can't export '${f.name}' to C, since C's library or the Fish runtime already uses that name`, f.start, f.end);
    }
    f.params.forEach((p) => {
      const t = instance.locals.get(p)!.type;
      if (!crosses(t)) throw new CompileError(`an exported function's parameter can't be a '${show(t)}' in a library; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    if (instance.returns !== "void" && !crosses(instance.returns)) {
      const at = f.returnType ?? f;
      throw new CompileError(`an exported function can't return a '${show(instance.returns)}' in a library; C gives numbers, booleans and raw pointers`, at.start, at.end);
    }
  }

  // A C function's signature, which must cross to C as it is: numbers, booleans and raw
  // pointers, with `void` for no result.
  function foreignSignature(instance: Instance) {
    const f = instance.body;
    if (f.typeParams?.length) throw unsupported("generic C functions", f);
    if (f.generator) throw new CompileError("a C function can't be a generator; drop the '*'", f.start, f.end);
    if (f.async) throw new CompileError("a C function can't be async; C calls return when they finish", f.start, f.end);
    if (f.name === "main") throw new CompileError("'main' can't be a C function; it is where the program starts", f.start, f.end);
    if (f.throws) throw new CompileError("a C function can't throw; C reports failures in its result", f.throws.start, f.throws.end);
    if (!f.returnType) throw new CompileError("a C function needs its return type written, 'void' if it returns nothing", f.start, f.end);
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || (typeof t !== "string" && t.kind === "pointer");
    const params = paramTypes(instance, scopeOf(instance));
    f.params.forEach((p, i) => {
      if (p.rest || p.optional || p.default) throw unsupported("rest, optional and default parameters on C functions", p);
      if (!crosses(params[i]!)) throw new CompileError(`a C function's parameter can't be a '${show(params[i]!)}'; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    instance.signature = params;
    const returns = resolveType(f.returnType);
    if (returns !== "void" && !crosses(returns)) throw new CompileError(`a C function can't return a '${show(returns)}'; C gives numbers, booleans and raw pointers`, f.returnType.start, f.returnType.end);
    instance.returns = returns;
    done.add(instance);
  }

  // A call made inside an instance with one of its type parameters gets the type the definition
  // gave it: the callee's return with the callee's parameters as the ones the call passed.
  function resultOf(instance: Instance, at: Span): Type {
    // Checking the callee may instantiate from this call again, so its site is read first.
    const site = siteOf(at);
    const returns = returnOf(instance, at);
    if (!site) return returns;
    const f = instance.body;
    const declared = returnTypeOf(f, new Map([...instance.bindings, ...site]));
    if (declared && !isInterface(declared)) return declared;
    const own = scopeOf(instance);
    return replaced(views.get(instance) ?? returns, new Map([...site].map(([name, t]) => [own.get(name)!, t])));
  }

  // What a call of an instance may throw, as its caller sees it.
  function errorOf(instance: Instance): Type | undefined {
    const f = instance.body;
    return f.throws && withScope(instance.bindings, () => resolveType(f.throws!));
  }

  function returnOf(instance: Instance, at: Span): Type {
    const f = instance.body;
    const declared = returnTypeOf(f, instance.bindings);
    if (declared && !isInterface(declared)) return declared;
    if (inProgress.has(instance)) {
      if (f.generator) throw new CompileError(`a generator can't make another of itself, since its state would have to hold itself; loop inside one generator instead`, at.start, at.end);
      if (f.async) throw new CompileError(`an async function can't await another of itself, since its state would have to hold itself; loop inside one instead`, at.start, at.end);
      throw new CompileError(`'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    checkBody(instance);
    return instance.returns;
  }

  // Checks an instance with its type arguments in scope.
  function checkBody(instance: Instance) {
    if (done.has(instance)) return;
    const outer = checking;
    const outerDemanded = demanded;
    checking = instance;
    try {
      // A pass whose body made a new demand is thrown away, whatever it concluded, and the body
      // is checked again with the demanded types; each pass adds one, so this ends.
      for (;;) {
        demanded = 0;
        try {
          // A body sees its own names, not those of a body whose check needed it.
          withSight(undefined, () => withScope(scopeOf(instance), () => checkInstance(instance)));
        } catch (e) {
          inProgress.delete(instance);
          if (!(e instanceof CompileError) || demanded === 0) throw e;
        }
        if (demanded === 0) return;
        forget(instance);
      }
    } finally {
      checking = outer;
      demanded = outerDemanded;
    }
  }

  // Clears what checking an instance recorded, for another pass: its tables and its closures.
  // A callee checked during the pass stays checked, closures and all.
  function forget(instance: Instance) {
    for (const table of [instance.types, instance.locals, instance.calls, instance.setters, instance.coercions, instance.jumps, instance.borrowsFrom, instance.raises, instance.caught, instance.consumes, instance.patterns, instance.copiesOut]) table.clear();
    instance.returns = "void";
    delete instance.throws;
    const within = (c: Instance): boolean => c === instance || (c.body.closure !== undefined && within(c.body.closure.parent));
    // A closure checked within a discarded pass isn't in progress any more either.
    for (const c of [...inProgress]) if (within(c)) inProgress.delete(c);
    const kept = closures.filter((c) => !within(c));
    closures.length = 0;
    closures.push(...kept);
    views.delete(instance);
    done.delete(instance);
    inProgress.delete(instance);
  }

  function checkInstance(instance: Instance, outer?: Outer) {
    const f = instance.body;
    // A comptime parameter's value is the instance's own; one called from C, or kept in an async
    // function's or a generator's state, or given to an accessor, has no instance per value.
    const fixedParam = f.params.find((p) => p.comptime);
    if (fixedParam && f.foreign) throw new CompileError("a C function can't take a comptime parameter: C takes every argument at run time", fixedParam.start, fixedParam.end);
    if (fixedParam && f.accessor) throw new CompileError("an accessor can't take a comptime parameter, since a read or an assignment gives it no value while compiling", fixedParam.start, fixedParam.end);
    if (f.foreign) return foreignSignature(instance);
    if (fixedParam && (f.async || f.generator)) throw unsupported("comptime parameters on async functions and generators", fixedParam);
    if (fixedParam && f.exported) throw new CompileError("an exported function can't take a comptime parameter, since C calls it with run-time values", fixedParam.start, fixedParam.end);
    inProgress.add(instance);
    const { types, locals, coercions, calls, setters, jumps } = instance;
    // A closure returns the number type the function type it meets returns, so its literals
    // take that type.
    const given = f.closure?.expected?.returns;
    let declared = f.closure ? (f.returnType ? stored(resolveType(f.returnType)) : given && isNumeric(given) ? given : undefined) : returnTypeOf(f, scopeOf(instance));
    // A generator's declared `Generator<T>` says what it yields; calling it gives its own type.
    const generator = f.generator ? (instance.generator ??= generatorType(f.name, instance.concrete)) : undefined;
    let yielded = generator && declared ? generatorElement(declared) : undefined;
    if (generator && declared && !yielded) throw new CompileError("a generator function's return type is 'Generator<T>', the type of what it yields", f.returnType!.start, f.returnType!.end);
    if (generator) declared = undefined;
    if (generator && f.throws) throw unsupported("generators that throw", f.throws);
    if (yielded && holdsRef(yielded)) throw unsupported("generators yielding references", f.returnType!);
    // An async function's declared `Promise<T>` says what it gives once awaited; its `return`s
    // give that, and calling it gives its own future, which runs nothing until awaited.
    const future = f.async ? (instance.future ??= futureType(f.name, instance.concrete)) : undefined;
    if (future && declared) {
      const gives = promiseElement(declared);
      if (gives === undefined) throw new CompileError("an async function's return type is 'Promise<T>', the type of what it gives once awaited", f.returnType!.start, f.returnType!.end);
      declared = gives;
    }
    // A function returning an interface returns its one concrete type, which must satisfy it.
    const trait = declared && typeof declared !== "string" && declared.kind === "interface" ? declared : undefined;
    if (trait) declared = undefined;
    let inferred: Type | undefined;
    // The awaits written where the state machine can stop at them.
    const awaitable = new Set<Expr>();
    // How many statements with a `finally` enclose the code being checked: a generator dropped
    // at a `yield` there would never run the `finally`.
    let finalizing = 0;
    const scopes: Map<string, Local>[] = [new Map()];
    // Every type written from here on, in annotations, casts and closures, sees these names.
    const named = (p: Param, name: string) => p.pattern.kind === "ident" && p.pattern.name === name;
    // Only a type written inside the body sees them: one written elsewhere, a class's field or
    // another signature, is resolved here only because the body needed it.
    const inSight = (name: string, at: Span): boolean => writtenIn(f, at) && (scopes.some((s) => s.has(name)) || f.params.some((p) => named(p, name)) || (outer?.inSight(name, at) ?? false));
    setSight(inSight);
    const targets: Target[] = [];
    // What the conditions guarding the code being checked prove, innermost last. A `let`
    // narrows only when nothing assigns to its name.
    const facts: Facts[] = [];
    // The list being checked and the place in it, for a statement that becomes several.
    let siblings: { list: Stmt[]; at: number } | undefined;
    // For each enclosing `try`, the errors its block raises so far, where and of what type.
    const handlers: [Expr | Stmt, Type][][] = [];
    // How many comptime blocks or expressions the code being checked is inside, and for each
    // block, how many targets were open when it began, which nothing inside may jump to.
    let comptimeDepth = 0;
    const floors: number[] = [];
    // Each narrowed `Mut` given a whole value of another member, in order.
    const changed: Local[] = [];
    // The expression an expression statement being checked consists of.
    let whole: Expr | undefined;
    const assigned = assignedNames(f.body);
    // A `Mut` variable is never pointed elsewhere, so assigning it doesn't stop it narrowing.
    // A capture narrows as a variable of the closure's would.
    const narrowable = (l: Local) => (captures?.has(l) ? !assigned.has(l.name) : l.param || !l.mutable || !assigned.has(l.name)) || (isRef(l.type) && l.type.mutable);
    // How many scopes enclose each binding's declaration.
    const depths = new Map<Local, number>();
    // Bindings declared directly in a switch case body whose checking has finished.
    const caseOnly = new Set<Local>();
    const proves = (e: Expr) => guard(e, types, locals as Map<Expr, Local>, narrowable);

    // A constructor's fields are unset until assigned, so until then `this` may only appear as
    // the target of an assignment to one of them, and the constructor can't return.
    const unset = new Set(f.self?.constructor ? classOf(f.self.type).required : []);
    let exempt: Expr | undefined;
    // A derived constructor's first statement, `super(...)`, fills the embedded base.
    const superCall = f.self?.constructor && f.self.type.base ? (f.body[0] as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (superCall) unset.add(SUPER);

    // In a member of a generic class's instance, `this` is the class made from the type
    // parameters as this body sees them, so it reads through their bounds as the definition did.
    const generic = f.self?.type.generic;
    const viewed = generic && classNamed(generic.name, classOf(f.self!.type).node.typeParams.map((p) => resolveType({ kind: "ref", name: p.name, args: [], start: f.start, end: f.start })), f)!;
    // A closure sees the `this` of the body it is written in, which it only reads.
    const enclosing = f.closure && selfOf(f);
    const self = f.closure ? enclosing && { ...enclosing, constructor: false, mutable: false, owned: false } : f.self && { ...f.self, type: viewed ?? f.self.type };
    const captures = instance.captures;

    const { value, read, condition, effect, coerce, result, expect, changesLocal, changesThis, adapt, finish, literalOnly, unsafely } = expressions({
      types, locals, coercions, calls, setters, byName, classes, enums, enumInstance, patterns: instance.patterns, copiesOut: instance.copiesOut, construct, members, returnOf, resultOf, sourcesOf, borrowsFrom: instance.borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup,
      self,
      owner: f.closure ? closureOwner(f) : f.owner && f.owner === f.self?.type ? self!.type : f.owner,
      superCall,
      thisReady,
      proves,
      assume,
      arm: (run) => {
        scopes.push(new Map());
        try {
          return run();
        } finally {
          scopes.pop();
        }
      },
      block: (arm, wanted) => {
        const target: Target = { stmt: arm, kind: "arm", wanted, gives: [] };
        within(target, () => statement(arm));
        if (wanted && !alwaysReturns(arm.body, broken, continued)) {
          throw new CompileError("this arm can reach its end without giving a value; give one with 'return', as in an arrow's block", arm.end - 1, arm.end);
        }
        return target.gives!;
      },
      bind: (name, type, node) => {
        declare(name, type, false, false, node);
        return locals.get(node)!;
      },
      narrowed,
      captured: (l) => captures?.has(l) ?? false,
      raise,
      comptime: <T>(check: () => T): T => {
        comptimeDepth++;
        try {
          return check();
        } finally {
          comptimeDepth--;
        }
      },
      errorOf,
      thrown,
      noteThis,
      closing: f.closure !== undefined,
      generator: f.generator === true,
      runtime: !library && funcs.some((g) => g.name === "main" && g.async === true),
      locked: f.closure?.expected !== undefined && lockCallbacks.has(f.closure.expected),
      sharing: f.closure?.expected !== undefined && sharedCallbacks.has(f.closure.expected),
      async: f.async === true,
      awaitable,
      unsafe: f.closure?.unsafe === true,
      changesCapture,
      reachable: (l) => !caseOnly.has(l),
      rewritten,
      depthOf: (l) => depths.get(l)!,
      closure,
      closureBody: (t) => closureBodies.get(t)!,
      resolveType,
      implicitOf,
      constructs,
      // A candidate meeting another integer type demands it, for the next pass.
      // A closure's capture stands for the variable it captures. The first demand decides,
      // and a different one is the usual mismatch once it applies.
      infer: (e, to) => {
        let local = e.kind === "ident" ? locals.get(e) : undefined;
        for (let at: Instance | undefined = instance; local && at?.captures?.has(local); at = at.body.closure?.parent) {
          const from = at.captures.get(local)!;
          local = from === "this" ? undefined : from;
        }
        const s = local && candidates.get(local);
        if (!s || !isInteger(to) || to === "i64") return false;
        if (demands.has(s)) return demands.get(s) === to;
        demands.set(s, to);
        demanded++;
        return true;
      },
    });

    // A call leaves out only the last parameters, so none may be required after an optional one.
    const late = f.params.find((p, i) => !p.optional && f.params.slice(0, i).some((q) => q.optional));
    if (late) throw new CompileError("a required parameter can't follow an optional one; move it before them, or make it optional too", late.start, late.end);
    // What the function may throw: any value's type.
    const errorType = f.throws && resolveType(f.throws);
    if (errorType === "void") throw new CompileError("a function can't throw 'void'; throw a value", f.throws!.start, f.throws!.end);
    if (errorType && holdsRef(errorType)) throw unsupported("errors holding references", f.throws!);
    instance.throws = errorType;
    const params = f.closure ? f.params.map((p, i) => closureParam(p, i, f.closure!.expected)) : paramTypes(instance, scopeOf(instance));
    f.params.forEach((p, i) => declare(paramName(p), params[i]!, false, true, p));
    // A field initializer runs before the constructor's body, out of reach of its parameters.
    let hidden = false;
    statements(f.body, (s, check) => {
      const assigned = unset.size > 0 ? fieldAssignment(s) : undefined;
      exempt = assigned?.object;
      hidden = f.self?.constructor === true && classOf(f.self.type).initializers.has(s);
      const after = check(s);
      exempt = undefined;
      hidden = false;
      if (assigned) unset.delete(assigned.name);
      if (s.kind === "expr" && s.expr === superCall) unset.delete(SUPER);
      return after;
    });
    finish();
    if (unset.size > 0) {
      const missing = classOf(f.self!.type).fields.find((d) => unset.has(d.name))!;
      throw new CompileError(`property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    if (generator) {
      if (!yielded) throw new CompileError("this generator never yields, so what it gives can't be told; declare it as 'Generator<T>'", (f.returnType ?? f).start, (f.returnType ?? f).end);
      const laid = (t: Type) => (instance.concrete ? lower(t) : t);
      generator.yields = laid(yielded);
      generator.params = f.params.map((p, i) => ({ name: paramName(p), type: laid(params[i]!) }));
    }
    const gives = declared ?? inferred ?? "void";
    // A closure's signature and an async result are kept as written, so a pattern in one would
    // reach the binary.
    if (holdsPattern(gives) && (future || f.closure)) throw unsupported(`template literal pattern types in ${future ? "async results" : "closure results"}`, f.returnType ?? f);
    if (f.closure && params.some(holdsPattern)) throw unsupported("template literal pattern types in closure parameters", f);
    if (future) {
      if (holdsRef(gives)) throw unsupported("async functions giving references", f.returnType ?? f);
      const laid = (t: Type) => (instance.concrete ? lower(t) : t);
      // An inferred result widens as a `let` does: an async `return "x"` gives a string.
      future.gives = laid(f.returnType ? gives : widenLet(gives));
      future.throws = errorType && laid(errorType);
      future.params = f.params.map((p, i) => ({ name: paramName(p), type: laid(params[i]!) }));
      // An async method's future holds its object: borrowed, or owned under `Own<this>`.
      const self = f.self && !f.self.constructor ? receiverField(f.self, laid) : undefined;
      if (self) future.params.unshift(self);
    }
    const type = generator ?? future ?? gives;
    if (f.closure && holdsRef(type)) throw unsupported("closures returning references", f.returnType ?? f.closure.value ?? f);
    if (!f.closure) lifetimes(f);
    // A returned value holding references may point into any parameter, or `this`.
    const everything: Origin[] = [...f.params.map((_, i) => i), ...(f.self && !f.self.owned ? ["this" as const] : [])];
    const origins = isRef(type) ? originsOf(f, params, type) : holdsRef(type) ? heldOrigins(f) ?? everything : [];
    if (gives !== "void" && !generator && !alwaysReturns(f.body, broken, continued)) {
      const at = f.returnType ?? f;
      throw new CompileError("not all code paths return a value", at.start, at.end);
    }
    checkMoves(f, instance, origins);
    // A class's own `clone()` replaces the compiler's copy, so it has to make one.
    if (self && classOf(self.type).methods.get("clone") === f && (f.params.length > 0 || type !== self.type)) {
      throw new CompileError(`a 'clone' method must take no parameters and return '${show(self.type)}', since it replaces the compiler's copy`, f.start, f.end);
    }
    instance.returns = type;
    if (instance.concrete) lowerTables(instance);
    if (generator) frameOf(instance, generator);
    if (future) frameOf(instance, future);
    done.add(instance);
    inProgress.delete(instance);

    // Checks a list of statements in order. What an `if` that leaves early proves holds for
    // the statements after it.
    function statements(list: Stmt[], each = (s: Stmt, check: (s: Stmt) => Facts | undefined) => check(s)) {
      const before = facts.length;
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        siblings = { list, at: i };
        const mark = changed.length;
        const after = each(s, statement);
        if (after) facts.push(current(after, mark));
      }
      facts.length = before;
    }

    // `const [a, b] = t` over a tuple: the tuple goes to a variable of its own, and each name
    // becomes a `const` of its element after it, in the list being checked, so the names own
    // the parts as Rust's `let` does.
    function destructured(s: Extract<Stmt, { kind: "let" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" }>, place: { list: Stmt[]; at: number } | undefined): undefined {
      if (!place || place.list[place.at] !== s) throw unsupported("destructuring patterns here", pattern);
      if (pattern.rest) throw unsupported("rest patterns", pattern.rest);
      const names = pattern.elements.map((p) => {
        if (p !== undefined && p.kind !== "ident") throw unsupported(p.kind === "default" ? "defaults in destructuring patterns" : "nested destructuring patterns", p);
        return p;
      });
      // The tuple's variable is named for the pattern, as messages about it show it.
      const held = `[${names.map((n) => n?.name ?? "").join(", ")}]`;
      Object.assign(d, { target: { kind: "ident", name: held, start: pattern.start, end: pattern.end } });
      statement(s);
      const type = locals.get(s)!.type;
      const tuple = typeof type !== "string" && type.kind === "ref" ? type.to : type;
      if (!isTuple(tuple)) throw new CompileError(`only tuples, like '[i64, string]', can be destructured so far, not '${show(type)}'`, pattern.start, pattern.end);
      const count = (tuple as ObjectType).fields.length;
      if (names.length > count) throw new CompileError(`tuple type '${show(tuple)}' of length ${count} has no element at index ${count}`, pattern.start, pattern.end);
      const lets: Stmt[] = names.flatMap((n, i): Stmt[] => {
        if (!n) return [];
        const at = { start: n.start, end: n.end };
        const element: Expr = { kind: "index", object: { kind: "ident", name: held, ...at }, index: { kind: "int", value: BigInt(i), ...at }, optional: false, ...at };
        return [{ kind: "let", keyword: s.keyword, declarations: [{ target: n, type: undefined, init: element, ...at }], ...at }];
      });
      place.list.splice(place.at + 1, 0, ...lets);
      return undefined;
    }

    // `for (const [k, v] of pairs)` and `for (const { x, y } of points)`: the element goes to a
    // variable named for the pattern, and each name becomes a `const` of its part at the top of
    // the body. A part of a borrowed element is borrowed, or copied when it copies.
    function loopPattern(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>) {
      if (pattern.rest) throw unsupported("rest patterns", pattern.rest);
      const named = (p: Pattern | undefined): Extract<Pattern, { kind: "ident" }> | undefined => {
        if (p !== undefined && p.kind !== "ident") throw unsupported(p.kind === "default" ? "defaults in destructuring patterns" : "nested destructuring patterns", p);
        return p;
      };
      const parts: [Extract<Pattern, { kind: "ident" }>, (from: Expr) => Expr][] = pattern.kind === "array"
        ? pattern.elements.flatMap((p, i) => {
          const n = named(p);
          return n ? [[n, (from: Expr): Expr => ({ kind: "index", object: from, index: { kind: "int", value: BigInt(i), start: n.start, end: n.end }, optional: false, start: n.start, end: n.end })]] : [];
        })
        : pattern.props.map((p) => {
          if (typeof p.key !== "string") throw unsupported("computed keys in destructuring patterns", p);
          const key = p.key;
          return [named(p.value)!, (from: Expr): Expr => ({ kind: "member", object: from, name: key, optional: false, start: p.start, end: p.end })];
        });
      const held = pattern.kind === "array" ? `[${pattern.elements.map((p) => (p?.kind === "ident" ? p.name : "")).join(", ")}]` : `{ ${parts.map(([n]) => n.name).join(", ")} }`;
      const lets: Stmt[] = parts.map(([n, part]) => {
        const at = { start: n.start, end: n.end };
        const declarator: Declarator = { target: n, type: undefined, init: part({ kind: "ident", name: held, ...at }), ...at };
        loopParts.add(declarator);
        return { kind: "let", keyword: (s.left as Extract<Stmt, { kind: "let" }>).keyword, declarations: [declarator], ...at };
      });
      Object.assign(d, { target: { kind: "ident", name: held, start: pattern.start, end: pattern.end } });
      // The loop's own body is a block inside the parts' scope, so it may declare their names.
      const body: Stmt = { kind: "block", body: s.body, start: s.body[0]?.start ?? s.end, end: s.end };
      s.body = [...lets, body];
    }

    // A name a loop's pattern binds: its part of the element, borrowed when the element is.
    function loopPart(s: Extract<Stmt, { kind: "let" }>, d: Declarator): undefined {
      const init = d.init!;
      const object = init.kind === "index" || init.kind === "member" ? init.object : init;
      const whole = value(object);
      const element = isRef(whole) ? whole.to : whole;
      if (init.kind === "index" && !isTuple(element)) throw new CompileError(`only tuples, like '[i64, string]', can be destructured so far, not '${show(element)}'`, d.start, d.end);
      const type = value(init);
      const name = (d.target as Extract<Pattern, { kind: "ident" }>).name;
      // A `let` part may change, or be pointed elsewhere when it is borrowed, as a `let` loop
      // variable may.
      if (isRef(whole) && !isCopy(type)) {
        const lent = refType(type, false);
        coerce(init, type, lent, "");
        declare(name, lent, s.keyword === "let", false, s);
      } else declare(name, type, s.keyword === "let", false, s);
      return undefined;
    }

    // A whole value written through a narrowed `Mut` may be another member, so from here to the
    // end of each narrowing scope it is read as declared. A loop inside such a scope could come
    // back to reads already checked as narrowed.
    function rewritten(l: Local, at: Expr) {
      const outside = captures?.get(l);
      if (outside && outside !== "this" && outer!.narrowed(outside)) {
        throw new CompileError(`can't give '${l.name}' another member inside a closure while a check outside it narrows it; assign its fields instead`, at.start, at.end);
      }
      const from = facts.findIndex((f) => f.has(l));
      if (from < 0) return;
      // Inside a larger expression, a condition could still prove the member it had.
      if (at !== whole) {
        throw new CompileError(`can't give '${l.name}' another member inside a larger expression while a check narrows it; assign it as a statement of its own`, at.start, at.end);
      }
      changed.push(l);
      if (targets.some((t) => t.kind === "loop" && t.facts! > from)) {
        throw new CompileError(`can't give '${l.name}' another member inside a loop here: a check outside the loop narrowed it; assign its fields instead, or check it inside the loop`, at.start, at.end);
      }
      for (let i = from; i < facts.length; i++) facts[i] = new Map(facts[i]).set(l, l.type);
    }

    // Facts proven before a statement that carry past it, less any it gave another member.
    function current(proven: Facts, mark: number): Facts {
      const gone = changed.slice(mark);
      return gone.length === 0 ? proven : new Map([...proven].filter(([l]) => !gone.includes(l)));
    }

    function assume<T>(proven: Facts, check: () => T): T {
      facts.push(proven);
      try {
        return check();
      } finally {
        facts.pop();
      }
    }

    // An arrow function: its own type, and its body checked here, where it is written.
    function closure(e: Arrow, expected?: FunctionType, unsafe = false, owning = false): ClosureType {
      if (e.typeParams.length > 0) throw unsupported("generic arrow functions", e);
      // An async arrow's future usually outlives the call making it, so it owns its captures.
      owning ||= e.async;
      const value = Array.isArray(e.body) ? undefined : e.body;
      const body: Body = {
        name: f.name, params: e.params, returnType: e.returnType, start: e.start, end: e.end, async: e.async || undefined, closure: { value, parent: instance, expected, move: e.move || owning, unsafe },
        body: value ? [{ kind: "return", value, start: value.start, end: value.end }] : (e.body as Stmt[]),
      };
      const inner: Instance = {
        body, symbol: `${instance.symbol}.closure${closures.filter((c) => c.body.closure!.parent === instance).length}`,
        bindings: instance.bindings, concrete: instance.concrete, depth: instance.depth, returns: "void",
        types: new Map(), locals: new Map(), calls: new Map(), setters: new Map(), coercions: new Map(), jumps: new Map(), borrowsFrom: new Map(), raises: new Map(), caught: new Map(), consumes: new Set(), patterns: new Map(), copiesOut: new Set(),
      };
      inner.captures = new Map();
      inner.captureUses = new Map();
      inner.changed = new Set();
      inner.moved = new Set();
      closures.push(inner);
      withSight(inSight, () => checkInstance(inner, { lookup, narrowed, thisReady, noteThis, changesLocal, changesThis, constant, inSight }));
      const sup = [...inner.types.keys()].find((u) => u.kind === "super");
      if (sup) throw unsupported("'super' in closures", sup);
      // A shared value's `update` callback lends its parameter only through its fields.
      if (f.closure?.expected && sharedCallbacks.has(f.closure.expected)) {
        for (const [alias, from] of inner.captures!) {
          const held = from === "this" ? undefined : typeof from.type !== "string" && from.type.kind === "ref" ? from.type.to : from.type;
          if (from !== "this" && from.param && held !== undefined && interiorMutable(held)) {
            const at = inner.captureUses!.get(alias) ?? e;
            throw new CompileError(`a closure inside a shared value's 'update' can't capture '${alias.name}': other tasks borrow its interior-mutable parts without the lock`, at.start, at.end);
          }
        }
      }
      // A closure holds what it moves, or everything under `move`, and borrows the rest; `this`
      // is a reference either way.
      // In an instance, what a type parameter stands for is laid out.
      const laid = (t: Type) => (inner.concrete ? lower(t) : t);
      const fields = [...inner.captures].map(([alias, from]) => ({
        name: alias.name,
        type: laid(from === "this" ? refType(self!.type, inner.changed!.has(alias)) : e.move || owning || inner.moved!.has(alias) ? from.type : refType(from.type, inner.changed!.has(alias))),
      }));
      // Calling an async arrow gives its future, whose frame holds a copy of what it captured.
      const type = closureType(e.params.map(paramName), e.params.map((p) => inner.locals.get(p)!.type), inner.future ?? inner.returns, fields, [...inner.moved!][0]?.name, inner.concrete);
      // Each call's future works on its own copy of the captures, so a change would be lost.
      const changed = e.async ? [...inner.changed!][0] : undefined;
      if (changed) {
        const at = inner.captureUses!.get(changed) ?? e;
        throw new CompileError(`this async arrow changes '${changed.name}', which it captured, but each call's future works on its own copy, so the change would be lost; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
      }
      // Its future holds the captures as it holds parameters, for what crosses threads.
      if (inner.future) {
        inner.future.frame[1] = { name: "env", type };
        inner.future.params = [{ name: "env", type }, ...inner.future.params];
      }
      inner.closure = type;
      calls.set(e, inner);
      closureBodies.set(type, inner);
      return type;
    }

    // A parameter's type is written, or else the one the function type the closure meets gives.
    function closureParam(p: Param, i: number, expected: FunctionType | undefined): Type {
      const given = expected?.params[i];
      if (expected && !given && !p.type) {
        const n = expected.params.length;
        throw new CompileError(`'${show(expected)}' passes ${n} argument${n === 1 ? "" : "s"}, so this closure can't take '${paramName(p)}'`, p.start, p.end);
      }
      if (p.comptime) throw unsupported("comptime parameters on closures", p);
      const plain = !p.rest && !p.optional && !p.default && p.modifiers.length === 0 && p.decorators.length === 0 && paramName(p) !== "this";
      const type = !p.type && given && plain ? given : paramType(p);
      const to = isRef(type) ? type.to : type;
      if (typeof to !== "string" && to.kind === "interface") throw unsupported("closure parameters of interface types", p);
      return type;
    }

    function statement(s: Stmt): Facts | undefined {
      const declaration = unsupportedDeclaration(s);
      if (declaration) throw declaration;
      switch (s.kind) {
        case "expr":
          whole = s.expr;
          // `yield* g` gives each value `g` gives, as `for (const % of g) yield %;` does.
          if (s.expr.kind === "yield" && s.expr.delegate && generator && s.expr.value) {
            const { value, start, end } = s.expr;
            const topic = { kind: "ident" as const, name: "%", start, end };
            const each: Stmt = { kind: "let", keyword: "const", declarations: [{ target: topic, type: undefined, init: undefined, start, end }], start, end };
            const body: Stmt[] = [{ kind: "expr", expr: { kind: "yield", value: { ...topic }, delegate: false, start, end }, start, end }];
            Object.assign(s, { kind: "forOf", await: false, left: each, right: value, body });
            delete (s as { expr?: unknown }).expr;
            return statement(s);
          }
          if (s.expr.kind === "yield") {
            yielding(s.expr);
            return;
          }
          if (isAwait(s.expr)) awaiting(s.expr);
          if (s.expr.kind === "assign" && isAwait(s.expr.value)) {
            // The target is found after the await resumes, so it must be one that can be.
            let root: Expr = s.expr.target;
            while (root.kind === "member") root = root.object;
            if (s.expr.op !== "=" || (root.kind !== "ident" && root.kind !== "this")) {
              throw new CompileError("'await' can only be assigned with '=' to a variable or a field for now; await into a 'const' first, then use it", s.expr.start, s.expr.end);
            }
            awaiting(s.expr.value);
          }
          effect(s.expr);
          // A promise runs only when awaited, so one made and dropped would silently do nothing.
          const pausing = s.expr.kind === "call" && s.expr.callee.kind === "ident" && ["yieldNow", "sleep"].includes(s.expr.callee.name) && !byName.has(s.expr.callee.name);
          const made = pausing ? YIELD_NOW : types.get(s.expr) ?? calls.get(s.expr)?.returns;
          const boxed = typeof made !== "string" && made?.kind === "dyn" && promiseElement(made.of) !== undefined;
          if (s.expr.kind !== "assign" && s.expr.kind !== "destructure" && typeof made !== "string" && (made?.kind === "future" || boxed)) {
            throw new CompileError("this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'", s.expr.start, s.expr.end);
          }
          return;
        case "let": {
          if (s.keyword === "var") throw new CompileError("'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
          if (s.declarations.length > 1) throw unsupported("declarations of several variables at once", s);
          const d = s.declarations[0]!;
          if (d.target.kind === "array") return destructured(s, d, d.target, siblings);
          if (loopParts.has(d)) return loopPart(s, d);
          if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (!d.init) throw unsupported("declarations without an initializer", d);
          if (isAwait(d.init)) awaiting(d.init);
          // A function type there makes the variable a stored callable.
          const annotated = (d.type && stored(resolveType(d.type))) || demands.get(s);
          if (annotated) expect(d.init, annotated);
          const type = value(d.init);
          if (annotated) coerce(d.init, type, annotated, `type '${show(type)}' is not assignable to type '${show(annotated)}'`);
          // An interface describes the value, which keeps its own concrete type.
          // A `let` may later hold another member of an enum, so it holds the enum.
          const widened = s.keyword === "let" && !annotated ? widenLet(type) : type;
          if (widened !== type) coerce(d.init, type, widened, "");
          if (!annotated && typeof widened !== "string" && widened.kind === "array" && widened.element === "never") {
            throw new CompileError(`an empty array needs a type to say what it will hold, like 'let ${d.target.name}: string[] = []'`, d.init.start, d.init.end);
          }
          const describes = annotated && isInterface(annotated);
          declare(d.target.name, annotated && !describes ? annotated : widened, s.keyword === "let", false, s);
          if (s.keyword === "let" && !annotated && type === "i64" && literalOnly(d.init, false)) candidates.set(locals.get(s)!, s);
          return;
        }
        case "if": {
          condition(s.cond);
          const proven = proves(s.cond);
          assume(proven.yes, () => scoped(s.then));
          if (s.else) assume(proven.no, () => scoped(s.else!));
          // A branch that never reaches its end leaves the other's facts for what follows.
          const [thenLeaves, elseLeaves] = [leaves(s.then), s.else ? leaves(s.else) : false];
          if (thenLeaves && !elseLeaves) return proven.no;
          if (elseLeaves && !thenLeaves) return proven.yes;
          return undefined;
        }
        case "while":
          condition(s.cond);
          within({ stmt: s, kind: "loop" }, () => assume(proves(s.cond).yes, () => scoped(s.body)));
          return;
        case "function":
          throw unsupported("nested functions", s);
        // Checked as the code it is; it runs while compiling, where its locals are its own.
        case "comptime":
          comptimeDepth++;
          floors.push(targets.length);
          scoped(s.body);
          floors.pop();
          comptimeDepth--;
          return;
        case "block":
          scoped(s.body);
          return;
        case "unsafe":
          unsafely(() => scoped(s.body));
          return;
        case "debugger":
          throw unsupported("'debugger' statements", s);
        case "empty":
          return;
        case "for":
          // A name declared in the head is scoped to the loop.
          scopes.push(new Map());
          if (s.init) statement(s.init);
          if (s.test) condition(s.test);
          if (s.update) effect(s.update);
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          scopes.pop();
          return;
        case "forIn":
          throw unsupported("'for...in' loops", s);
        // `for (const x of arr)` borrows each element, shared, or copies a Copy one.
        case "forOf": {
          if (s.await) throw unsupported("'for await...of' loops", s);
          const left = s.left;
          if (left.kind !== "let" || left.keyword === "var") throw unsupported("'for...of' loops over a variable declared outside them", left);
          const d = left.declarations[0]!;
          if (left.declarations.length === 1 && (d.target.kind === "array" || d.target.kind === "object")) loopPattern(s, d, d.target);
          if (left.declarations.length > 1 || d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (d.type) throw new CompileError("a 'for...of' variable can't have a type annotation; its type comes from what it loops over", d.type.start, d.type.end);
          const through = value(s.right);
          const object = isRef(through) ? through.to : through;
          // A string gives each of its code points, as a string of its own.
          if (stringLike(object)) {
            if (through !== "string") coercions.set(s.right, "string");
            scopes.push(new Map());
            declare(d.target.name, "string", left.keyword === "let", false, left);
            within({ stmt: s, kind: "loop" }, () => scoped(s.body));
            scopes.pop();
            return;
          }
          // A generator gives each value it yields, owned. Like JavaScript closing it when the
          // loop ends, the loop takes an owned generator over; one behind a `Mut` is lent.
          const yields = yieldsOf(object);
          if (yields !== undefined) {
            if (isRef(through) && !through.mutable) throw new CompileError("a 'for...of' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
            scopes.push(new Map());
            declare(d.target.name, yields, left.keyword === "let", false, left);
            within({ stmt: s, kind: "loop" }, () => scoped(s.body));
            scopes.pop();
            return;
          }
          // A fixed array's elements, as an array's: borrowed, or copies when they copy.
          if (typeof object !== "string" && object.kind === "fixed") {
            scopes.push(new Map());
            declare(d.target.name, isCopy(object.element) ? object.element : refType(object.element, false), left.keyword === "let", false, left);
            within({ stmt: s, kind: "loop" }, () => scoped(s.body));
            scopes.pop();
            return;
          }
          if (typeof object === "string" || object.kind !== "array") throw new CompileError(`'for...of' needs an array, a string or a generator, not '${show(object)}'`, s.right.start, s.right.end);
          if (object !== through) coercions.set(s.right, object);
          scopes.push(new Map());
          declare(d.target.name, isCopy(object.element) ? object.element : refType(object.element, false), left.keyword === "let", false, left);
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          scopes.pop();
          return;
        }
        case "doWhile":
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          condition(s.cond);
          return;
        case "switch": {
          const type = read(s.discriminant);
          const union = typeof type !== "string" && type.kind === "union" ? type : undefined;
          if (typeof type !== "string" && !union && type.kind !== "literal") throw unsupported("comparisons of objects", s.discriminant);
          const defaults = s.cases.filter((c) => !c.test);
          if (defaults.length > 1) throw new CompileError("a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
          // The case bodies share one scope, as in JavaScript, but any case may be entered
          // directly, skipping the bodies before it, so a binding one case declares is usable
          // only in that case.
          const shared = new Map<string, Local>();
          scopes.push(shared);
          within({ stmt: s, kind: "switch" }, () => {
            // A case narrows a union for its body, and so do the cases that fall through into it.
            // `falling` is what holds for a body the previous one falls into, or null when it leaves.
            let falling: Facts | null = null;
            for (const c of s.cases) {
              const before = new Set(shared.values());
              let test = c.test && value(c.test);
              // A literal case takes the discriminant's type, or its union's one number type.
              const numbers = union ? union.members.filter(isNumeric) : [type];
              if (test && test !== type && numbers.length === 1 && adapt(c.test!, numbers[0]!)) test = numbers[0]!;
              // A discriminant whose type is still open takes an integer case's.
              if (test && test !== type && isInteger(test) && !literalOnly(s.discriminant, false) && adapt(s.discriminant, test)) test = type;
              if (test && objectsMeet(type, test)) throw unsupported("comparisons of objects", c.test!);
              if (test && test !== type && !comparable(type, test)) {
                throw new CompileError(`type '${show(test)}' is not comparable to type '${show(type)}'`, c.test!.start, c.test!.end);
              }
              const tested: Facts = c.test ? proves({ kind: "binary", op: "===", left: s.discriminant, right: c.test, start: c.start, end: c.end }).yes : new Map();
              const reaching: Facts = falling ? either(falling, tested) : tested;
              const mark = changed.length;
              assume(reaching, () => statements(c.body));
              for (const local of shared.values()) if (!before.has(local)) caseOnly.add(local);
              falling = leaves(c.body) ? null : current(reaching, mark);
            }
          });
          scopes.pop();
          return;
        }
        case "labeled": {
          if (targets.some((t) => t.label === s.label)) {
            throw new CompileError(`duplicate label '${s.label}'`, s.start, s.start + s.label.length);
          }
          let body = s.body;
          while (body.kind === "labeled") body = body.body;
          const loop = ["while", "doWhile", "for", "forIn", "forOf"].includes(body.kind) ? body : undefined;
          within({ stmt: s, kind: "label", label: s.label, loop }, () => statement(s.body));
          return;
        }
        case "break":
        case "continue": {
          const target = jumpTarget(s);
          if (floors.length > 0 && targets.findIndex((t) => t.stmt === target) < floors.at(-1)!) {
            throw new CompileError(`'${s.kind}' can't leave a comptime block, which runs while compiling, before the program does`, s.start, s.end);
          }
          jumps.set(s, target);
          (s.kind === "break" ? broken : continued).add(target);
          return;
        }
        case "throw":
          thrown(s, s.value);
          return;
        case "try": {
          // Without a catch, what the block raises goes on out, after the `finally`.
          if (!s.handler) {
            finalizing++;
            scoped(s.block);
            scoped(s.finalizer!);
            finalizing--;
            return;
          }
          if (s.finalizer) finalizing++;
          if (s.paramType) throw new CompileError("a catch parameter takes no type annotation: its type is what the 'try' can throw", s.paramType.start, s.paramType.end);
          // What the block raises goes to the catch, which takes the union of it.
          handlers.push([]);
          scoped(s.block);
          const sites = handlers.pop()!;
          if (sites.length === 0) throw new CompileError("nothing in this 'try' can throw, so its 'catch' never runs; remove the try/catch", s.start, s.start + 3);
          const caught = unionType(sites.map(([, t]) => t));
          for (const [at, from] of sites) instance.raises.set(at, { from, to: caught });
          instance.caught.set(s, caught);
          scopes.push(new Map());
          if (s.param) {
            if (s.param.kind !== "ident") throw unsupported("destructuring patterns", s.param);
            declare(s.param.name, caught, true, false, s);
          }
          statements(s.handler!);
          scopes.pop();
          if (s.finalizer) {
            scoped(s.finalizer);
            finalizing--;
          }
          return;
        }
        case "return": {
          // A `return` in a match arm gives the arm its value, and never leaves the function.
          const arm = targets.findLast((t) => t.kind === "arm");
          if (floors.length > 0 && (!arm || targets.indexOf(arm) < floors.at(-1)!)) {
            throw new CompileError("'return' can't leave a comptime block, which runs while compiling; give a value with a 'comptime' expression instead", s.start, s.end);
          }
          if (arm) {
            jumps.set(s, arm.stmt);
            if (arm.wanted && !s.value) throw new CompileError("this match gives a value, so a 'return' in its arm needs one", s.start, s.end);
            // In TypeScript this would leave the function, which a return in an arm never does.
            if (!arm.wanted && s.value) {
              throw new CompileError("this match's value isn't used, so a 'return' in its arm can't give one, and it never leaves the function; return after the match instead", s.start, s.end);
            }
            if (s.value) arm.gives!.push([s.value, arm.wanted ? value(s.value) : result(s.value)]);
            return;
          }
          if (generator) {
            if (s.value) throw new CompileError("a generator can't return a value yet; 'return;' ends it", s.value.start, s.value.end);
            return;
          }
          if (s.value && isAwait(s.value)) awaiting(s.value);
          if (f.self?.constructor && s.value) throw new CompileError("a constructor can't return a value", s.start, s.end);
          if (unset.size > 0) throw new CompileError("a constructor can't return before every field is assigned", s.start, s.end);
          if (declared && s.value) expect(s.value, declared);
          // An arrow's expression body may be a call returning nothing.
          const type = !s.value ? "void" : s.value === f.closure?.value && (s.value.kind === "call" || s.value.kind === "tagged") ? result(s.value) : value(s.value);
          // A closure returned is boxed into the callable the function declares.
          if (typeof type !== "string" && type.kind === "closure" && (typeof declared === "string" || declared?.kind !== "dyn")) throw unsupported("functions returned without a function return type", s.value!);
          const expected = declared ?? inferred;
          const message = `type '${show(type)}' is not assignable to return type '${show(expected ?? type)}'`;
          if (expected && s.value) coerce(s.value, type, expected, message);
          else if (expected && type !== expected) throw new CompileError(message, s.start, s.end);
          const reason = trait && unsatisfied(type, trait, members, s.value ?? s);
          if (reason) throw new CompileError(`type '${show(type)}' is not assignable to return type '${trait!.name}': ${reason}`, (s.value ?? s).start, (s.value ?? s).end);
          inferred = expected ?? type;
          return;
        }
      }
    }

    // The `this.x` a statement assigns, when it is a plain assignment to one of the class's
    // own fields. A setter is a method, which can't run until every field is set.
    // `yield v;`: the generator gives `v` and stops until `next()` is called again. It runs as
    // a statement of its own, so nothing the statement made is pending across it.
    function yielding(e: Extract<Expr, { kind: "yield" }>) {
      if (!generator) throw new CompileError("'yield' can only be used inside a 'function*'", e.start, e.end);
      if (targets.some((t) => t.kind === "arm")) throw unsupported("'yield' inside match arms", e);
      if (finalizing > 0) throw unsupported("'yield' statements in a 'try' with a 'finally'", e);
      if (e.delegate) throw unsupported("'yield*'", e);
      if (!e.value) throw new CompileError("a generator's 'yield' gives a value, like 'yield x;'", e.start, e.end);
      if (yielded) expect(e.value, yielded);
      const t = value(e.value);
      if (!yielded) yielded = widenLet(t);
      if (holdsRef(yielded)) throw unsupported("generators yielding references", e.value);
      coerce(e.value, t, yielded, `type '${show(t)}' is not assignable to the generator's 'Generator<${show(yielded)}>'`);
    }

    // An `await` written as a statement of its own, or as all of a declaration's initializer,
    // an assignment's value or a return's: one the state machine can stop at with nothing else
    // of the statement pending.
    function awaiting(e: Expr) {
      if (!future) return;
      if (targets.some((t) => t.kind === "arm")) throw unsupported("'await' inside match arms", e);
      if (finalizing > 0) throw unsupported("'await' statements in a 'try' with a 'finally'", e);
      awaitable.add(e);
    }

    function fieldAssignment(s: Stmt): Extract<Expr, { kind: "member" }> | undefined {
      if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
      const target = s.expr.target;
      if (target.kind !== "member" || target.object.kind !== "this") return undefined;
      return classOf(f.self!.type).fields.some((d) => d.name === target.name) ? target : undefined;
    }

    function within(target: Target, check: () => void) {
      target.facts = facts.length;
      targets.push(target);
      check();
      targets.pop();
    }

    function jumpTarget(s: Jump): Stmt {
      const fits = (t: Target) => (s.label === undefined ? t.kind === "loop" || (s.kind === "break" && t.kind === "switch") : t.label === s.label);
      const found = targets.findLast((t) => t.kind === "arm" || fits(t));
      // A match arm is a body of its own, as an arrow's is.
      if (found?.kind === "arm" && targets.some(fits)) {
        throw new CompileError(`'${s.kind}' can't leave a match arm, which is a body of its own like an arrow's; 'return' a value and act on it after the match`, s.start, s.end);
      }
      const target = found?.kind === "arm" ? undefined : found;
      if (s.label === undefined) {
        if (target) return target.stmt;
        const message = s.kind === "break" ? "'break' can only be used inside a loop or 'switch'" : "'continue' can only be used inside a loop";
        throw new CompileError(message, s.start, s.end);
      }
      if (!target) throw new CompileError(`cannot find label '${s.label}'`, s.start, s.end);
      if (s.kind === "break") return target.stmt;
      if (!target.loop) throw new CompileError("'continue' can only jump to a label on a loop", s.start, s.end);
      return target.loop;
    }

    // Whether control never reaches the end of these statements, leaving by `return`, `break`
    // or `continue`.
    function leaves(stmts: Stmt[]): boolean {
      const last = stmts.at(-1);
      return alwaysReturns(stmts, broken, continued) || last?.kind === "break" || last?.kind === "continue";
    }

    function scoped(stmts: Stmt[]) {
      scopes.push(new Map());
      statements(stmts);
      scopes.pop();
    }

    function declare(name: string, type: Type, mutable: boolean, param: boolean, node: Stmt | Param | Expr) {
      const scope = scopes[scopes.length - 1]!;
      // A destructuring's own variable, named for its pattern, may repeat; nothing names it.
      if (scope.has(name) && !name.startsWith("[") && !name.startsWith("{")) throw new CompileError(`cannot redeclare '${name}' in the same scope`, node.start, node.end);
      const local = { name, type, mutable, param, id: nextId++ };
      depths.set(local, scopes.length);
      scope.set(name, local);
      locals.set(node, local);
    }

    function lookup(name: string, at?: Expr | ObjectProp): Local | undefined {
      for (let i = scopes.length - 1; i >= (hidden ? 1 : 0); i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      const outside = outer?.lookup(name, at);
      return outside && capture(outside, at);
    }

    // Whether `this` may be used: a constructor's can't until every field is assigned, nor can
    // a closure's made before then.
    function thisReady(e: Expr): boolean {
      return outer ? outer.thisReady(e) : unset.size === 0 || e === exempt;
    }

    // A closure changing what it captures captures it mutably, if it may change where the
    // closure is made.
    function changesCapture(l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean) {
      const alias = l ?? [...captures!].find(([, from]) => from === "this")![0];
      const from = captures!.get(alias)!;
      instance.changed!.add(alias);
      if (from === "this") outer!.changesThis(path, action, target);
      // What a `move` closure holds is its own to change, unless the change goes through a
      // mutable reference it holds a copy of; as in Rust, only a copy of a `let` may change.
      else if (f.closure!.move && !(isRef(from.type) && (path || throughMut))) {
        if (outer!.constant(from)) {
          throw new CompileError(`cannot ${action} '${from.name}${path}' in this closure because '${from.name}' is a constant; declare it with 'let'`, target.start, target.end);
        }
        return;
      }
      else {
        if (!path && action === "assign to" && isRef(from.type) && !from.type.mutable) throw unsupported("closures that point captured references elsewhere", target);
        outer!.changesLocal(from, path, action, target, throughMut);
      }
    }

    function constant(l: Local): boolean {
      const from = captures?.get(l);
      if (from && from !== "this") return outer!.constant(from);
      return !l.mutable || l.param;
    }

    // `throw` returns an error of the type the function declares, or goes to a catch. A value
    // the error type takes is converted to it; another may be wrapped.
    function thrown(at: Expr | Stmt, thrownValue: Expr) {
      const type = value(thrownValue);
      const into = errorType && handlers.length === 0 && (fits(type, errorType) || adapt(thrownValue, errorType));
      if (into) coerce(thrownValue, type, errorType!, `type '${show(type)}' can't be thrown here: '${f.name}' throws '${show(errorType)}'`);
      raise(at, into ? errorType! : types.get(thrownValue)!, "'throw'");
    }

    // An error raised by a call or a `throw` goes to the function's caller, which needs a
    // `throws` clause it fits.
    function raise(at: Expr | Stmt, type: Type, what: string) {
      if (holdsRef(type)) throw unsupported("errors holding references", at);
      const handler = handlers.at(-1);
      if (handler) return void handler.push([at, type]);
      // An error comptime code doesn't catch is a compile error where it runs, so it may throw any.
      if (f.comptime || comptimeDepth > 0) return;
      if (f.closure) throw unsupported("closures that throw", at);
      if (!errorType) {
        const does = "kind" in at && at.kind === "throw" ? "to throw here" : `since ${what} can throw '${show(type)}'`;
        throw new CompileError(`'${f.name}' must declare 'throws ${show(type)}' after its return type ${does}, or catch it with try/catch`, at.start, at.end);
      }
      if (fits(type, errorType)) return void instance.raises.set(at, { from: type, to: errorType });
      // An error the declared type doesn't take may be wrapped by a class of it that
      // implements `From` for it.
      const classes = (typeof errorType !== "string" && errorType.kind === "union" ? errorType.members : [errorType])
        .filter((m): m is ClassType => typeof m !== "string" && m.kind === "class");
      const wrappers = classes.flatMap((c) => wrapsOf(classOf(c)).filter(([x]) => fits(type, x)).map(([, body, param]) => ({ wrapper: c, param, via: instanceOf(body) })));
      const does = "kind" in at && at.kind === "throw" ? `this 'throw' throws '${show(type)}'` : `${what} can throw '${show(type)}'`;
      if (wrappers.length === 0) {
        const hint = classes.length > 0 ? `convert it, or have '${classes[0]!.name}' implement 'From<${show(type)}>'` : `convert it to '${show(errorType)}'`;
        throw new CompileError(`${does}, which isn't the '${show(errorType)}' that '${f.name}' throws; ${hint}`, at.start, at.end);
      }
      if (wrappers.length > 1) {
        throw new CompileError(`${does}, which ${wrappers.map((w) => `'${w.wrapper.name}'`).join(" and ")} both wrap; throw one of them yourself`, at.start, at.end);
      }
      instance.raises.set(at, { from: type, to: errorType, ...wrappers[0]! });
    }

    function noteThis(e: Expr) {
      if (!captures || [...captures.values()].includes("this")) return;
      const alias: Local = { name: "this", type: self!.type, mutable: false, param: false, id: nextId++ };
      captures.set(alias, "this");
      instance.captureUses!.set(alias, e);
      outer!.noteThis(e);
    }

    // Who a closure's body counts as for access to private members: its function's class.
    function closureOwner(b: Body): Body["owner"] {
      let outerBody = b;
      while (outerBody.closure) outerBody = outerBody.closure.parent.body;
      return outerBody.owner && outerBody.owner === enclosing?.type ? self!.type : outerBody.owner;
    }

    // A variable's type where something narrowed it: a captured one as it was where the closure
    // was made.
    function narrowed(l: Local): Type | undefined {
      const outside = captures?.get(l);
      return facts.findLast((f) => f.has(l))?.get(l) ?? (outside && outside !== "this" ? outer!.narrowed(outside) : undefined);
    }

    // A closure's body reads a variable it captures through a binding of its own, standing
    // for it.
    function capture(from: Local, at?: Expr | ObjectProp): Local {
      let alias = [...captures!].find(([, l]) => l === from)?.[0];
      if (!alias) {
        alias = { name: from.name, type: from.type, mutable: false, param: false, id: nextId++ };
        depths.set(alias, 0);
        captures!.set(alias, from);
      }
      if (at && !instance.captureUses!.has(alias)) instance.captureUses!.set(alias, at);
      return alias;
    }
  }

}

// The `this` a body sees: a closure's is that of the function it is written in.
export function selfOf(f: Body): Body["self"] {
  return f.closure ? selfOf(f.closure.parent.body) : f.self;
}

// Stands for the base in a derived constructor's unset fields until `super(...)` runs.
const SUPER = "super()";

const isInterface = (t: Type) => typeof t !== "string" && t.kind === "interface";

const isRef = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

// What a returned reference borrows from: a parameter, by index, or `this`.
export type Origin = number | "this";

const hasBody = (f: Declared): f is Func => f.body !== undefined;

