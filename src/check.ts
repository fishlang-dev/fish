import { declareClass, extend, inherited, isLifetime, separatePrivateNames, type Body, type ClassInfo } from "./classes.ts";
import { crossingOf, rustClassOf } from "./rust.ts";
import { newTables, type Compilation, type Tables } from "./compilation.ts";
import { CompileError, CompileErrors, named } from "./diag.ts";
import { warnings } from "./warnings.ts";
import { STD_BASE, STD_INTERNAL, stdFor } from "./std.ts";
import { FILE_SPAN } from "./modules.ts";
import { comptimeArgument, comptimeBody, comptimeChecks, stringsType, untagged, type Value } from "./comptime.ts";
import type { ClassNode, Declarator, Expr, Func as Declared, Id, Interface, ObjectProp, Param, Pattern, PatternProp, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { lowerPattern, type PatternInfo } from "./match.ts";
import { nextId, NodeMap, NodeSet, WeakNodeMap, renumber, type Ids } from "./nodes.ts";

type Arrow = Extract<Expr, { kind: "arrow" }>;
import { alwaysReturns, assignedNames } from "./flow.ts";
import { declareEnum, type EnumInfo } from "./enums.ts";
import { either, guard, type Facts } from "./narrow.ts";
import { comparable, objectsMeet } from "./unions.ts";
import { comptimeName, infer, genericClasses, instancing, typeParamsOf } from "./generics.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { registry } from "./registry.ts";
import { addAlias, paramName, resolver, tagStrings, typeName } from "./resolve.ts";
import { openParam } from "./typefns.ts";
import { lowerDefaults, writtenName } from "./defaults.ts";
import { ANY_REGEX, allFields, holdsPart, isPlainJs, elementsOf, isTuple, type ObjectType, field, interiorMutable, YIELD_NOW, type FutureType, optionRef, isCopy, type Field, type GeneratorType, widenLet, isInteger, isNumeric, widenEnum, type ClassType, type ClosureType, type FunctionType, type Integer, type RefType, type Type, type Typing } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { hoistLocals } from "./locals.ts";
import { lowerOverloads } from "./overloads.ts";
import { checkMoves } from "./moves.ts";
import { NATIVE } from "./native.ts";
import { MATH_RUNTIME } from "./mathlib.ts";
import { RUNTIME } from "./runtime.ts";
import { expressions, stringLike, type DynTable } from "./values.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

// A local generic function's name stands for the function it was lifted to, `generic`.
export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: number; generic?: Func };

// Every function to compile: the top-level ones, then each class's constructor and methods.
// A checked program: the functions to compile, the tables its check filled in, and the
// compilation it was checked in.
// `warnings`: what the build reports without failing, in source order.
export type Checked = { instances: Instance[]; tables: Tables; compilation: Compilation; warnings: CompileError[] };

// One compiled function: a body checked with concrete types, and the tables codegen reads
// to lower it. `symbol` names it in the IR.
export type Instance = {
  body: Body;
  symbol: string;
  // The tables of the check that made it.
  tables: Tables;
  // What a generic body's type parameters stand for in this instance. An instance holding a
  // type parameter is the definition check, which is never compiled.
  bindings: Map<string, Type>;
  concrete: boolean;
  // How many generic instantiations led to this one, which bounds instantiations that never end.
  depth: number;
  // Its return type, written or inferred.
  returns: Type;
  // Every value expression's type.
  types: NodeMap<Expr, Type>;
  // Each `JSON.stringify` argument's type before lowering, which keeps how fields were spelled.
  spelled?: NodeMap<Expr, Type>;
  // The binding each name use, declaration, parameter and shorthand property refers to,
  // after shadowing.
  locals: NodeMap<Expr | Stmt | Param | ObjectProp, Local>;
  // The function each call of a user function or method runs, and the getter each read of
  // an accessor runs.
  calls: NodeMap<Expr, Instance>;
  // The setter each assignment to an accessor runs.
  setters: NodeMap<Expr, Instance>;
  // Each expression whose value meets a narrower declared type, and the type it is copied
  // down to.
  coercions: NodeMap<Expr, Type>;
  // The loop, switch or labeled statement each `break` leaves and each `continue` repeats.
  jumps: NodeMap<Stmt, Stmt>;
  // The arguments, or the receiver, each call returning a reference borrows from.
  borrowsFrom: NodeMap<Expr, Expr[]>;
  // The error type a `throws` clause declares.
  throws?: Type;
  // Each fallible call and `throw`, the error it raises, and the error type that error
  // becomes where it goes: the function's own, which returns it.
  // An error the function's type doesn't take is first wrapped by a class's static `from`.
  raises: NodeMap<Expr | Stmt, { from: Type; to: Type; wrapper?: ClassType; param?: Type; via?: Instance }>;
  // The type of what each `try` catches.
  caught: NodeMap<Stmt, Type>;
  // Each place whose value is handed over rather than copied, which leaves it empty.
  consumes: NodeSet<Expr | ObjectProp>;
  // What each match pattern tests, and the type of the value it meets.
  patterns: NodeMap<Pattern, PatternInfo>;
  // Each read of a shared value's plain field: a copy made under its lock, not a place.
  copiesOut: NodeSet<Expr>;
  // For a closure: the binding standing in its body for each variable it captures, and that
  // variable, or `this`, in the body it is written in, in the order its environment holds them;
  // and where it, or a closure inside it, first uses each.
  captures?: Map<Local, Local | "this">;
  captureUses?: Map<Local, Expr | ObjectProp>;
  // The captures it changes, which it captures mutably, and those it moves out of itself.
  changed?: Set<Local>;
  moved?: Set<Local>;
  // Each call or use as a value of a nested function by name, the function, and this body's
  // bindings for what it captures, in its environment's order, from which the call or the
  // value builds it.
  envs?: NodeMap<Expr, { of: Instance; env: Local[] }>;
  // What each value boxed into a Dyn runs for the interface's members.
  dyns?: NodeMap<Expr, DynTable>;
  // Each closure owning what it captures that holds nested functions as made where it is, and
  // this body's bindings for what each of those uses, which the closure borrows.
  made?: NodeMap<Expr, { of: Instance; env: Local[] }[]>;
  // Each call of a type predicate that narrows its argument: the predicate's type, and whether
  // its true and its false answers narrow, which codegen checks against the argument's tag.
  predicates?: NodeMap<Expr, { index: number; type: Type; yes: boolean; no: boolean }>;
  // A closure's own type.
  closure?: ClosureType;
  // A C function's parameter types, for its declaration.
  signature?: Type[];
  // An async function's own future, which calling it gives.
  future?: FutureType;
  // A generator's own type, which calling it gives, and where each variable and each
  // `for...of` loop's state lives in its frame.
  generator?: GeneratorType;
  frame?: { locals: Map<Local, number>; loops: NodeMap<Stmt, number>; awaits: NodeMap<Expr, number> };
};

// What a closure's body sees of the body it is written in, as it is where the closure is made.
type Outer = {
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  // The binding a name refers to, without capturing it.
  peek(name: string): Local | undefined;
  // The names of the bindings in scope, for suggesting one.
  inScope(): string[];
  // This body's binding for a variable of a body around it, capturing it if need be.
  reach(l: Local, at?: Expr | ObjectProp): Local;
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

// The names a pattern binds.
function namesIn(p: Pattern): string[] {
  if (p.kind === "ident") return [p.name];
  if (p.kind === "default") return namesIn(p.target);
  if (p.kind === "object") return [...p.props.flatMap((q) => namesIn(q.value)), ...(p.rest ? namesIn(p.rest) : [])];
  if (p.kind === "array") return [...p.elements.flatMap((e) => (e ? namesIn(e) : [])), ...(p.rest ? namesIn(p.rest) : [])];
  return [];
}

// The names a function's body uses that its parameters and its body's own top-level declarations
// don't give. A name declared only in an inner block may still mean an outer variable elsewhere,
// so it stays a use.
function freeNames(fn: Extract<Stmt, { kind: "function" }>): Set<string> {
  const top = (fn.body ?? []).flatMap((s) => (s.kind === "let" ? s.declarations.flatMap((d) => namesIn(d.target)) : s.kind === "function" ? [s.name] : []));
  const own = new Set([...fn.params.flatMap((p) => namesIn(p.pattern)), ...top]);
  return new Set([...identifiers(fn.body)].filter((n) => !own.has(n)));
}

// Every name written in a piece of syntax.
function identifiers(node: unknown, found: Set<string> = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const x of node) identifiers(x, found);
  else if (node && typeof node === "object") {
    const n = node as { kind?: string; name?: unknown };
    // A shorthand property `{ x }` reads `x` too.
    if ((n.kind === "ident" || n.kind === "shorthand") && typeof n.name === "string") found.add(n.name);
    for (const v of Object.values(node)) if (v && typeof v === "object") identifiers(v, found);
  }
  return found;
}

// A pattern as written, roughly, naming the variable that holds the value it destructures.
function patternText(p: Pattern): string {
  const rest = (r: Pattern | undefined) => (r ? [`...${patternText(r)}`] : []);
  if (p.kind === "ident") return p.name;
  if (p.kind === "default") return patternText(p.target);
  if (p.kind === "object") {
    const props = p.props.map((q) => (q.value.kind === "ident" && q.value.name === q.key ? q.value.name : `${String(q.key)}: ${patternText(q.value)}`));
    return `{ ${[...props, ...rest(p.rest)].join(", ")} }`;
  }
  if (p.kind === "array") return `[${[...p.elements.map((e) => (e ? patternText(e) : "")), ...rest(p.rest)].join(", ")}]`;
  return "_";
}

// What a loop keeps of what it iterates over. An array it borrows is kept as a view with the
// array's layout that owns nothing, so dropping the frame leaves the array to its owner, and
// moving the generator doesn't leave a pointer to the frame behind.
function iterated(instance: Instance, e: Expr): Type {
  const { refType, objectType } = instance.tables.typing;
  const type = instance.coercions.get(e) ?? instance.types.get(e)!;
  // A fixed array it borrows is kept as a pointer to where it lives.
  if (typeof type !== "string" && type.kind === "fixed" && plainPlace(instance, e)) return refType(type, false);
  // A Map or a Set it borrows is kept as its table's pointer, owning nothing.
  if (typeof type !== "string" && type.kind === "map") return borrowed(instance, e) || type !== instance.types.get(e) ? refType(type, false) : type;
  if (typeof type === "string" || type.kind !== "array" || !borrowed(instance, e)) return type;
  return objectType([{ name: "a", type: refType(type.element, false) }, { name: "b", type: "i64" }, { name: "c", type: "i64" }]);
}

// Whether a value lives where codegen can point at it for as long as a loop runs: a variable,
// `this`, a reference, or a field of an object or instance, or an element, of one. A field read
// through a shared value or a Dyn, or out of an Option, is a copy of its own.
function plainPlace(instance: Instance, e: Expr): boolean {
  const held = instance.types.get(e);
  if (typeof held !== "string" && held?.kind === "ref") return true;
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind !== "member" && e.kind !== "index") return false;
  if (e.kind === "member" && instance.calls.has(e)) return false;
  const outer = instance.types.get(e.object);
  const object = typeof outer !== "string" && outer?.kind === "ref" ? outer.to : outer;
  const holds = typeof object !== "string" && (e.kind === "member" ? object?.kind === "object" || object?.kind === "class" : object?.kind === "array" || object?.kind === "fixed");
  return holds && plainPlace(instance, e.object);
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
function receiverField({ refType }: Typing, self: NonNullable<Body["self"]>, laid: (t: Type) => Type): Field {
  return { name: "this", type: laid(self.owned ? self.type : refType(self.type, self.mutable)) };
}

// A closure, future or generator type, marked as made for `instance`.
function madeBy<T extends ClosureType | FutureType | GeneratorType>(t: T, instance: Instance): T {
  instance.tables.typing.madeFor.set(t, `${t.kind} of ${instance.symbol}`);
  return t;
}

function frameOf(instance: Instance, generator: GeneratorType | FutureType) {
  const { typing } = instance.tables;
  const { leafFuture, lower, lentPromise, nextResult, yieldsOf, promiseInterface } = typing;
  const fields: Field[] = [{ name: "state", type: "i32" }];
  const locals = new Map<Local, number>();
  const loops = new NodeMap<Stmt, number>();
  // Each `await` keeps the future it awaits in the frame while it is pending.
  const awaits = new NodeMap<Expr, number>();
  const add = (l: Local) => {
    if (locals.has(l)) return;
    locals.set(l, fields.length);
    fields.push({ name: `${l.name}.${l.id}`, type: l.type });
  };
  // An async arrow's frame holds what it captured, first, and an async method's its object.
  if (instance.body.closure) fields.push({ name: "env", type: "void" });
  const self = instance.body.self;
  if (self && !self.constructor) fields.push(receiverField(typing, self, (t) => (instance.concrete ? typing.lower(t) : t)));
  instance.body.params.forEach((p) => add(instance.locals.get(p)!));
  // A local generic function's name holds nothing.
  [...new Set(instance.locals.values())].filter((l) => !l.generic).sort((a, b) => a.id - b.id).forEach(add);
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || (node as Expr).kind === "arrow") return;
    const s = node as Stmt;
    if (s.kind === "forOf") {
      loops.set(s, fields.length);
      const kept = iterated(instance, s.right);
      const held = isRef(kept) ? kept.to : kept;
      // A `for await` loop holds its generator, or a count on its channel, and the future it awaits.
      if (s.await && typeof held !== "string" && held.kind === "block") fields.push({ name: "loop", type: held }, { name: "at", type: "i64" }, { name: "await", type: leafFuture("receive", lower(held.of)) });
      else if (s.await) {
        // In a generic body, a parameter standing for the generator awaits what its bound's `next()` gives.
        const generator = typeof held !== "string" && held.kind === "param" && held.concrete ? held.concrete : held;
        // A boxed one awaits the boxed future its vtable's `next()` gives.
        const next = typeof generator !== "string" && generator.kind === "generator" ? leafFuture("next", generator)
          : typeof generator !== "string" && generator.kind === "dyn" ? lentPromise(nextResult(yieldsOf(held, true)!)) : promiseInterface(nextResult(yieldsOf(held, true)!));
        fields.push({ name: "loop", type: kept }, { name: "at", type: "i64" }, { name: "await", type: next });
      } else fields.push({ name: "loop", type: kept }, { name: "at", type: "i64" });
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
// math and unwinding functions the IR, or LLVM lowering it, calls, which no text names, then
// the runtime's `Math` functions and the C ones they call.
const NATIVE_CODE = NATIVE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, " ");
const LOWERED = ["fma", "feclearexcept", "feraiseexcept", "pow", "powf", "fmod", "fmodf", "sqrt", "sqrtf", "floor", "floorf", "ceil", "ceilf", "trunc", "truncf", "round", "roundf", "fabs", "fabsf", "exp", "expf", "log", "logf", "sin", "sinf", "cos", "cosf", "memset", "memmove", "memcpy", "memcmp", "bzero", "abort", "exit", "fflush", "dprintf", "printf", "malloc", "calloc", "realloc", "free", "write", "qsort"];
const RUNTIME_NAMES = new Set([
  ...[...NATIVE_CODE.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]!).filter((n) => !C_KEYWORDS.has(n)),
  ...RUNTIME.flatMap((line) => /^declare [^@]*@([\w.]+)\(/.exec(line)?.[1] ?? []),
  ...LOWERED,
  ...MATH_RUNTIME.map((f) => `fsh_math_${f}`),
]);

// A program setting timers runs on the async runtime, as Node's does, so a sync `main` runs as
// an async one, its timers firing once it returns.
function timersRunAsync(ids: Ids, written: Stmt[], timerMains: Tables["timerMains"]) {
  const top = written.map((s) => (s.kind === "function" ? s : (s as { declaration?: Stmt }).declaration)).filter((s): s is Func => s?.kind === "function");
  const main = top.find((f) => f.name === "main");
  if (!main || main.async) return;
  const declared = new Set(top.map((f) => f.name));
  const timers = holdsNode(written, (n) => n.kind === "call" && (n as { callee?: { kind?: string; name?: string } }).callee?.kind === "ident" && TIMER_GLOBALS.has((n as { callee: { name: string } }).callee.name) && !declared.has((n as { callee: { name: string } }).callee.name));
  if (!timers) return;
  main.async = true;
  timerMains.add(main);
  const returns = main.returnType;
  if (returns?.kind === "ref" && returns.name === "void") main.returnType = { id: nextId(ids), kind: "ref", name: "Promise", args: [returns], start: returns.start, end: returns.end };
}
const TIMER_GLOBALS = new Set(["setTimeout", "setInterval"]);

// Whether a piece of syntax holds a node `found` picks out.
export function holdsNode(node: unknown, found: (n: { kind?: unknown; name?: unknown }) => boolean, seen: Set<unknown> = new Set<unknown>()): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => holdsNode(x, found, seen));
  if (found(node as { kind?: unknown })) return true;
  return Object.values(node).some((x) => holdsNode(x, found, seen));
}

// Every name the body of a function declares anywhere, as a variable, a function, a class or a
// parameter, and the type parameters it is generic over.
function declaredIn(f: { params: Param[]; body?: Stmt[]; typeParams?: TypeParam[] }): Set<string> {
  const names = new Set<string>(f.params.flatMap((p) => namesIn(p.pattern)));
  for (const p of f.typeParams ?? []) names.add(p.name);
  holdsNode(f.body, (n) => {
    const s = n as Stmt | Expr;
    if (s.kind === "let") for (const d of s.declarations) for (const x of namesIn(d.target)) names.add(x);
    if ((s.kind === "function" || s.kind === "class") && typeof s.name === "string") names.add(s.name);
    if (s.kind === "arrow" || s.kind === "function") for (const p of s.params) for (const x of namesIn(p.pattern)) names.add(x);
    if ((s.kind === "function" || s.kind === "arrow") && s.typeParams) for (const p of s.typeParams) names.add(p.name);
    return false;
  });
  return names;
}

// A generic arrow held by a const, as the function declaration it amounts to.
function arrowFunction(ids: Ids, name: string, arrow: Extract<Expr, { kind: "arrow" }>, at: Span): Func {
  const body: Stmt[] = Array.isArray(arrow.body) ? arrow.body : [{ id: nextId(ids), kind: "return", value: arrow.body, start: arrow.body.start, end: arrow.body.end }];
  return { id: nextId(ids), kind: "function", name, async: arrow.async, generator: false, macro: false, typeParams: arrow.typeParams, params: arrow.params, returnType: arrow.returnType, body, start: at.start, end: at.end } as Func;
}

// A library is checked with `library` set: it needs no `main`, and its exports cross to C.
const MEMBERS = new Set(["field", "method", "constructor", "get", "set", "index", "staticBlock"]);

// A macro takes the declaration it is applied to, and no type parameters.
function macroShape(f: Func) {
  const shape = `as in 'macro function ${f.name.replace(/-fsh\d+$/, "")}(input: Ast): Ast'`;
  if (f.typeParams.length > 0) throw new CompileError("E1103", `a macro takes no type parameters, ${shape}`, f.typeParams[0]!.start, f.typeParams[0]!.end);
  if (f.params.length === 0 || f.params.some((p) => p.rest)) throw new CompileError("E1103", `a macro takes the declaration it is applied to, then any arguments, ${shape}`, f.start, f.end);
  const t = f.params[0]!.type;
  if (t?.kind !== "ref" || (t.name !== "Ast" && t.name !== "AstStmt") || t.args.length > 0) {
    throw new CompileError("E1103", "a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'", f.params[0]!.start, f.params[0]!.end);
  }
  if (!f.returnType) throw new CompileError("E1103", `a macro gives the declarations it makes, so it says so, ${shape}`, f.start, f.end);
}

// With `macros`, the program is the macros and what they use, checked to run them, with no `main`.
// With `module`, it may be a file another imports, checked on its own, so `main` is optional.
// An error it throws names local declarations as they were written.
export function check(compilation: Compilation, written: Stmt[], library = false, macros = false, module = false): Checked {
  try {
    const checked = checkAll(compilation, written, library, macros, module);
    for (const w of checked.warnings) named(w, compilation.names);
    return checked;
  } catch (e) {
    throw e instanceof CompileError ? named(e, compilation.names) : e;
  }
}

function checkAll(compilation: Compilation, written: Stmt[], library: boolean, macros: boolean, module: boolean): Checked {
  const { counts, ids, rust: { names: rustNames, classNodes: rustClassNodes } } = compilation;
  const tables = newTables(compilation);
  const { typing } = tables;
  const {
    fits, lowersVariants, lowersInterfaces, lowersClasses, promiseInterface, functionType, typeParameter, literalType, setJsError, jsUncalled, jsConverts, holdsRef,
    lower, show, blockType, jsTakes, uncrossable, jsView, replaced, stored, generatorType, generatorElement, futureType, promiseElement, lockCallbacks,
    sharedCallbacks, openThrows, unionType, holdsPattern, arrayType, refType, closureType, leafOf, yieldsOf, generatorThrows, generatorSends, tupleType,
  } = typing;
  const { loopParts, nestedFunctions, nestedBindings, liftedFunctions, getterNames, destructuredParts, unusedDefaults, timerMains, selfCalls } = tables;
  const { jsBodies, jsCalledAt, jsCalls, jsClasses, jsGiven, jsonCalls, jsUses, printed, presetParams, restStarts, substituted, timerWrappers, defaulted, prologues, asserts, declarations, equalities, madeArrows } = tables;
  const files = compilation.fileNames.get(written);
  // A macro applies only to a top-level declaration; the top-level ones are expanded already.
  holdsNode(written, (n) => {
    const decorators = (n as { kind?: string; decorators?: Expr[] }).decorators;
    if (["function", "typeAlias", "interface", "enum"].includes(n.kind as string) && decorators && decorators.length > 0) throw new CompileError("E1103", "a macro applies to a top-level declaration", decorators[0]!.start, decorators[0]!.end);
    // A member's decorator a top-level class's expansion didn't reach is on a class no macro runs on.
    const member = n as { kind?: string; decorators?: Expr[]; modifiers?: unknown };
    if (MEMBERS.has(member.kind!) && Array.isArray(member.modifiers) && member.decorators && member.decorators.length > 0) throw new CompileError("E1103", "a macro on a member applies in a top-level class", member.decorators[0]!.start, member.decorators[0]!.end);
    return false;
  });
  // Each declaration and body is checked on its own, so one mistake doesn't hide the next; the
  // errors are reported together.
  const errors: CompileError[] = [];
  // A bad signature, or a failed body whose result another needs, is met again from every body
  // that uses it, and is reported once.
  // Instances that never stop growing would be queued without end once their error is recovered.
  let unending = false;
  const recover = (e: unknown) => {
    if (!(e instanceof CompileError)) throw e;
    if (e.code === "E0113") unending = true;
    if (!errors.some((x) => x.start === e.start && x.end === e.end && x.message === e.message)) errors.push(e);
  };
  // Errors a recorded mistake makes elsewhere: a use repeating why a class's `implements` claim
  // was refused, or a `try` that can't throw only because a function it calls failed before its
  // throws were known.
  const claimErrors = new Set<CompileError>();
  const refused: Members["refused"] = [];
  const tryCallees = new Map<CompileError, Body[]>();
  const followsOn = (e: CompileError) =>
    (!claimErrors.has(e) && refused.some(({ type, reason }) => e.message.includes(`'${type}'`) && e.message.includes(reason))) || (tryCallees.get(e)?.some((b) => failed.has(b) && !b.throws) ?? false);
  const stopOnErrors = () => {
    const reported = errors.filter((e) => !followsOn(e));
    if (reported.length === 1) throw reported[0];
    if (reported.length > 1) throw new CompileErrors(reported.sort((a, b) => a.start - b.start || a.end - b.end));
  };
  written = lowerOverloads(ids, written);
  written = [...written, ...hoistLocals(compilation, written)];
  holdsNode(written, (n) => {
    if (n.kind === "get" && typeof (n as { name?: unknown; key?: unknown }).name === "string") getterNames.add((n as { name: string }).name);
    if (n.kind === "get" && typeof (n as { key?: unknown }).key === "string") getterNames.add((n as { key: string }).key);
    return false;
  });
  lowerDefaults(tables, written);
  if (!library) timersRunAsync(ids, written, timerMains);
  const program = [...stdFor(compilation, written), ...written];
  const funcs: Func[] = [];
  const { aliases } = tables;
  const classes = new Map<string, ClassInfo>();
  // Generic classes, declared again for each set of type arguments they are used with.
  const templates = new Map<string, ClassNode & { name: string }>();
  const interfaces = new Map<string, Interface>();
  const enums = new Map<string, EnumInfo>();
  // For each class declaring lifetimes, which of its type parameters are lifetimes.
  const slots = new Map<string, boolean[]>();
  separatePrivateNames(program.flatMap((s) => (s.kind === "class" && s.name !== undefined ? [{ ...s, name: s.name }] : [])));
  for (const s of program) {
    try {
      // A `declare const enum` writes its values, so it is an enum like any other.
      const e = s.kind === "declare" && s.body.kind === "enum" && s.body.const ? s.body : s;
      if (e.kind === "enum") {
        typeName(e.name, e, aliases, classes, templates, interfaces, enums);
        enums.set(e.name, declareEnum(compilation, e, (owner, member, init) => enumMemberValue(owner, member, init)));
        continue;
      }
      if (s.kind === "typeAlias") {
        addAlias(aliases, s, classes, templates, interfaces, enums);
        continue;
      }
      if (s.kind === "interface") {
        typeName(s.name, s, aliases, classes, templates, interfaces, enums);
        interfaces.set(s.name, s);
        if (s.jsClass) jsClasses.set(s.name, s);
        continue;
      }
      if (s.kind === "class" && s.name !== undefined) {
        typeName(s.name, s, aliases, classes, templates, interfaces, enums);
        // A class's lifetimes are checked and erased, never instanced, so they are set aside.
        const node = { ...s, id: nextId(ids), name: s.name, typeParams: s.typeParams.filter((p) => !isLifetime(p)) };
        if (s.typeParams.some(isLifetime)) slots.set(s.name, s.typeParams.map(isLifetime));
        if (node.typeParams.length > 0) templates.set(s.name, node);
        else classes.set(s.name, declareClass(tables, node));
        const rust = rustClassNodes.get(s);
        if (rust) classes.get(s.name)!.type.rust = rust;
        // A Rust type declaring no constructor is never made with `new`, so its handle needs no
        // assigning in the empty one it is given.
        if (rust && !classes.get(s.name)!.constructor.rust) classes.get(s.name)!.required.clear();
        // A `static readonly` field is a top-level const named `C.x`, which no source name can be.
        const declared = classes.get(s.name);
        for (const f of declared?.staticFields.values() ?? []) {
          const giving: Stmt = { id: nextId(ids), kind: "return", value: f.init!, start: f.init!.start, end: f.init!.end };
          funcs.push(Object.assign({ id: nextId(ids), kind: "function" as const, async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${s.name}.${f.name}`, returnType: f.type, body: [giving], start: f.start, end: f.end }, { comptime: "const" as const, owner: declared!.type }));
        }
        continue;
      }
      // `declare function f(...): T;` names a C function, called inside `unsafe`.
      if (s.kind === "declare" && s.body.kind === "function" && !hasBody(s.body)) {
        const rest = s.body.params.find((p) => p.rest);
        if (rest) throw unsupported("variadic C functions", rest);
        funcs.push(Object.assign({ ...s.body, id: nextId(ids), body: [] }, { foreign: true }));
        continue;
      }
      // `export function f() {}` is an ordinary function, and in a library a C function too; an
      // exported macro is for other files.
      if (s.kind === "export" && s.body.kind === "function" && hasBody(s.body)) {
        if (s.body.macro) macroShape(s.body);
        funcs.push(s.body.macro ? s.body : Object.assign({ ...s.body, id: nextId(ids) }, { exported: true }));
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
          if (["undefined", "console", "print"].includes(d.target.name)) throw new CompileError("E0407", `'${d.target.name}' already names something every program has; call the const something else`, d.target.start, d.target.end);
          if (!d.init) throw new CompileError("E0404", "a top-level 'const' needs its value", d.start, d.end);
          // A generic arrow is a family of functions, so it is declared as a generic function is.
          if (d.init.kind === "arrow" && d.init.typeParams.some((p) => !isLifetime(p))) {
            funcs.push(arrowFunction(ids, d.target.name, d.init, d));
            continue;
          }
          const giving: Stmt = { id: nextId(ids), kind: "return", value: d.init, start: d.init.start, end: d.init.end };
          funcs.push(Object.assign({ ...made, id: nextId(ids), name: `const ${d.target.name}`, returnType: d.type, body: [giving], start: d.start, end: d.end }, { comptime: "const" as const }));
        }
        continue;
      }
      if (s.kind === "comptime") {
        funcs.push(Object.assign({ ...made, id: nextId(ids), name: `comptime ${s.start}`, returnType: undefined, body: s.body }, { comptime: "block" as const }));
        continue;
      }
      if (s.kind === "let") throw new CompileError("E0404", "a top-level 'let' would be a global that changes; use 'const', whose value is computed while compiling, or a const holding an Atomic or a Lock", s.start, s.end);
      // Top-level code with side effects belongs in main(); the migration lint moves it there.
      if (s.kind !== "function") throw new CompileError("E0404", "only declarations are allowed at the top level; move this into main()", s.start, s.end);
      const rust = rustNames.get(s);
      if (rust) {
        funcs.push(Object.assign({ ...s, id: nextId(ids), body: [] }, { foreign: true, rust }));
        continue;
      }
      if (s.js) {
        const body = { ...s, id: nextId(ids), body: [] };
        jsBodies.set(s, body);
        funcs.push(body);
        continue;
      }
      if (!hasBody(s)) throw new CompileError("E0410", `'${s.name}' has no implementation; follow its overload signatures with a 'function ${s.name}' that has a body`, s.start, s.end);
      if (s.macro) macroShape(s);
      funcs.push(s);
    } catch (e) {
      recover(e);
    }
  }
  const byName = new Map<string, Func>();
  for (const f of funcs) {
    try {
      // A tag takes its strings, then its values as a rest parameter.
      const tag = f.params.length === 2 && tagStrings(f.params[0]) && f.params[1]!.rest;
      if (!tag && f.params.length === 2 && f.params[1]!.rest && (f.params[0]!.comptime || (f.params[0]!.type?.kind === "ref" && f.params[0]!.type.name === "TemplateStringsArray"))) {
        const strings = f.params[0]!;
        throw new CompileError("E1107", `'${f.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, strings.start, strings.end);
      } else if (!tag && f.params[0]?.comptime && f.params.at(-1)?.rest) {
        const rest = f.params.at(-1)!;
        throw new CompileError("E1102", "a function with comptime parameters can't take a rest parameter yet, unless it is a tag, whose values follow its strings, as in 'comptime strings: TemplateStringsArray, ...values: T[]'", rest.start, rest.end);
      }
      const named = f.name.startsWith("const ") ? f.name.slice("const ".length) : f.name;
      if (byName.has(f.name) || byName.has(named) || byName.has(`const ${named}`) || classes.has(named) || templates.has(named) || enums.has(named)) throw new CompileError("E0402", `'${named}' is already defined`, f.start, f.end);
      byName.set(f.name, f);
    } catch (e) {
      recover(e);
    }
  }
  // A body using a declaration that failed would only say it can't find it.
  stopOnErrors();
  // The name the file holding `at` writes for a top-level name, or nothing when that file can't
  // reach it. Std's prelude is in no file's table and reaches every file, but for its internals.
  const reachedAs = (name: string, at: number): string | undefined => {
    const file = files?.get(at - (at % FILE_SPAN));
    const written = file?.get(name);
    if (written !== undefined) return written;
    if (files && [...files.values()].some((f) => f.has(name))) return undefined;
    return STD_INTERNAL.has(name) || name.startsWith("__") ? undefined : name;
  };
  const reached = (names: Iterable<string>, at: number) => [...names].flatMap((n) => reachedAs(n, at) ?? []);
  const main = byName.get("main");
  if (!main && !library && !macros && !module) throw new CompileError("E0405", "no main() function; execution starts there", 0, 0);

  // A class's members, for interface satisfaction. Like the resolver and generic classes,
  // which need each other, it reaches what is set up below lazily.
  const members: Members = {
    classOf: (t) => classOf(t),
    returnOf: (b, at) => returnOf(definition(b), at),
    // A generic method's, with its own type parameters standing for themselves.
    paramTypesOf: (b) => ((b.typeParams ?? []).some((p) => !isLifetime(p)) ? paramTypes(definition(b), scopeOf(definition(b))) : declaredParams(b)),
    bodyNamed: (name) => byName.get(name),
    typeParamsOf: (b) => {
      const scope = scopeOf(definition(b));
      return (b.typeParams ?? []).filter((p) => !isLifetime(p)).map((p) => scope.get(p.name)!);
    },
    typing,
    assuming: new Set(),
    refused,
  };
  const { register, settle, claims, link, layout, laying, classOf, bodiesOf, infoOf, unsettled, wrapsOf } = registry({
    tables, classes, templates, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
    instanceOf: (f) => instanceOf(f), definition: (f) => definition(f), checkBody: (i) => checkBody(i),
    classNames: (at) => reached([...classes.keys(), ...templates.keys()], at),
  });
  classes.forEach(register);
  const { classNamed, construct, start, define, definedClass } = genericClasses({
    tables, classes, templates, register, layout, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
  });
  const { resolveType, paramType, withScope, withSight, setSight, enumInstance, validate, interfaceInstance } = resolver(tables, aliases, classNamed, interfaces, enums, slots, (c) => layout(classOf(c)), (name, at, shadowed) => valueTypeOf(name, at, shadowed),
    // An interface is met by shape, as a conditional type's `extends` asks of it.
    (from, to, at) => (typeof to !== "string" && to.kind === "interface" ? unsatisfied(from, to, members, at) === undefined : fits(from, to)),
    (at) => reached([...aliases.keys(), ...classes.keys(), ...templates.keys(), ...interfaces.keys(), ...enums.keys()], at));
  // A generic enum's variant made with other type arguments, while lowering.
  lowersVariants((v, args) => enumInstance(enums.get(v.enum)!, args, checking?.body ?? { start: 0, end: 0 }).variants.get(v.member)!);
  lowersInterfaces(interfaceInstance);
  // A class first made while lowering is reported at the function being checked.
  lowersClasses((c, args) => classNamed(c.generic!.name, args, checking?.body ?? { start: 0, end: 0 })!);
  // The instance being checked, which new instantiations count their depth from.
  let checking: Instance | undefined;
  const done = new Set<Instance>();
  // The error each failed body's check gave, which a call of it gives again rather than another.
  const failed = new Map<Body, CompileError>();
  // Each Rust function's types, by its shim symbol, as first declared.
  const rustTypes = new Map<string, string>();
  // Comptime runs a function only once the checker has been through it.
  comptimeChecks(tables, (i) => {
    if (inProgress.has(i)) return false;
    checkBody(i);
    return true;
  });
  // Each concrete instance's return type as its own body saw it, before lowering.
  const views = new Map<Instance, Type>();
  // Each unannotated `let` of integer literals a use needs as another integer type, as Rust
  // infers it, and the variables still open to that in the pass being checked.
  const demands = new NodeMap<Stmt, Integer>();
  const candidates = new Map<Local, Stmt>();
  // How many new demands the body being checked made itself, not counting its callees'.
  let demanded = 0;
  const { instanceOf, instantiate, callbackType, paramTypes, scopeOf, declaredParams, implicitOf, definition, pending, all, siteOf, returnTypeOf, constructs } = instancing({
    tables, resolveType, paramType, withScope, members, checking: () => checking,
    signing: (f, run) => withSight((n, at) => writtenIn(f, at) && f.params.some((p) => p.pattern.kind === "ident" && p.pattern.name === n), run),
    classParams: (f) => (f.scope?.size && f.owner ? classOf(f.owner).node.typeParams : []),
    comptimeArgument: (arg) => comptimeLiteral(arg),
    failure: (f) => failed.get(f),
  });
  // What `typeof name` names in a type: a top-level const's type, or a non-generic function's,
  // whose result is checked from its body when it isn't written.
  function valueTypeOf(name: string, at: Span, shadowed: boolean): Type {
    if (shadowed) throw new CompileError("E0801", `'typeof' of the local '${name}' isn't supported yet; 'typeof' in a type names a top-level function or const`, at.start, at.end);
    if (classes.has(name)) throw new CompileError("E0801", `'typeof' of the class '${name}' isn't supported yet, since classes aren't values in Fish; name the class itself as the type`, at.start, at.end);
    const constant = byName.get(`const ${name}`);
    const f = constant ?? byName.get(name);
    if (!f) throw new CompileError("E0114", `'typeof' in a type names a top-level function or const, and there is none named '${name}'`, at.start, at.end);
    if (querying.has(name)) throw new CompileError("E0113", `'typeof ${name}' is used in working out ${name}'s own type, so that type would depend on itself; write it out`, at.start, at.end);
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

  // A computed enum member's value: its initializer, run while compiling as a top-level const is.
  function enumMemberValue(owner: string, member: string, init: Expr): Value {
    const giving: Stmt = { id: nextId(ids), kind: "return", value: init, start: init.start, end: init.end };
    const f: Func = Object.assign({ id: nextId(ids), kind: "function" as const, async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${owner}.${member}`, returnType: undefined, body: [giving], start: init.start, end: init.end }, { comptime: "const" as const });
    const instance = definition(f);
    checkBody(instance);
    return untagged(comptimeBody(instance));
  }

  // Whether a type written at `at` sits inside a body.
  function writtenIn(f: Body, at: Span): boolean {
    return at.start >= f.start && at.end <= f.end;
  }

  // A result worked out from a body may need the class being laid out, whose fields aren't known.
  function unlaid(name: string, at: Span) {
    const [mid] = laying;
    if (mid) throw new CompileError("E0114", `'typeof ${name}' needs ${name}'s result, worked out from its body, while the field types of '${mid.type.name}' are being worked out; write ${name}'s return type`, at.start, at.end);
  }

  // A function's type for `typeof`: a parameter typed with an object type, an interface or a
  // function type makes it generic in Fish, but its declared type is what `typeof` names.
  function functionTypeOf(f: Func, at: Span): Type {
    const explicit = f.typeParams.filter((p) => !(p.constraint?.kind === "ref" && p.constraint.name === "Lifetime"));
    if (explicit.length > 0 || f.params.some((p) => p.comptime)) {
      throw new CompileError("E0801", `'typeof' of the generic function '${f.name}' isn't supported yet: it has a type per instance, and none is chosen here`, at.start, at.end);
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
    const open = openParam(typing, result, true);
    if (open) {
      const i = f.params.findIndex((_, i) => def.bindings.get(`#${i}`) === open);
      const param = f.params[i]?.pattern;
      throw new CompileError("E0114", `'typeof ${f.name}' can't name its result, which depends on the type of the argument given for '${param?.kind === "ident" ? param.name : open.name}'; write the return type`, at.start, at.end);
    }
    return functionType(f.params.map((p) => (p.pattern.kind === "ident" ? writtenName(tables, p) : "_")), declaredParams(f), result);
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
    if (typeof v === "object" && v?.kind === "array" && v.items.every((x) => typeof x === "string")) return stringsType(tables, v.items as string[]);
    throw new CompileError("E1102", "a comptime parameter takes an integer, a boolean, a string, an enum member or a string array", arg.start, arg.end);
  }
  // A generic definition's placeholder for each comptime argument, one per argument.
  const placeholders = new WeakNodeMap<Expr, Type>();
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new NodeSet<Stmt>();
  const continued = new NodeSet<Stmt>();
  const inProgress = new Set<Instance>();
  let nextLocal = 0;
  // Every closure's instance, and the instance each closure type calls.
  const closures: Instance[] = [];
  const closureBodies = new Map<ClosureType, Instance>();

  // A generic class's constructor parameters, its base's when it declares no constructor.
  function templateParams(name: string, seen: Set<string> = new Set<string>()): Param[] | undefined {
    const t = templates.get(name);
    if (!t || seen.has(name)) return undefined;
    const ctor = t.members.find((m) => m.kind === "constructor");
    if (ctor) return ctor.params;
    const named = t.extends?.kind === "instantiation" ? t.extends.expr : t.extends;
    if (named?.kind !== "ident") return undefined;
    return templateParams(named.name, seen.add(name)) ?? classes.get(named.name)?.constructor.params;
  }

  classes.forEach((c) => link(c, new Set()));
  setJsError(classes.get("JsError")?.type);
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
  classes.forEach(implementsSignatures);
  // An enum with computed members is settled when first read; one nothing reads still reports
  // a bad initializer.
  for (const e of enums.values()) void e.members;
  // The classes as declared, and generic classes' definitions; any other is an instance a call made.
  const declaredClasses = new Set(unsettled);
  // A class's `implements` claims are checked before any body uses the class, so a refused one is
  // reported at the class rather than at each use.
  for (const c of declaredClasses) {
    try {
      claims(c);
    } catch (e) {
      if (e instanceof CompileError) claimErrors.add(e);
      recover(e);
    }
  }
  funcs.forEach((f) => {
    try {
      checkBody(definition(f));
    } catch (e) {
      // A package's function Fish can't type is refused where a program calls it.
      if (!f.js || !(e instanceof CompileError)) {
        // A bad signature fails before the body's check does, and fails each call of it as well.
        if (e instanceof CompileError && !failed.has(f)) failed.set(f, e);
        return recover(e);
      }
      jsUncalled.set(f, e);
    }
  });
  // Once a body has failed, a generic body's or class's instances aren't checked: their
  // definitions were, and an instance's error then is most often one a refused call already
  // reported.
  while (!unending && (unsettled.length > 0 || pending.length > 0)) {
    if (errors.length > 0) {
      pending.length = 0;
      const kept = unsettled.filter((c) => declaredClasses.has(c));
      unsettled.length = 0;
      unsettled.push(...kept);
      if (unsettled.length === 0 && pending.length === 0) break;
    }
    try {
      if (unsettled.length > 0) settle(unsettled.shift()!, (run) => {
        try {
          run();
        } catch (e) {
          recover(e);
        }
      });
      else checkBody(pending.shift()!);
    } catch (e) {
      recover(e);
    }
  }
  // What follows reads every body's results.
  stopOnErrors();
  if (main && main.params.length > 0) throw new CompileError("E0405", "main() takes no parameters", main.start, main.end);
  const started = main && instanceOf(main).returns;
  if (main && (typeof started !== "string" && started?.kind === "future" ? started.gives : started) !== "void") throw new CompileError("E0405", "main() can't return a value yet", main.start, main.end);
  if (library) funcs.filter((f) => (f as Body).exported).forEach((f) => exportable(definition(f)));
  if (library && !funcs.some((f) => (f as Body).exported)) throw new CompileError("E1003", "a library has nothing for C to call; mark functions with 'export'", 0, 0);
  // An abstract member and a template are checked but never compiled; each concrete class's copy is.
  const compiled = new Set([...funcs.filter((f) => !f.macro || macros), ...[...infoOf.values()].flatMap(bodiesOf).filter((f) => !f.abstract && !f.template)]);
  // So is an instance made for an abstract class, which only a template's check makes.
  const checkedOnly = (i: Instance): boolean => i.body.template === true || [...i.bindings.values()].some(abstractPart) || (i.body.closure !== undefined && checkedOnly(i.body.closure.parent));
  const compiledInstances = [...all().filter((i) => i.concrete && compiled.has(i.body) && !i.body.js && !checkedOnly(i)), ...closures.filter((i) => i.concrete && !checkedOnly(i))];
  unreached(equalities, compiledInstances, (i) => i.body.abstract === true || checkedOnly(i));
  // A package's const whose value has no JS form yet stops the program where it is read.
  const earliest = (spans: Span[]) => spans.reduce<Span | undefined>((first, e) => (first === undefined || e.start < first.start ? e : first), undefined);
  const used = earliest(jsUses);
  if (used) throw new CompileError("E1005", "reading this package's const isn't supported yet, as its value has no JS form", used.start, used.end);
  // A package's function called with a value, or giving one, that has no JS form.
  const unconverted = earliest(compiledInstances.flatMap((i) => [...i.calls.keys()].filter((x) => {
    if (x.kind !== "call" || !jsCalls.has(x)) return false;
    const gives = i.calls.get(x)?.returns ?? "void";
    // A callback crosses as the stored callable it meets.
    const given = (a: Expr) => {
      const to = i.coercions.get(a);
      return to !== undefined && holdsPart(to, (u) => typeof u !== "string" && u.kind === "dyn") ? to : i.types.get(a)!;
    };
    return x.args.some((a) => !jsConverts(given(a))) || (gives !== "void" && !jsConverts(gives));
  })));
  if (unconverted) throw new CompileError("E1005", "this call gives a package's function a value with no JS form yet", unconverted.start, unconverted.end);
  // A value given to JS becomes a JS value as the call or write converts it.
  const crossing = earliest(compiledInstances.flatMap((i) => [...i.coercions].filter(([x, t]) => !jsGiven.has(x as Expr) && intoJs(i.types.get(x as Expr) ?? "void", t)).map(([x]) => x)));
  if (crossing) throw new CompileError("E1005", "turning a Fish value into a JS value isn't supported yet, outside a call or a write that gives it to JS; a 'JsValue' or a package's object comes only from JS", crossing.start, crossing.end);
  // A package's declarations have no body to compile.
  // An interface's method may be any class's, as interfaces are met by shape.
  const signed = new Set([...interfaces.values()].flatMap((x) => x.members.flatMap((m) => (m.kind === "method" && typeof m.name === "string" ? [m.name] : []))));
  // A method's body is named for its class, as in `C.m`.
  const method = (b: Body) => b.name.slice(b.name.lastIndexOf(".") + 1);
  const overrides = (b: Body) => {
    const base = classOf(b.owner!).base;
    return base !== undefined && inherited(base, "methods", method(b)) !== undefined;
  };
  const required = (b: Body) => b.exported === true || b.accessor === true || b.signature === true || (b.owner !== undefined && (signed.has(method(b)) || overrides(b)));
  return { instances: compiledInstances, tables, compilation, warnings: warnings(tables, compiledInstances, required) };

  // Whether a value of type `from` meeting `to` would become a JS value somewhere inside it: a
  // part that isn't a JsValue or a handle where `to` takes only one. An empty array's `never`
  // elements hold nothing.
  function intoJs(from: Type, to: Type): boolean {
    const held = (t: Type) => (typeof t !== "string" && t.kind === "ref" ? t.to : t);
    const js = (t: Type) => typeof t !== "string" && t.kind === "block" && t.which === "JsValue";
    [from, to] = [held(from), held(to)];
    if (from === to || from === "never" || typeof to === "string" || !holdsPart(to, js, true)) return false;
    if (js(to)) return !js(from);
    if (to.kind === "union") {
      const others = to.members.filter((m) => !js(m));
      const members = typeof from !== "string" && from.kind === "union" ? from.members : [from];
      return members.some((m) => !to.members.includes(m) && !js(m) && !others.some((o) => fits(m, o) && !intoJs(m, o)));
    }
    if (typeof from === "string") return false;
    // An array is never converted element by element where JS values are wanted.
    if ((to.kind === "array" || to.kind === "fixed") && (from.kind === "array" || from.kind === "fixed")) return from.element !== "never" && !(js(from.element) && js(to.element)) && (from.element !== to.element || intoJs(from.element, to.element));
    // A field the value leaves out is an absent optional one, which turns nothing into JS.
    if (to.kind === "object" && (from.kind === "object" || from.kind === "class")) return to.fields.some((f) => from.fields.some((g) => g.name === f.name && intoJs(g.type, f.type)));
    return false;
  }

  // What a function's returned reference borrows from: the parameters with its written
  // lifetime, or by elision `this` for a method, or the only reference parameter.
  function originsOf(f: Body, params: Type[], returns: RefType): Origin[] {
    const at = f.returnType ?? f;
    if (returns.life) {
      const found: Origin[] = f.params.flatMap((p, i) => (named(p.type).has(returns.life!) ? [i] : []));
      // A lifetime of the method's own class is the object's.
      if (f.owner && classLifetimes(f).has(returns.life)) found.push("this");
      if (found.length === 0) throw new CompileError("E0209", `no parameter is borrowed for lifetime '${returns.life}'; write 'Ref<T, ${returns.life}>' on the parameter the result points into`, at.start, at.end);
      return found;
    }
    if (f.self && !f.self.constructor && !f.self.owned) return ["this"];
    const refs = params.flatMap((p, i) => (holdsRef(p) ? [i] : []));
    if (refs.length === 1) return refs;
    throw new CompileError("E0209", refs.length === 0
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
    const ref = isRef(returns) ? returns : optionRef(returns);
    const origins = ref ? originsOf(f, paramTypes(instance), ref) : heldOrigins(f);
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
        if (!declared.has(life.name)) throw new CompileError("E0209", `cannot find lifetime '${life.name}'; declare it as '<${life.name} extends Lifetime>'`, life.start, life.end);
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
    // `JSON.stringify` and printing write a field by how it was spelled, which lowering forgets.
    for (const e of instance.types.keys()) {
      const stringified = e.kind === "call" && jsonCalls.get(e) === "stringify" ? e.args[0] : undefined;
      for (const x of [...(stringified ? [stringified] : []), ...(printed.has(e) ? [e] : [])]) {
        const type = instance.coercions.get(x) ?? instance.types.get(x);
        if (type) (instance.spelled ??= new NodeMap()).set(x, type);
      }
    }
    for (const table of [instance.types, instance.coercions]) table.forEach((t, e) => table.set(e, lower(t)));
    // A pipe's topic written in as a field read would run a getter once for each `%`.
    for (const e of instance.types.keys()) {
      if (e.kind !== "member" || !substituted.has(e)) continue;
      const held = instance.types.get(e.object);
      const object = typeof held !== "string" && held?.kind === "ref" ? held.to : held;
      if (typeof object !== "string" && object?.kind === "class" && !field(object, e.name)) throw unsupported("pipes over a field a getter provides", e);
    }
    instance.patterns.forEach((info, p) => instance.patterns.set(p, lowerPattern(tables.typing, info)));
    instance.raises.forEach((r, at) => instance.raises.set(at, { ...r, from: lower(r.from), to: lower(r.to), ...(r.param && { param: lower(r.param) }) }));
    instance.caught.forEach((t, s) => instance.caught.set(s, lower(t)));
    instance.predicates?.forEach((p, e) => instance.predicates!.set(e, { ...p, type: lower(p.type) }));
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
    // Its comptime parameters' values carry over too, as do a generic method's own type
    // arguments.
    const fixed = [...target.bindings].filter(([name]) => name.startsWith("comptime "));
    const own = typeParamsOf(body).map((p): [string, Type] => [p.name, target.bindings.get(p.name)!]);
    return instanceOf(body, new Map([...body.scope!, ...own, ...implicit, ...fixed]));
  }

  // An export in a library is a C function too, so its signature crosses to C as a declared
  // function's does, and it can't throw, be generic or be a generator, which C can't call.
  function exportable(instance: Instance) {
    const f = instance.body;
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || (typeof t !== "string" && t.kind === "pointer");
    if (f.typeParams?.length) throw new CompileError("E1003", "a library can't export a generic function to C, which has no generics; export one for each type", f.start, f.end);
    if (f.generator) throw new CompileError("E1003", "a library can't export a generator to C, which has no generators", f.start, f.end);
    if (f.throws) throw new CompileError("E1003", "a library can't export a function that throws to C, which has no exceptions; return a status instead", f.throws.start, f.throws.end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name) || C_KEYWORDS.has(f.name)) {
      throw new CompileError("E1003", `a library can't export '${f.name}' to C, which needs a name of ASCII letters, digits and underscores that isn't a C or C++ keyword`, f.start, f.end);
    }
    // C reserves names starting with an underscore and a capital, or two underscores, for itself
    // and its runtime: the unwinder's `_Unwind_Resume` among them.
    if (f.name === "main" || f.name.startsWith("fsh_") || /^_[A-Z_]/.test(f.name) || RUNTIME_NAMES.has(f.name)) {
      throw new CompileError("E1003", `a library can't export '${f.name}' to C, since C's library or the Fish runtime already uses that name`, f.start, f.end);
    }
    f.params.forEach((p) => {
      if (defaulted.has(p)) throw new CompileError("E1003", "an exported function's parameter can't have a default in a library, since C callers pass every argument", p.start, p.end);
      const t = instance.locals.get(p)!.type;
      if (!crosses(t)) throw new CompileError("E1003", `an exported function's parameter can't be a '${show(t)}' in a library; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    if (instance.returns !== "void" && !crosses(instance.returns)) {
      const at = f.returnType ?? f;
      throw new CompileError("E1003", `an exported function can't return a '${show(instance.returns)}' in a library; C gives numbers, booleans and raw pointers`, at.start, at.end);
    }
  }

  // A C function's signature, which must cross to C as it is: numbers, booleans and raw
  // pointers, with `void` for no result.
  function foreignSignature(instance: Instance) {
    const f = instance.body;
    if (f.rust) return rustSignature(instance);
    if (f.typeParams?.length) throw unsupported("generic C functions", f);
    if (f.generator) throw new CompileError("E1002", "a C function can't be a generator; drop the '*'", f.start, f.end);
    if (f.async) throw new CompileError("E1002", "a C function can't be async; C calls return when they finish", f.start, f.end);
    if (f.name === "main") throw new CompileError("E1002", "'main' can't be a C function; it is where the program starts", f.start, f.end);
    if (f.throws) throw new CompileError("E1002", "a C function can't throw; C reports failures in its result", f.throws.start, f.throws.end);
    if (!f.returnType) throw new CompileError("E1002", "a C function needs its return type written, 'void' if it returns nothing", f.start, f.end);
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || (typeof t !== "string" && t.kind === "pointer");
    const params = paramTypes(instance, scopeOf(instance));
    f.params.forEach((p, i) => {
      if (p.rest || p.optional || p.default) throw unsupported("rest, optional and default parameters on C functions", p);
      if (!crosses(params[i]!)) throw new CompileError("E1002", `a C function's parameter can't be a '${show(params[i]!)}'; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    instance.signature = params;
    const returns = resolveType(f.returnType);
    if (returns !== "void" && !crosses(returns)) throw new CompileError("E1002", `a C function can't return a '${show(returns)}'; C gives numbers, booleans and raw pointers`, f.returnType.start, f.returnType.end);
    instance.returns = returns;
    done.add(instance);
  }

  // A Rust function's signature: numbers and booleans, with `void` for no result, so far.
  function rustSignature(instance: Instance) {
    const f = instance.body;
    const what = `the Rust function '${f.name}'`;
    const constructor = f.self?.constructor === true;
    if (f.typeParams?.length) throw unsupported("generic Rust functions", f);
    if (f.generator || f.async) throw new CompileError("E1004", `${what} can't be ${f.async ? "async" : "a generator"}; it returns when the Rust function does`, f.start, f.end);
    // A Rust `Result`'s `Err` is thrown: as Fish's `Error`, made from its Display text, or as the
    // Rust type it is, declared as a class.
    if (f.throws) {
      const error = resolveType(f.throws);
      const isError = typeof error !== "string" && error.kind === "class" && error.name === "Error" && !error.generic;
      if (!isError && !rustClassOf(error)) throw new CompileError("E1004", `${what} throws a Rust 'Err' as Fish's 'Error', made from its Display text, or as a Rust type declared in a 'rust:' block, not as a '${show(error)}'`, f.throws.start, f.throws.end);
      if (isError) classOf(error as ClassType);
      instance.throws = error;
    }
    if (!f.returnType && !constructor) throw new CompileError("E1004", `${what} needs its return type written, 'void' if it returns nothing`, f.start, f.end);
    const refuse = (t: Type, giving: boolean, at: Span) => {
      const why = crossingOf(t, giving);
      if (typeof why === "string") throw new CompileError("E1004", `${giving ? `${what} can't give` : "a Rust function can't take"} a '${show(t)}': ${why}`, at.start, at.end);
    };
    const params = paramTypes(instance, scopeOf(instance));
    f.params.forEach((p, i) => {
      if (p.rest || p.optional || p.default || p.comptime) throw unsupported("rest, optional, default and comptime parameters on Rust functions", p);
      refuse(params[i]!, false, p);
    });
    instance.signature = params;
    const returns = f.returnType ? resolveType(f.returnType) : "void";
    if (returns !== "void") refuse(returns, true, f.returnType!);
    // A constructor gives the handle to the value it made.
    instance.returns = constructor ? f.owner! : returns;
    // Every declaration of one Rust function calls the one shim function, so they agree on types.
    // The receiver and what it throws are part of how the shim calls it, so they have to agree too.
    const self = f.self && !constructor ? [f.self.owned ? "self" : f.self.mutable ? "&mut self" : "&self"] : [];
    const types = `(${[...self, ...params.map(show)].join(", ")}): ${show(instance.returns)}${instance.throws ? ` throws ${show(instance.throws)}` : ""}`;
    const other = rustTypes.get(f.rust!.symbol);
    if (other !== undefined && other !== types) throw new CompileError("E1004", `'${f.rust!.crate}::${f.rust!.path}' is declared elsewhere as ${other}; declare it with the same types`, f.start, f.end);
    rustTypes.set(f.rust!.symbol, types);
    done.add(instance);
  }

  // A package's function's signature, from its declaration: what it takes and gives must cross
  // between Fish and JS, as strings, booleans, numbers, Options, unions and literals of them,
  // arrays of them copied across, and opaque JS values.
  // One imported but not called yet is refused only where a program calls it.
  function jsSignature(instance: Instance) {
    try {
      jsSigned(instance);
    } catch (e) {
      if (!(e instanceof CompileError) || jsCalledAt.has(instance.body)) throw e;
      jsUncalled.set(instance.body, e);
      instance.signature = [];
      instance.returns = blockType("JsValue");
      done.add(instance);
    }
  }

  function jsSigned(instance: Instance) {
    const f = instance.body;
    const named = `'${f.js!.name}' from '${f.js!.module}'`;
    // A declaration Fish can't type is refused where it is declared, noting the call that reached it.
    const at = jsCalledAt.get(f);
    const refuse = (message: string, where: Span) => new CompileError("E1005", message, where.start, where.end, at && { message: `'${f.js!.name}' is called here`, start: at.start, end: at.end });
    // A generic one is checked for each set of type arguments it is called with, as what crosses
    // is known only then; its definition, never compiled, is typed only by each call.
    if (!instance.concrete) {
      instance.signature = [];
      instance.returns = blockType("JsValue");
      done.add(instance);
      return;
    }
    // What its type parameters stand for, as plain types, since JS sees no Fish placeholders.
    const concrete = new Map([...scopeOf(instance)].map(([n, t]): [string, Type] => [n, lower(t)]));
    const declared = paramTypes(instance, concrete);
    const params = declared.map(jsTakes);
    f.params.forEach((p, i) => {
      if (p.rest) throw unsupported(`rest parameters on a package's functions, as ${named} takes,`, p);
      // An object type taken as a JS object's shape is still checked for what it holds.
      const why = uncrossable(params[i]!) ?? (params[i] !== declared[i] && typeof declared[i] !== "string" && declared[i]!.kind !== "function" && declared[i]!.kind !== "interface" ? uncrossable(declared[i]!) : undefined);
      if (why) throw refuse(`${named} takes a '${show(params[i]!)}', which can't cross between Fish and JS yet: ${why}`, p.type ?? p);
    });
    instance.signature = params;
    const returns = jsView(f.returnType ? withScope(concrete, () => resolveType(f.returnType!)) : blockType("JsValue"));
    const why = returns === "void" ? undefined : uncrossable(returns);
    if (why) throw refuse(`${named} gives a '${show(returns)}', which can't cross between Fish and JS yet: ${why}`, f.returnType!);
    instance.returns = returns;
    done.add(instance);
  }

  // An overload signature's body only passes its parameters on, so what fails there is the
  // signature not matching its implementation.
  function incompatible(signature: Body, e: unknown): unknown {
    const prefix = "this overload signature is not compatible with its implementation";
    if (!(e instanceof CompileError) || e.start < signature.start || e.end > signature.end || e.message.startsWith(prefix)) return e;
    return new CompileError("E0410", `${prefix}: ${e.message}`, e.start, e.end, e.note);
  }

  // A call made inside an instance with one of its type parameters gets the type the definition
  // gave it: the callee's return with the callee's parameters as the ones the call passed.
  function resultOf(instance: Instance, at: Span & Id): Type {
    // Checking the callee may instantiate from this call again, so its site is read first.
    const site = siteOf(at);
    const returns = returnOf(instance, at);
    if (!site || (instance.body.js && instance.concrete)) return returns;
    const f = instance.body;
    const declared = returnTypeOf(f, new Map([...instance.bindings, ...site]));
    if (declared && !describes(declared)) return declared;
    const own = scopeOf(instance);
    return replaced(views.get(instance) ?? returns, new Map([...site].map(([name, t]) => [own.get(name)!, t])));
  }

  // Each member a class writes that implements an abstract member takes what the declaration
  // takes and gives what it gives, as a template calling it through the abstract class expects.
  function implementsSignatures(c: ClassInfo) {
    for (const table of ["methods", "getters", "setters"] as const) {
      for (const [name, f] of c[table]) {
        if (f.abstract || f.copyOf) continue;
        for (let b = c.base; b; b = b.base) {
          const declared = b[table].get(name);
          if (declared?.abstract) implementsSignature(f, declared, b);
        }
      }
    }
    for (let b = c.base; b; b = b.base) {
      for (const [name, declared] of b.getters) {
        const own = c.type.fields.find((x) => x.name === name);
        if (!declared.abstract || !own) continue;
        const wanted = returnOf(instanceOf(declared), declared);
        const at = c.fields.find((x) => x.name === name)!;
        // A field is read as it is, so it has the declared type exactly.
        if (own.type !== wanted) throw new CompileError("E0701", `'${name}' must be a '${show(wanted)}', not a '${show(own.type)}', as '${b.type.name}' declares it abstract`, at.start, at.end);
      }
    }
  }

  function implementsSignature(f: Body, declared: Body, b: ClassInfo) {
    const why = (text: string) => new CompileError("E0701", `'${declared.name.slice(b.type.name.length + 1)}' ${text}, as '${b.type.name}' declares it abstract`, f.start, f.end);
    const want = declaredParams(declared);
    const rest = f.params.find((p) => p.rest);
    if (rest && !declared.params.some((p) => p.rest)) throw new CompileError("E0801", `'${f.name.slice(f.owner!.name.length + 1)}' can't gather its arguments into a rest parameter yet where '${b.type.name}' declares it abstract with separate ones`, rest.start, rest.end);
    // A generic implementation is the instance its type parameters take from the declaration's.
    const names = new Set(typeParamsOf(f).map((p) => p.name));
    const bindings = new Map<string, Type>();
    if (names.size > 0) f.params.forEach((p, i) => p.type && want[i] !== undefined && infer(tables, p.type, want[i]!, names, bindings, f));
    if (bindings.size < names.size) throw why(`must take (${want.map(show).join(", ")})`);
    const instance = names.size > 0 ? instanceOf(f, new Map([...(f.scope ?? []), ...bindings])) : instanceOf(f);
    const have = names.size > 0 ? paramTypes(instance) : declaredParams(f);
    // Parameters past the declaration's must be optional, as the calls through it leave them out.
    const extra = f.params.slice(want.length).some((p) => !p.optional);
    if (have.length < want.length || extra || want.some((t, i) => !fits(t, have[i]!))) throw why(`must take (${want.map(show).join(", ")})`);
    if (!!f.async !== !!declared.async) throw why(declared.async ? "must be async" : "can't be async");
    if (!!f.generator !== !!declared.generator) throw why(declared.generator ? "must be a generator" : "can't be a generator");
    if (f.self!.mutable && !declared.self!.mutable) throw why("can't change 'this'; it borrows 'this' read-only");
    if (!!f.self!.owned !== !!declared.self!.owned) throw why(declared.self!.owned ? "must take 'this: Own<this>'" : "can't take 'this: Own<this>'");
    const [error, allowed] = [errorOf(instance), errorOf(instanceOf(declared))];
    if (error && (!allowed || !fits(error, allowed))) throw why(allowed ? `can only throw '${show(allowed)}'` : "can't throw");
    const [gives, wanted] = [returnOf(instance, f), returnOf(instanceOf(declared), declared)];
    if (!fits(gives, wanted)) throw why(`must return '${show(wanted)}', not '${show(gives)}'`);
  }

  // What a call of an instance may throw, as its caller sees it.
  function errorOf(instance: Instance): Type | undefined {
    const f = instance.body;
    return f.throws && withScope(instance.bindings, () => resolveType(f.throws!));
  }

  function returnOf(instance: Instance, at: Span): Type {
    const f = instance.body;
    // A package's function gives what its signature made of its declaration for JS; a generic
    // one's definition gives what it declares, as each instance makes its own.
    if (f.js && instance.concrete) {
      checkBody(instance);
      return instance.returns;
    }
    const declared = returnTypeOf(f, instance.bindings);
    if (declared && !describes(declared)) return declared;
    if (inProgress.has(instance)) {
      if (f.generator) throw new CompileError("E0113", `a generator can't make another of itself, since its state would have to hold itself; loop inside one generator instead`, at.start, at.end);
      if (f.async) throw new CompileError("E0113", `an async function can't await another of itself, since its state would have to hold itself; loop inside one instead`, at.start, at.end);
      throw new CompileError("E0104", `'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
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
          if (!(e instanceof CompileError) || demanded === 0) {
            const thrown = instance.body.signature ? incompatible(instance.body, e) : e;
            if (thrown instanceof CompileError) failed.set(instance.body, thrown);
            throw thrown;
          }
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
    delete instance.envs;
    delete instance.dyns;
    delete instance.made;
    delete instance.predicates;
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
    if (fixedParam && f.foreign && !f.rust) throw new CompileError("E1002", "a C function can't take a comptime parameter: C takes every argument at run time", fixedParam.start, fixedParam.end);
    if (fixedParam && f.accessor) throw new CompileError("E1102", "an accessor can't take a comptime parameter, since a read or an assignment gives it no value while compiling", fixedParam.start, fixedParam.end);
    if (f.foreign) return foreignSignature(instance);
    if (f.abstract) {
      instance.returns = returnTypeOf(f, instance.bindings) ?? "void";
      done.add(instance);
      return;
    }
    if (f.js) return jsSignature(instance);
    if (fixedParam && (f.async || f.generator)) throw unsupported("comptime parameters on async functions and generators", fixedParam);
    if (fixedParam && f.exported) throw new CompileError("E1003", "an exported function can't take a comptime parameter, since C calls it with run-time values", fixedParam.start, fixedParam.end);
    inProgress.add(instance);
    const { types, locals, coercions, calls, setters, jumps } = instance;
    // A closure returns the number type the function type it meets returns, so its literals
    // take that type.
    const given = f.closure?.expected?.returns;
    let declared = f.closure ? (f.returnType ? stored(resolveType(f.returnType)) : given && isNumeric(given) ? given : undefined) : returnTypeOf(f, scopeOf(instance));
    // A generator's declared `Generator<T>`, or an async one's `AsyncGenerator<T>`, says what it
    // yields; calling it gives its own type.
    const generator = f.generator ? (instance.generator ??= madeBy(generatorType(f.name, instance.concrete, f.async === true), instance)) : undefined;
    const generatorName = f.async ? "AsyncGenerator" : "Generator";
    let yielded = generator && declared ? generatorElement(declared, f.async === true) : undefined;
    // What `next(x)` sends, which a `yield` whose value is used gives.
    const sends = generator && declared ? generatorSends(declared) : undefined;
    if (generator && sends !== undefined) generator.sends = instance.concrete ? lower(sends) : sends;
    if (generator && declared && !yielded) throw new CompileError("E0606", `${f.async ? "an async" : "a"} generator function's return type is '${generatorName}<T>', the type of what it yields`, f.returnType!.start, f.returnType!.end);
    if (generator) declared = undefined;
    if (yielded && holdsRef(yielded)) throw unsupported("generators yielding references", f.returnType!);
    // An async function's declared `Promise<T>` says what it gives once awaited; its `return`s
    // give that, and calling it gives its own future, which runs nothing until awaited.
    const future = f.async && !f.generator ? (instance.future ??= madeBy(futureType(f.name, instance.concrete), instance)) : undefined;
    if (future && declared) {
      const gives = promiseElement(declared);
      if (gives === undefined) throw new CompileError("E0305", "an async function's return type is 'Promise<T>', the type of what it gives once awaited", f.returnType!.start, f.returnType!.end);
      declared = gives;
    }
    // A function returning an interface returns its one concrete type, which must satisfy it.
    const trait = declared && typeof declared !== "string" && declared.kind === "interface" ? declared : undefined;
    // A function returning a generic function type returns the one generic function it gives.
    const family = declared && typeof declared !== "string" && declared.kind === "function" && declared.generic ? declared : undefined;
    if (trait || family) declared = undefined;
    let inferred: Type | undefined;
    // The awaits written where the state machine can stop at them.
    const awaitable = new NodeSet<Expr>();
    // The yields whose value is used where the generator can stop at them.
    const yieldable = new NodeSet<Expr>();
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
    // A call of a function whose result is `x is T` narrows its argument for x to T.
    const predicate = (call: Extract<Expr, { kind: "call" }>) => {
      const target = calls.get(call);
      const p = target?.body.returnType;
      if (!target || p?.kind !== "predicate" || !p.type) return undefined;
      const index = target.body.params.findIndex((x) => x.pattern.kind === "ident" && x.pattern.name === p.name);
      const type = withScope(target.bindings, () => resolveType(p.type!));
      return { index, type, narrows: (yes: boolean, no: boolean) => void ((yes || no) && (instance.predicates ??= new NodeMap()).set(call, { index, type, yes, no })) };
    };
    const proves = (e: Expr) => guard(tables, e, types, locals as NodeMap<Expr, Local>, narrowable, predicate);

    // A constructor's fields are unset until assigned, so until then `this` may only appear as
    // the target of an assignment to one of them, and the constructor can't return.
    const unset = new Set(f.self?.constructor ? classOf(f.self.type).required : []);
    let exempt: Expr | undefined;
    // A derived constructor's first statement, `super(...)`, fills the embedded base.
    // After its parameters' defaults, which `super(...)` may read.
    const superCall = f.self?.constructor && f.self.type.base ? (f.body.find((s) => !prologues.has(s)) as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (superCall) unset.add(SUPER);
    // Whether the constructor has assigned a field, an initializer's or its base's included. A
    // `new` that fails drops nothing, so from then on nothing in the constructor may throw.
    let built = false;

    // In a member of a generic class's instance, `this` is the class made from the type
    // parameters as this body sees them, so it reads through their bounds as the definition did.
    const generic = f.self?.type.generic;
    const viewed = generic && classNamed(generic.name, classOf(f.self!.type).node.typeParams.map((p) => resolveType({ id: nextId(ids), kind: "ref", name: p.name, args: [], start: f.start, end: f.start })), f)!;
    // A closure sees the `this` of the body it is written in, which it only reads.
    const enclosing = f.closure && selfOf(f);
    const self = f.closure ? enclosing && { ...enclosing, constructor: false, mutable: false, owned: false } : f.self && { ...f.self, type: viewed ?? f.self.type };
    const captures = instance.captures;

    const { value, read, condition, effect, coerce, result, expect, changesLocal, changesThis, adapt, finish, literalOnly, unsafely } = expressions({
      tables, types, locals, coercions, calls, setters, byName, classes, enums, enumInstance, patterns: instance.patterns, copiesOut: instance.copiesOut, construct, members,
      templateParams, definedClass, returnOf, resultOf, sourcesOf, borrowsFrom: instance.borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup, peek, reach,
      names: (at) => [...inScope(), ...reached([...byName.keys()].map((n) => n.replace(/^const /, "")), at)],
      classNames: (at) => reached([...classes.keys(), ...templates.keys()], at),
      envOf: (e, of, env) => void (instance.envs ??= new NodeMap()).set(e, { of, env }),
      dynOf: (e, table) => void (instance.dyns ??= new NodeMap()).set(e, table),
      nestedLocal,
      owning: f.closure !== undefined && (f.async === true || f.closure.move === true),
      self,
      owner: f.closure ? closureOwner(f) : f.declared ?? (f.owner && f.owner === f.self?.type ? self!.type : f.owner),
      superCall,
      selfCall,
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
          throw new CompileError("E0601", "this arm can reach its end without giving a value; give one with 'return', as in an arrow's block", arm.end - 1, arm.end);
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
      throwsDeclared: () => instance.throws,
      syncMain: timerMains.has(f as Func),
      thrown,
      noteThis,
      closing: f.closure !== undefined,
      generator: f.generator === true,
      runtime: !library && funcs.some((g) => g.name === "main" && g.async === true),
      locked: f.closure?.expected === undefined ? undefined : lockCallbacks.get(f.closure.expected),
      sharing: f.closure?.expected !== undefined && sharedCallbacks.has(f.closure.expected),
      async: f.async === true,
      awaitable,
      yieldable,
      yielding,
      unsafe: f.closure?.unsafe === true,
      changesCapture,
      reachable: (l) => !caseOnly.has(l),
      rewritten,
      depthOf: (l) => depths.get(l)!,
      closure,
      liftArrow,
      resolveWith: (t, scope) => withScope(scope, () => resolveType(t)),
      closureBody: (t) => closureBodies.get(t)!,
      resolveType,
      implicitOf,
      callbackType,
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
    const late = f.params.find((p, i) => !p.optional && !p.rest && f.params.slice(0, i).some((q) => q.optional));
    if (late) throw new CompileError("E0408", "a required parameter can't follow an optional one; move it before them, or make it optional too", late.start, late.end);
    // What the function may throw: any value's type. An arrow with none written takes it from the
    // function type it is given as, as it does its parameters' types, or else from what its body
    // can throw; a nested function declares its own.
    const contextual = f.closure && !f.throws && f.closure.self === undefined && !f.async && f.closure.expected && !openThrows.has(f.closure.expected) ? f.closure.expected : undefined;
    const inferring = f.closure !== undefined && !f.throws && f.closure.self === undefined && !contextual ? [] as [Expr | Stmt, Type][] : undefined;
    let errorType = f.throws ? resolveType(f.throws) : contextual?.throws;
    if (errorType === "void") throw new CompileError("E0118", "a function can't throw 'void'; throw a value", f.throws!.start, f.throws!.end);
    if (errorType && holdsRef(errorType)) throw unsupported("errors holding references", f.throws!);
    instance.throws = errorType;
    // Advancing a generator runs its body, so that is what throws, not calling it.
    if (generator && errorType) generator.throws = instance.concrete ? lower(errorType) : errorType;
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
      if (assigned || (s.kind === "expr" && s.expr === superCall)) built = true;
      return after;
    });
    finish();
    // An inferred error is every one the body lets out, widened as a `let` is.
    if (inferring && inferring.length > 0) {
      errorType = unionType(inferring.map(([, t]) => widenLet(t)));
      for (const [at, from] of inferring) instance.raises.set(at, { from, to: errorType });
      instance.throws = errorType;
    }
    if (unset.size > 0) {
      const missing = classOf(f.self!.type).fields.find((d) => unset.has(d.name))!;
      throw new CompileError("E0703", `property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    if (generator) {
      if (!yielded) throw new CompileError("E0606", `this generator never yields, so what it gives can't be told; declare it as '${generatorName}<T>'`, (f.returnType ?? f).start, (f.returnType ?? f).end);
      const laid = (t: Type) => (instance.concrete ? lower(t) : t);
      generator.yields = laid(yielded);
      generator.params = f.params.map((p, i) => ({ name: paramName(p), type: laid(params[i]!) }));
      // An async generator method's frame holds its object, as an async method's future does.
      if (f.self && !f.self.constructor) generator.params.unshift(receiverField(typing, f.self, laid));
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
      const self = f.self && !f.self.constructor ? receiverField(typing, f.self, laid) : undefined;
      if (self) future.params.unshift(self);
    }
    const type = generator ?? future ?? gives;
    if (f.closure && holdsRef(type)) throw unsupported("closures returning references", f.returnType ?? f.closure.value ?? f);
    if (!f.closure) lifetimes(f);
    // A returned value holding references may point into any parameter, or `this`.
    const everything: Origin[] = [...f.params.map((_, i) => i), ...(f.self && !f.self.owned ? ["this" as const] : [])];
    const ref = isRef(type) ? type : optionRef(type);
    const origins = ref ? originsOf(f, params, ref) : holdsRef(type) ? heldOrigins(f) ?? everything : [];
    if (gives !== "void" && !generator && !alwaysReturns(f.body, broken, continued)) {
      const at = f.returnType ?? f;
      throw new CompileError("E0601", "not all code paths return a value", at.start, at.end);
    }
    checkMoves(f, instance, origins);
    // A class's own `clone()` replaces the compiler's copy, so it has to make one.
    if (self && classOf(self.type).methods.get("clone") === f && (f.params.length > 0 || type !== self.type)) {
      throw new CompileError("E0213", `a 'clone' method must take no parameters and return '${show(self.type)}', since it replaces the compiler's copy`, f.start, f.end);
    }
    instance.returns = type;
    if (instance.concrete) lowerTables(instance);
    if (generator) frameOf(instance, generator);
    if (future) frameOf(instance, future);
    done.add(instance);
    inProgress.delete(instance);

    // Nested functions go right after the declarations of the variables they use, as early as
    // that allows, so a call before a function's own statement still finds it, as JavaScript's
    // hoisting does. A function using another goes after it.
    function hoist(list: Stmt[]) {
      // An async one takes over what it uses when it is made, so it stays where it is written.
      const functions = list.filter((s): s is Extract<Stmt, { kind: "function" }> => s.kind === "function" && s.body !== undefined && !s.async);
      if (functions.length === 0) return;
      const declared = (s: Stmt): string[] => (s.kind === "let" ? s.declarations.flatMap((d) => namesIn(d.target)) : s.kind === "function" ? [s.name] : []);
      for (let pass = 0; pass < functions.length; pass++) {
        for (const fn of functions) {
          const used = freeNames(fn);
          list.splice(list.indexOf(fn), 1);
          let at = 0;
          list.forEach((s, i) => declared(s).some((n) => n !== fn.name && used.has(n)) && (at = i + 1));
          list.splice(at, 0, fn);
        }
      }
    }

    // `name(...)` inside the nested function `name`: a call of itself, with its own captures.
    function selfCall(e: Extract<Expr, { kind: "call" }>): { type: Type; what: string } | undefined {
      const name = (e.callee as Extract<Expr, { kind: "ident" }>).name;
      // A name the body declares itself is that, not the function.
      if (f.closure?.self !== name || scopes.some((scope) => scope.has(name))) return undefined;
      if (!f.returnType) throw new CompileError("E0104", `'${name}' calls itself, so its return type has to be written, as TypeScript requires, as in 'function ${name}(...): T'`, e.start, e.end);
      if (f.async) throw unsupported("async nested functions that call themselves", e);
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (e.args.length < required || e.args.length > f.params.length) throw new CompileError("E0501", `expected ${required === f.params.length ? required : `${required}-${f.params.length}`} arguments, but got ${e.args.length}`, e.start, e.end);
      e.args.forEach((a, i) => {
        const to = locals.get(f.params[i]!)!.type;
        expect(a, to);
        const t = value(a);
        coerce(a, t, to, `argument of type '${show(t)}' is not assignable to parameter of type '${show(to)}'`);
      });
      selfCalls.add(e);
      calls.set(e, instance);
      if (errorType) raise(e, errorType, `'${name}'`);
      return { type: resolveType(f.returnType), what: `'${name}'` };
    }

    // `let x: T` declares a variable that holds nothing until assigned; the moves check refuses
    // every use before that, as TypeScript's definite assignment does.
    function unassigned(s: Stmt, d: Declarator, name: string): undefined {
      if (!d.type) throw new CompileError("E0406", `'${name}' needs a type to be declared without a value, like 'let ${name}: string'; Fish doesn't work it out from later assignments`, d.start, d.end);
      const type = stored(resolveType(d.type));
      if (lower(type) === "void") throw new CompileError("E0118", `'${name}' can't be of type 'void', which no value has`, d.start, d.end);
      if (isInterface(type)) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since an interface describes a value of some concrete type`, d.start, d.end);
      if (typeof type !== "string" && type.kind === "function" && type.generic) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since a generic function type describes the generic function it holds`, d.start, d.end);
      declare(name, type, true, false, s);
      return undefined;
    }

    // `[a, b] = [b, a]`, in JavaScript's order: the right side is evaluated whole, into fresh
    // variables, then each target is assigned its part in turn, a default taken at its own
    // target, after the targets before it. An array or object literal on the right is taken
    // part by part, each part typed as its target is, so a swap of values that move needs no
    // array and a literal meets its target's type.
    function destructuring(e: Extract<Expr, { kind: "destructure" }>): Stmt[] {
      // Every part is read first, then every target written, so a target can't change what a
      // later part reads, as in '({ a: o.b, b: o.a } = o)'.
      const reads: Stmt[] = [];
      const writes: Stmt[] = [];
      const fresh = () => `destructured ${counts.destructures++}`;
      const ident = (name: string, at: Span): Expr => ({ id: nextId(ids), kind: "ident", name, start: at.start, end: at.end });
      const declare = (target: Pattern, init: Expr, at: Span, typedAs?: Expr): Stmt => {
        const s: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target, type: undefined, init, start: at.start, end: at.end }], start: at.start, end: at.end };
        if (typedAs) destructuredParts.set(s, typedAs);
        return s;
      };
      const targetOf = (p: Pattern): Expr | undefined => (p.kind === "ident" ? ident(p.name, p) : p.kind === "expr" ? p.expr : p.kind === "default" ? targetOf(p.target) : undefined);
      // Writes what `part` reads to a target, its default taken when the part is an empty Option.
      const write = (p: Pattern, part: Expr) => {
        if (p.kind === "default") {
          const or: Expr = { id: nextId(ids), kind: "binary", op: "??", left: part, right: p.value, start: p.start, end: p.end };
          unusedDefaults.add(or);
          return write(p.target, or);
        }
        if (p.kind === "ident" || p.kind === "expr") return void writes.push({ id: nextId(ids), kind: "expr", expr: { id: nextId(ids), kind: "assign", op: "=", target: targetOf(p)!, value: part, start: p.start, end: p.end }, start: p.start, end: p.end });
        // A nested pattern takes apart what the part holds, from its fresh variable.
        from(p, part);
      };
      // A place is read where it is, piece by piece, so only the pieces named move out of it,
      // as a declaration's destructuring does; anything else is held in a fresh variable first.
      // A chain reading a getter isn't one: its getter runs once, into a fresh variable.
      const place = (v: Expr): boolean => v.kind === "ident" || v.kind === "this" || (v.kind === "member" && !v.optional && !getterNames.has(v.name) && place(v.object));
      const from = (p: Pattern, value: Expr) => {
        if (p.kind !== "array" && p.kind !== "object") throw new CompileError("E0003", "this can't be a destructuring target; assign to a variable, a field or an element", p.start, p.end);
        // A literal is taken part by part, each part typed as its target.
        if (p.kind === "array" && value.kind === "array" && !value.elements.some((x) => x?.kind === "spread" || x === undefined)) {
          const parts = (value.elements as Expr[]).map((x, i) => {
            const q = p.elements[i];
            const inner = q && (q.kind === "default" ? q.target : q);
            // A nested literal for a nested pattern is taken apart in turn.
            if (inner && (inner.kind === "array" || inner.kind === "object") && (x.kind === "array" || x.kind === "object") && q.kind !== "default") return { nested: x };
            const name = fresh();
            reads.push(declare({ id: nextId(ids), kind: "ident", name, start: x.start, end: x.end }, x, x, q && targetOf(q)));
            return { read: ident(name, x) };
          });
          p.elements.forEach((q, i) => {
            if (!q) return;
            const part = parts[i];
            if (part?.nested) return from(q, part.nested);
            if (part?.read) return write(q, part.read);
            if (q.kind !== "default") throw new CompileError("E0003", `the array on the right has no element at index ${i} for this target`, q.start, q.end);
            write(q.target, q.value);
          });
          if (p.rest) write(p.rest, { id: nextId(ids), kind: "array", elements: parts.slice(p.elements.length).map((x) => x.read!), start: value.start, end: value.end });
          return;
        }
        if (p.kind === "object" && !p.rest && value.kind === "object" && value.props.every((x) => x.kind === "property" && typeof x.key === "string") && p.props.every((x) => typeof x.key === "string")) {
          const parts = new Map(value.props.map((x) => {
            const prop = x as Extract<ObjectProp, { kind: "property" }>;
            const name = fresh();
            const q = p.props.find((y) => y.key === prop.key)?.value;
            reads.push(declare({ id: nextId(ids), kind: "ident", name, start: prop.start, end: prop.end }, prop.value, prop, q && targetOf(q)));
            return [prop.key as string, ident(name, prop)];
          }));
          for (const prop of p.props) {
            const part = parts.get(prop.key as string);
            if (part) write(prop.value, part);
            else if (prop.value.kind === "default") write(prop.value.target, prop.value.value);
            else throw new CompileError("E0003", `the object on the right has no property '${String(prop.key)}' for this target`, prop.start, prop.end);
          }
          return;
        }
        let whole = value;
        if (!place(value)) {
          const name = fresh();
          reads.push(declare({ id: nextId(ids), kind: "ident", name, start: value.start, end: value.end }, value, value));
          whole = ident(name, value);
        }
        // Each top-level piece is read by a declaration naming only it, nested patterns down to
        // their leaves, so only the leaves move out of a place. A slot with a default reads
        // nothing past the end; the default itself is taken at the target.
        const span = { start: p.start, end: p.end };
        const leaves: [Pattern, string][] = [];
        const shape = (q: Pattern): Pattern => {
          const at = { start: q.start, end: q.end };
          if (q.kind === "default" && (q.target.kind === "ident" || q.target.kind === "expr")) {
            const name = fresh();
            leaves.push([q, name]);
            return { id: nextId(ids), kind: "default", target: { id: nextId(ids), kind: "ident", name, ...at }, value: { id: nextId(ids), kind: "null", ...at }, ...at };
          }
          if (q.kind === "ident" || q.kind === "expr") {
            const name = fresh();
            leaves.push([q, name]);
            return { id: nextId(ids), kind: "ident", name, ...at };
          }
          if (q.kind === "array") return { ...q, id: nextId(ids), elements: q.elements.map((x) => x && shape(x)), rest: q.rest && shape(q.rest) };
          if (q.kind === "object") return { ...q, id: nextId(ids), props: q.props.map((x) => ({ ...x, id: nextId(ids), value: shape(x.value) })), rest: q.rest && shape(q.rest) };
          throw new CompileError("E0003", "this can't be a destructuring target; assign to a variable, a field or an element", q.start, q.end);
        };
        if (p.kind === "array") {
          p.elements.forEach((q, i) => q && reads.push(declare({ id: nextId(ids), kind: "array", elements: [...Array<undefined>(i).fill(undefined), shape(q)], rest: undefined, ...span }, whole, q)));
          if (p.rest) reads.push(declare({ id: nextId(ids), kind: "array", elements: Array<undefined>(p.elements.length).fill(undefined), rest: shape(p.rest), ...span }, whole, p.rest));
        } else if (p.rest) {
          // An object's rest is read with every property it leaves out, in one declaration.
          reads.push(declare(shape(p), whole, p));
        } else for (const prop of p.props) reads.push(declare({ id: nextId(ids), kind: "object", props: [{ ...prop, id: nextId(ids), value: shape(prop.value) }], rest: undefined, ...span }, whole, prop.value));
        for (const [q, name] of leaves) write(q, ident(name, q));
      };
      from(e.pattern, e.value);
      return [...reads, ...writes];
    }

    // The type a destructured part's fresh variable takes: its target's, as declared.
    function partType(s: Stmt): Type | undefined {
      const target = destructuredParts.get(s);
      if (!target) return undefined;
      if (target.kind === "ident") return lookup(target.name)?.type;
      // A field of 'this' has its declared type, which a constructor may not read yet.
      if (target.kind === "member" && target.object.kind === "this" && f.self) return allFields(f.self.type as ClassType).find((x) => x.name === target.name)?.type;
      // A target with only a setter can't be read for its type; its part keeps its own.
      try {
        const t = value(renumber(structuredClone(target), () => nextId(ids)));
        return typeof t !== "string" && t.kind === "ref" ? undefined : t;
      } catch (err) {
        if (err instanceof CompileError) return undefined;
        throw err;
      }
    }

    // `let a = 1, b = a` is a declaration per name, in order, each seeing those before it. A
    // `for` head's go in a block around the loop, which scopes them as the head does.
    function separate(list: Stmt[]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i]!;
        if (s.kind === "expr" && s.expr.kind === "destructure") {
          list.splice(i, 1, ...destructuring(s.expr));
          continue;
        }
        if (s.kind === "let" && s.declarations.length > 1) {
          list.splice(i, 1, ...s.declarations.map((d, n): Stmt => ({ ...s, id: nextId(ids), declarations: [d], start: n === 0 ? s.start : d.start, end: d.end })));
          continue;
        }
        let loop = s;
        while (loop.kind === "labeled") loop = loop.body;
        if (loop.kind === "for" && loop.init?.kind === "let" && loop.init.declarations.length > 1) {
          list[i] = { id: nextId(ids), kind: "block", body: [loop.init, s], start: s.start, end: s.end };
          loop.init = undefined;
        }
      }
    }

    // Checks a list of statements in order. What an `if` that leaves early proves holds for
    // the statements after it.
    function statements(list: Stmt[], each: (s: Stmt, check: (s: Stmt) => Facts | undefined) => Facts | undefined = (s: Stmt, check: (s: Stmt) => Facts | undefined) => check(s)) {
      separate(list);
      hoist(list);
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

    // `const { a, b: c = 1, ...rest } = v` and `const [x, , y = 0] = v`: the value goes to a
    // variable named for the pattern, and each name becomes a declaration of its part after it,
    // in the list being checked, so the names own the parts as Rust's `let` does. A nested
    // pattern is a declaration of its own, destructured in turn. A default is taken when its
    // part is null.
    function destructured(s: Extract<Stmt, { kind: "let" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>, place: { list: Stmt[]; at: number } | undefined): undefined {
      if (!place || place.list[place.at] !== s) throw unsupported("destructuring patterns here", pattern);
      // A place is read part by part where it is, so only the parts named move out of it, as in
      // Rust; any other value goes to a variable named for the pattern, as messages show it.
      if (!d.init) throw new CompileError("E0406", "a destructuring declaration needs its value where it is declared, as TypeScript requires", d.start, d.end);
      const init = d.init;
      const read = (e: Expr): boolean => e.kind === "ident" || e.kind === "this" || ((e.kind === "member" || e.kind === "index") && !e.optional && read(e.object));
      // A getter along the path runs each time the path is read, so its result is kept once.
      const computed = (e: Expr): boolean => (e.kind === "member" && calls.has(e)) || ((e.kind === "member" || e.kind === "index") && computed(e.object));
      let type = read(init) && !d.type ? value(init) : undefined;
      const inPlace = type !== undefined && !computed(init);
      let from: (at: Span) => Expr;
      // An index that isn't a number written in place runs once, into a variable of its own, in
      // the order the path reads them.
      const hoisted: Stmt[] = [];
      if (inPlace) {
        const indexes = new NodeMap<Expr, string>();
        for (let e = init; e.kind === "member" || e.kind === "index"; e = e.object) {
          if (e.kind !== "index" || e.index.kind === "int") continue;
          const name = `index ${e.index.start}`;
          indexes.set(e, name);
          const at = { start: e.index.start, end: e.index.end };
          // An index into an array or a string is a `usize`, which gives a literal sum its type.
          const usize: TypeNode = { id: nextId(ids), kind: "ref", name: "usize", args: [], ...at };
          hoisted.unshift({ id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name, ...at }, type: usize, init: e.index, ...at }], ...at });
        }
        const copy = (e: Expr, at: Span): Expr => {
          if (e.kind === "member") return { ...e, id: nextId(ids), object: copy(e.object, at), start: at.start, end: at.end };
          if (e.kind !== "index") return { ...e, id: nextId(ids), start: at.start, end: at.end };
          const name = indexes.get(e);
          const index: Expr = name ? { id: nextId(ids), kind: "ident", name, start: e.index.start, end: e.index.end } : { ...e.index, id: nextId(ids) };
          return { ...e, id: nextId(ids), object: copy(e.object, at), index, start: at.start, end: at.end };
        };
        from = (at) => copy(init, at);
        Object.assign(s, { kind: "empty" });
      } else {
        const held = patternText(pattern);
        Object.assign(d, { target: { id: nextId(ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
        statement(s);
        type = locals.get(s)!.type;
        from = (at) => ({ id: nextId(ids), kind: "ident", name: held, start: at.start, end: at.end });
      }
      const destructuring: Type = type!;
      // A top-level const is read where it lives rather than lent.
      let root = init;
      while (root.kind === "member" || root.kind === "index") root = root.object;
      const global = inPlace && root.kind === "ident" && !locals.has(root);
      const borrowed = isRef(destructuring) && !global;
      const lowered = lower(isRef(destructuring) ? destructuring.to : destructuring);
      // An object-typed parameter stands for any type with its fields, which its bound names.
      const whole = typeof lowered !== "string" && lowered.kind === "param" && lowered.bound?.kind === "object" ? lowered.bound : lowered;
      const parts: [Pattern, Expr, Type][] = [];
      // A part with a default: what the part holds, or the default when it is null.
      const part = (target: Pattern, read: Expr, t: Type) => {
        if (target.kind !== "default") return parts.push([target, read, t]);
        const empty = t === "null" || (typeof t !== "string" && t.kind === "union" && t.members.includes("null"));
        parts.push([target.target, empty ? { id: nextId(ids), kind: "binary", op: "??", left: read, right: target.value, start: target.start, end: target.end } : read, t]);
      };
      if (pattern.kind === "object") {
        if (typeof whole === "string" || (whole.kind !== "object" && whole.kind !== "class")) {
          throw new CompileError("E0003", `'{ ... }' destructures an object or an instance, not '${show(destructuring)}'`, pattern.start, pattern.end);
        }
        const taken = new Set<string>();
        for (const p of pattern.props) {
          if (typeof p.key !== "string") throw unsupported("computed keys in destructuring patterns", p);
          const f = field(whole, p.key);
          if (!f) throw new CompileError("E0502", `property '${p.key}' does not exist on type '${show(whole)}'`, p.start, p.end);
          taken.add(p.key);
          part(p.value, { id: nextId(ids), kind: "member", object: from(p), name: p.key, optional: false, start: p.start, end: p.end }, f.type);
        }
        // The rest is an object of the fields the pattern didn't name, taken over.
        if (pattern.rest) {
          const fields = whole.kind === "class" ? allFields(whole) : whole.fields;
          const props = fields.filter((f) => !taken.has(f.name) && (f.access ?? "public") === "public").map((f): ObjectProp => ({ id: nextId(ids), kind: "property", key: f.name, value: { id: nextId(ids), kind: "member", object: from(pattern.rest!), name: f.name, optional: false, start: pattern.rest!.start, end: pattern.rest!.end }, start: pattern.rest!.start, end: pattern.rest!.end }));
          parts.push([pattern.rest, { id: nextId(ids), kind: "object", props, start: pattern.rest.start, end: pattern.rest.end }, whole]);
        }
      } else if (isTuple(whole)) {
        const elements = elementsOf(whole as ObjectType);
        const many = (whole as ObjectType).rest;
        if (pattern.elements.length > elements.length && many === undefined) throw new CompileError("E0117", `tuple type '${show(whole)}' of length ${elements.length} has no element at index ${elements.length}`, pattern.start, pattern.end);
        // A rest tuple's `...rest` takes its array where its fixed elements end, or a copy of the
        // part after the names taken from it, as an array pattern's rest is, when they copy.
        const later = pattern.elements.length - elements.length;
        if (pattern.rest && (many === undefined || later < 0 || (later > 0 && !isCopy(many)))) throw unsupported(many === undefined ? "rest elements in tuple patterns" : later < 0 ? "rest patterns that don't start where a tuple's rest elements do" : "rest patterns after names taken from rest elements whose type doesn't copy", pattern.rest);
        pattern.elements.forEach((p, i) => {
          if (!p) return;
          const at = { start: p.start, end: p.end };
          // With a default, an element past the fixed ones may be missing, so it is read as
          // `.at(i)` on the rest, which an array pattern's default reads too.
          if (i >= elements.length && p.kind === "default") {
            // Read with `.at(i)`, a value that doesn't copy would be copied where `t[i]` moves it.
            if (!isCopy(many!)) throw new CompileError("E0117", `a default past a tuple's fixed elements would take a '${show(many!)}' out of the tuple's rest when it is there, leaving a hole; destructure without the default, or index it and clone`, p.start, p.end);
            const array: Expr = { id: nextId(ids), kind: "member", object: from(p), name: "...", optional: false, ...at };
            restStarts.set(array, elements.length);
            const read: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: array, name: "at", optional: false, ...at }, args: [{ id: nextId(ids), kind: "int", value: BigInt(i - elements.length), ...at }], typeArgs: [], optional: false, ...at };
            return part(p, read, unionType([many!, "null"]));
          }
          part(p, { id: nextId(ids), kind: "index", object: from(p), index: { id: nextId(ids), kind: "int", value: BigInt(i), ...at }, optional: false, ...at }, elements[i] ?? many!);
        });
        if (pattern.rest) {
          const at = { start: pattern.rest.start, end: pattern.rest.end };
          const array: Expr = { id: nextId(ids), kind: "member", object: from(pattern.rest), name: "...", optional: false, ...at };
          restStarts.set(array, elements.length);
          const taken: Expr = later === 0 ? array : { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: array, name: "slice", optional: false, ...at }, args: [{ id: nextId(ids), kind: "int", value: BigInt(later), ...at }], typeArgs: [], optional: false, ...at };
          part(pattern.rest, taken, arrayType(many!));
        }
      } else if (typeof whole !== "string" && whole.kind === "array") {
        // An array's elements are read as `xs[i]`, which a value that moves would leave a hole in.
        if (!isCopy(whole.element)) throw new CompileError("E0202", `an array pattern reads each element as 'xs[i]', and a '${show(whole.element)}' would be moved out of the array, leaving a hole; index it and clone, or loop over it`, pattern.start, pattern.end);
        pattern.elements.forEach((p, i) => {
          if (!p) return;
          const at = { start: p.start, end: p.end };
          const index: Expr = { id: nextId(ids), kind: "int", value: BigInt(i), ...at };
          // With a default, a missing element is the default rather than a panic.
          const read: Expr = p.kind === "default"
            ? { id: nextId(ids), kind: "binary", op: "??", left: { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: from(p), name: "at", optional: false, ...at }, args: [index], typeArgs: [], optional: false, ...at }, right: p.value, ...at }
            : { id: nextId(ids), kind: "index", object: from(p), index, optional: false, ...at };
          parts.push([p.kind === "default" ? p.target : p, read, whole.element]);
        });
        if (pattern.rest) {
          const at = { start: pattern.rest.start, end: pattern.rest.end };
          const slice: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: from(pattern.rest), name: "slice", optional: false, ...at }, args: [{ id: nextId(ids), kind: "int", value: BigInt(pattern.elements.length), ...at }], typeArgs: [], optional: false, ...at };
          parts.push([pattern.rest, slice, whole]);
        }
      } else throw new CompileError("E0003", `'[ ... ]' destructures a tuple, like '[i64, string]', or an array, not '${show(destructuring)}'`, pattern.start, pattern.end);
      const lets: Stmt[] = parts.map(([target, init]): Stmt => {
        const at = { start: target.start, end: target.end };
        const declarator: Declarator = { id: nextId(ids), target, type: undefined, init, ...at };
        // A part of a borrowed value is borrowed too, as a loop's pattern's parts are; an array's
        // parts copy.
        if (borrowed && target.kind === "ident" && (init.kind === "member" || (init.kind === "index" && isTuple(whole)))) loopParts.add(declarator);
        return { id: nextId(ids), kind: "let", keyword: s.keyword, declarations: [declarator], ...at };
      });
      // A parameter's parts come before a derived constructor's `super(...)`, as its whole did.
      if (prologues.has(s)) for (const l of [...hoisted, ...lets]) prologues.add(l);
      place.list.splice(place.at + 1, 0, ...hoisted, ...lets);
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
          return n ? [[n, (from: Expr): Expr => ({ id: nextId(ids), kind: "index", object: from, index: { id: nextId(ids), kind: "int", value: BigInt(i), start: n.start, end: n.end }, optional: false, start: n.start, end: n.end })]] : [];
        })
        : pattern.props.map((p) => {
          if (typeof p.key !== "string") throw unsupported("computed keys in destructuring patterns", p);
          const key = p.key;
          return [named(p.value)!, (from: Expr): Expr => ({ id: nextId(ids), kind: "member", object: from, name: key, optional: false, start: p.start, end: p.end })];
        });
      const held = pattern.kind === "array" ? `[${pattern.elements.map((p) => (p?.kind === "ident" ? p.name : "")).join(", ")}]` : `{ ${parts.map(([n]) => n.name).join(", ")} }`;
      const lets: Stmt[] = parts.map(([n, part]) => {
        const at = { start: n.start, end: n.end };
        const declarator: Declarator = { id: nextId(ids), target: n, type: undefined, init: part({ id: nextId(ids), kind: "ident", name: held, ...at }), ...at };
        loopParts.add(declarator);
        return { id: nextId(ids), kind: "let", keyword: (s.left as Extract<Stmt, { kind: "let" }>).keyword, declarations: [declarator], ...at };
      });
      Object.assign(d, { target: { id: nextId(ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
      // The loop's own body is a block inside the parts' scope, so it may declare their names.
      const body: Stmt = { id: nextId(ids), kind: "block", body: s.body, start: s.body[0]?.start ?? s.end, end: s.end };
      s.body = [...lets, body];
    }

    // A name a loop's pattern binds: its part of the element, borrowed when the element is.
    function loopPart(s: Extract<Stmt, { kind: "let" }>, d: Declarator): undefined {
      const init = d.init!;
      const object = init.kind === "index" || init.kind === "member" ? init.object : init;
      const whole = value(object);
      const element = isRef(whole) ? whole.to : whole;
      if (init.kind === "index" && !isTuple(element)) throw new CompileError("E0801", `only tuples, like '[i64, string]', can be destructured so far, not '${show(element)}'`, d.start, d.end);
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
        throw new CompileError("E0109", `can't give '${l.name}' another member inside a closure while a check outside it narrows it; assign its fields instead`, at.start, at.end);
      }
      const from = facts.findIndex((f) => f.has(l));
      if (from < 0) return;
      // Inside a larger expression, a condition could still prove the member it had.
      if (at !== whole) {
        throw new CompileError("E0109", `can't give '${l.name}' another member inside a larger expression while a check narrows it; assign it as a statement of its own`, at.start, at.end);
      }
      changed.push(l);
      if (targets.some((t) => t.kind === "loop" && t.facts! > from)) {
        throw new CompileError("E0109", `can't give '${l.name}' another member inside a loop here: a check outside the loop narrowed it; assign its fields instead, or check it inside the loop`, at.start, at.end);
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
      // An async arrow's future usually outlives the call making it, so it owns its captures.
      owning ||= e.async;
      const value = Array.isArray(e.body) ? undefined : e.body;
      const body: Body = {
        id: nextId(ids), name: f.name, params: e.params, returnType: e.returnType, ...(e.throws && { throws: e.throws }), start: e.start, end: e.end, async: e.async || undefined, closure: { value, parent: instance, expected, move: e.move || owning, unsafe, self: nestedFunctions.get(e), made: madeArrows.has(e) || undefined },
        body: value ? [{ id: nextId(ids), kind: "return", value, start: value.start, end: value.end }] : (e.body as Stmt[]),
      };
      const inner: Instance = {
        tables, body, symbol: `${instance.symbol}.closure${closures.filter((c) => c.body.closure!.parent === instance).length}`,
        bindings: instance.bindings, concrete: instance.concrete, depth: instance.depth, returns: "void",
        types: new NodeMap(), locals: new NodeMap(), calls: new NodeMap(), setters: new NodeMap(), coercions: new NodeMap(), jumps: new NodeMap(), borrowsFrom: new NodeMap(), raises: new NodeMap(), caught: new NodeMap(), consumes: new NodeSet(), patterns: new NodeMap(), copiesOut: new NodeSet(),
      };
      inner.captures = new Map();
      inner.captureUses = new Map();
      inner.changed = new Set();
      inner.moved = new Set();
      closures.push(inner);
      withSight(inSight, () => checkInstance(inner, { lookup, peek, inScope, reach, narrowed, thisReady, noteThis, changesLocal, changesThis, constant, inSight }));
      const sup = [...inner.types.keys()].find((u) => u.kind === "super");
      if (sup) throw unsupported("'super' in closures", sup);
      // A closure owning what it captures holds a nested function it uses as made here, so it
      // borrows what that function uses, as this body has it.
      if (e.async || inner.body.closure!.move) {
        for (const [, from] of inner.captures) {
          if (from === "this" || !nestedLocal(from)) continue;
          const of = closureBodies.get(lower(from.type) as ClosureType)!;
          const env = [...of.captures!].map(([alias, x]) => {
            const mine = reach(x as Local, e);
            if (of.changed?.has(alias)) changesLocal(mine, "", "change", e, false);
            return mine;
          });
          (instance.made ??= new NodeMap()).set(e, [...(instance.made.get(e) ?? []), { of, env }]);
        }
      }
      // A nested function runs whenever it is called, so it can't take over what it uses.
      const nested = nestedFunctions.get(e);
      if (nested !== undefined) {
        const self = [...inner.captures].find(([, from]) => from === "this");
        if (self) throw new CompileError("E0708", `'this' inside the nested function '${nested}' isn't the enclosing method's; pass what it needs as a parameter`, (inner.captureUses!.get(self[0]) ?? e).start, (inner.captureUses!.get(self[0]) ?? e).end);
        // An async one takes its own copy of what it uses when it is made, which a later change
        // to a `let` wouldn't reach, as it would in JavaScript.
        const changing = e.async ? [...inner.captures].find(([, from]) => from !== "this" && from.mutable) : undefined;
        if (changing) throw new CompileError("E0210", `the async nested function '${nested}' takes its own copy of '${changing[0].name}' when it is made, so a later change to it wouldn't reach the function; pass '${changing[0].name}' as a parameter, or make it a 'const'`, (inner.captureUses!.get(changing[0]) ?? e).start, (inner.captureUses!.get(changing[0]) ?? e).end);
        const moved = [...inner.moved!][0];
        if (moved) throw new CompileError("E0202", `the nested function '${nested}' moves '${moved.name}' out of the variables it uses, which a second call couldn't do again; take it as a parameter instead`, (inner.captureUses!.get(moved) ?? e).start, (inner.captureUses!.get(moved) ?? e).end);
      }
      // A shared value's `update` callback lends its parameter only through its fields.
      if (f.closure?.expected && sharedCallbacks.has(f.closure.expected)) {
        for (const [alias, from] of inner.captures!) {
          const held = from === "this" ? undefined : typeof from.type !== "string" && from.type.kind === "ref" ? from.type.to : from.type;
          if (from !== "this" && from.param && held !== undefined && interiorMutable(held)) {
            const at = inner.captureUses!.get(alias) ?? e;
            throw new CompileError("E0304", `a closure inside a shared value's 'update' can't capture '${alias.name}': other tasks borrow its interior-mutable parts without the lock`, at.start, at.end);
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
      // An async arrow's call only makes its future, which carries what it throws.
      const throws = inner.future ? undefined : inner.throws && laid(inner.throws);
      const type = madeBy(closureType(e.params.map((p) => writtenName(tables, p)), e.params.map((p) => inner.locals.get(p)!.type), inner.future ?? inner.returns, fields, [...inner.moved!][0]?.name, inner.concrete, throws), inner);
      // One throwing what the function type it is given as doesn't take can't be given as it.
      if (expected && throws && e.throws && !openThrows.has(expected) && !(expected.throws && fits(throws, expected.throws))) {
        const takes = expected.throws ? `which throws '${show(expected.throws)}'` : "which throws nothing";
        throw new CompileError("E0602", `this closure throws '${show(throws)}', but it is given as '${show(expected)}', ${takes}; catch it inside the closure with try/catch`, e.throws.start, e.throws.end);
      }
      // An async one's future throws, which a function type giving a Promise can't say yet.
      const failing = inner.future?.throws;
      if (expected && failing && !openThrows.has(expected) && promiseElement(expected.returns) !== undefined) {
        const at = e.throws ?? [...inner.raises.keys()][0] ?? e;
        throw new CompileError("E0602", `this async closure throws '${show(failing)}', but it is given as '${show(expected)}', whose Promise throws nothing; catch it inside the closure with try/catch`, at.start, at.end);
      }
      // Each call's future works on its own copy of the captures, so a change would be lost.
      const changed = e.async ? [...inner.changed!][0] : undefined;
      if (changed) {
        const at = inner.captureUses!.get(changed) ?? e;
        if (timerWrappers.has(e)) throw new CompileError("E0210", `a timer's function owns what it captures, so changing '${changed.name}' would change only its own copy; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
        throw new CompileError("E0210", `this async arrow changes '${changed.name}', which it captured, but each call's future works on its own copy, so the change would be lost; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
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
        throw new CompileError("E0506", `'${show(expected)}' passes ${n} argument${n === 1 ? "" : "s"}, so this closure can't take '${paramName(p)}'`, p.start, p.end);
      }
      if (p.comptime) throw unsupported("comptime parameters on closures", p);
      if (p.rest) throw unsupported("rest parameters on arrow functions", p);
      const plain = !p.rest && !p.optional && !p.default && p.modifiers.length === 0 && p.decorators.length === 0 && paramName(p) !== "this";
      // A declared function's parameter, named as a value, is typed where the function is declared.
      // A closure is one compiled function, so a function it takes is a stored callable.
      const written = presetParams.get(p) ?? (!p.type && given && plain ? given : paramType(p));
      const type = typeof written !== "string" && written.kind === "function" && !written.generic ? stored(written) : written;
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
            const topic = { id: nextId(ids), kind: "ident" as const, name: "%", start, end };
            const each: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: topic, type: undefined, init: undefined, start, end }], start, end };
            const body: Stmt[] = [{ id: nextId(ids), kind: "expr", expr: { id: nextId(ids), kind: "yield", value: { ...topic, id: nextId(ids) }, delegate: false, start, end }, start, end }];
            Object.assign(s, { kind: "forOf", await: false, left: each, right: value, body });
            delete (s as { expr?: unknown }).expr;
            return statement(s);
          }
          if (s.expr.kind === "yield") {
            yielding(s.expr);
            return;
          }
          if (isAwait(s.expr)) awaiting(s.expr);
          if (s.expr.kind === "assign" && s.expr.value.kind === "yield") {
            // The target is found after the generator resumes, so it must be one that can be.
            let root: Expr = s.expr.target;
            while (root.kind === "member") root = root.object;
            if (s.expr.op !== "=" || (root.kind !== "ident" && root.kind !== "this")) {
              throw new CompileError("E0801", "'yield' can only be assigned with '=' to a variable or a field for now; yield into a 'const' first, then use it", s.expr.start, s.expr.end);
            }
            yieldable.add(s.expr.value);
          }
          if (s.expr.kind === "assign" && isAwait(s.expr.value)) {
            // The target is found after the await resumes, so it must be one that can be.
            let root: Expr = s.expr.target;
            while (root.kind === "member") root = root.object;
            if (s.expr.op !== "=" || (root.kind !== "ident" && root.kind !== "this")) {
              throw new CompileError("E0801", "'await' can only be assigned with '=' to a variable or a field for now; await into a 'const' first, then use it", s.expr.start, s.expr.end);
            }
            awaiting(s.expr.value);
          }
          effect(s.expr);
          // A promise runs only when awaited, so one made and dropped would silently do nothing.
          const pausing = s.expr.kind === "call" && s.expr.callee.kind === "ident" && ["yieldNow", "sleep"].includes(s.expr.callee.name) && !byName.has(s.expr.callee.name);
          const made = pausing ? YIELD_NOW : types.get(s.expr) ?? calls.get(s.expr)?.returns;
          const boxed = typeof made !== "string" && made?.kind === "dyn" && promiseElement(made.of) !== undefined;
          if (s.expr.kind !== "assign" && s.expr.kind !== "destructure" && typeof made !== "string" && (made?.kind === "future" || boxed)) {
            // The prelude's call of a promise's executor: the executor written gives a Promise.
            const callee = s.start >= STD_BASE && s.expr.kind === "call" ? types.get(s.expr.callee) : undefined;
            const executor = callee === undefined ? undefined : lower(callee);
            if (typeof executor !== "string" && executor?.kind === "closure") {
              const written = closureBodies.get(executor)!.body;
              throw new CompileError("E0305", "an executor runs at once and what it gives is dropped, so the Promise it gives would never run; keep 'resolve' and await that call beside this Promise, as in 'Promise.all([promise, later(resolve)])'", written.start, written.end);
            }
            // `spawn` runs only an async function's call, and only inside an async function.
            const spawnable = f.async === true && !pausing && !boxed && made.kind === "future" && !leafOf.has(made);
            throw new CompileError("E0302", `this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'${spawnable ? ", or wrap the call in 'spawn(...)' for fire-and-forget" : ""}`, s.expr.start, s.expr.end);
          }
          // Past an assertion its condition holds, as TypeScript's `asserts cond` says.
          if (s.expr.kind === "call" && asserts.has(s.expr)) return proves(s.expr.args[0]!).yes;
          return;
        case "let": {
          if (s.keyword === "var") throw new CompileError("E0802", "'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
          const d = s.declarations[0]!;
          if (d.init?.kind === "arrow" && d.target.kind === "ident" && s.keyword === "const" && d.init.typeParams.some((p) => !isLifetime(p))) return lift(s, d.target.name, arrowFunction(ids, d.target.name, d.init, d));
          if (d.target.kind === "array" || d.target.kind === "object") return destructured(s, d, d.target, siblings);
          if (loopParts.has(d)) return loopPart(s, d);
          if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (!d.init && s.keyword === "const") throw new CompileError("E0406", "a 'const' needs its value where it is declared, as TypeScript requires; use 'let' to assign it later", d.start, d.end);
          if (!d.init) return unassigned(s, d, d.target.name);
          if (isAwait(d.init)) awaiting(d.init);
          if (d.init.kind === "yield") yieldable.add(d.init);
          // A function type there makes the variable a stored callable.
          const declared = (d.type && stored(resolveType(d.type))) || demands.get(s) || partType(s);
          // A generic function type describes the value, which keeps its own type, as an
          // interface's does.
          const family = typeof declared !== "string" && declared?.kind === "function" && declared.generic ? declared : undefined;
          const annotated = family ? undefined : declared;
          if (annotated) expect(d.init, annotated);
          const type = value(d.init);
          if (annotated) coerce(d.init, type, annotated, `type '${show(type)}' is not assignable to type '${show(annotated)}'`);
          if (family && !(typeof type !== "string" && type.kind === "closure" && type.generic)) throw new CompileError("E0101", `type '${show(type)}' is not assignable to type '${show(family)}': it takes a generic function, one that works for every type`, d.init.start, d.init.end);
          // An interface describes the value, which keeps its own concrete type.
          // A `let` may later hold another member of an enum, so it holds the enum.
          const widened = s.keyword === "let" && !annotated ? widenLet(type) : type;
          if (widened !== type) coerce(d.init, type, widened, "");
          if (!annotated && typeof widened !== "string" && widened.kind === "array" && widened.element === "never") {
            throw new CompileError("E0104", `an empty array needs a type to say what it will hold, like 'let ${d.target.name}: string[] = []'`, d.init.start, d.init.end);
          }
          // So does a regex given as a 'RegExp', which keeps its pattern's captures.
          const describes = annotated && (isInterface(annotated) || (annotated === ANY_REGEX && s.keyword === "const"));
          declare(d.target.name, annotated && !describes ? annotated : widened, s.keyword === "let", false, s);
          if (s.keyword === "let" && !annotated && type === "i64" && literalOnly(d.init, false)) candidates.set(locals.get(s)!, s);
          // A nested function's declaration, met as this `const` again when a body is checked anew.
          if (nestedFunctions.has(d.init)) nestedBindings.add(locals.get(s)!);
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
        // A nested function is a closure under its name, lending what it uses per call.
        case "function": {
          if (!s.body) throw unsupported("nested functions without a body", s);
          if (s.typeParams.some((p) => !isLifetime(p)) && !s.generator && !s.macro) return lift(s, s.name, s as Func);
          if (s.typeParams.length > 0) throw unsupported("generic nested functions", s);
          if (s.generator) throw unsupported("nested generator functions", s);
          if (s.macro) throw unsupported("nested macros", s);
          const at = { start: s.start, end: s.end };
          const arrow: Expr = { id: nextId(ids), kind: "arrow", move: false, async: s.async, typeParams: [], params: s.params, returnType: s.returnType, ...(s.throws && { throws: s.throws }), body: s.body, ...at };
          nestedFunctions.set(arrow, s.name);
          Object.assign(s, { kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name: s.name, start: s.start, end: s.end }, type: undefined, init: arrow, ...at }] });
          // The body is the arrow's now; left here too, walks over the statement would find it twice,
          // as an async function's frame did, taking the function's loops and awaits for its own.
          for (const key of ["body", "params", "returnType", "throws", "typeParams"] as const) delete (s as Partial<Func>)[key];
          return statement(s);
        }
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
        case "empty": {
          // A generic function lifted from here in an earlier check of this body.
          const lifted = liftedFunctions.get(s);
          if (lifted) {
            declare(lifted.name, "void", false, false, s);
            locals.get(s)!.generic = lifted.fn;
          }
          return;
        }
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
          if (s.await) {
            if (!f.async || timerMains.has(f as Func)) throw new CompileError("E0301", "'for await' can only be used inside an 'async' function", s.start, s.end);
            if (targets.some((t) => t.kind === "arm")) throw unsupported("'for await' loops inside match arms", s);
            if (finalizing > 0) throw unsupported("'for await' loops in a 'try' with a 'finally'", s);
          }
          const left = s.left;
          if (left.kind !== "let" || left.keyword === "var") throw unsupported("'for...of' loops over a variable declared outside them", left);
          const d = left.declarations[0]!;
          if (left.declarations.length === 1 && (d.target.kind === "array" || d.target.kind === "object")) loopPattern(s, d, d.target);
          if (left.declarations.length > 1 || d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (d.type) throw new CompileError("E0004", "a 'for...of' variable can't have a type annotation; its type comes from what it loops over", d.type.start, d.type.end);
          const through = value(s.right);
          const object = isRef(through) ? through.to : through;
          if (s.await) {
            awaitLoop(s, d.target.name, left.keyword === "let", through, object);
            return;
          }
          // A loop borrows what it reads from as long as it runs, so it can't read a part of a
          // value made for the statement, which is gone before the first pass.
          // A reference reaches a value living elsewhere, wherever it came from.
          const lent = (x: Expr) => isRef(types.get(x)!);
          let root = s.right;
          // A getter's result is made for the read, so the walk ends at it.
          while (!lent(root) && ((root.kind === "member" && !calls.has(root)) || root.kind === "index" || root.kind === "nonNull")) root = root.kind === "nonNull" ? root.expr : root.object;
          if (root !== s.right && !lent(root) && root.kind !== "ident" && root.kind !== "this" && !stringLike(object)) {
            throw new CompileError("E0212", "this loop would read from a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'", s.right.start, s.right.end);
          }
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
            if (isRef(through) && !through.mutable) throw new CompileError("E0206", "a 'for...of' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
            const error = generatorThrows(object);
            if (error) raise(s.right, error, "this generator");
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
          // A Map gives each entry as a `[key, value]` pair, and a Set each member, in insertion
          // order: each part borrowed, or a copy when it copies.
          if (typeof object !== "string" && object.kind === "map") {
            if (object !== through) coercions.set(s.right, object);
            const lend = (u: Type) => (isCopy(u) ? u : refType(u, false));
            scopes.push(new Map());
            declare(d.target.name, object.set ? lend(object.key) : tupleType([lend(object.key), lend(object.value)]), left.keyword === "let", false, left);
            within({ stmt: s, kind: "loop" }, () => scoped(s.body));
            scopes.pop();
            return;
          }
          if (yieldsOf(object, true) !== undefined) throw new CompileError("E0119", "an async generator's values are awaited, so loop over it with 'for await'", s.right.start, s.right.end);
          if (typeof object === "string" || object.kind !== "array") throw new CompileError("E0119", `'for...of' needs an array, a Map, a Set, a string or a generator, not '${show(object)}'`, s.right.start, s.right.end);
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
          if (defaults.length > 1) throw new CompileError("E0608", "a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
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
                throw new CompileError("E0112", `type '${show(test)}' is not comparable to type '${show(type)}'`, c.test!.start, c.test!.end);
              }
              const tested: Facts = c.test ? proves({ id: nextId(ids), kind: "binary", op: "===", left: s.discriminant, right: c.test, start: c.start, end: c.end }).yes : new Map();
              const reaching: Facts = falling ? either(tables.typing, falling, tested) : tested;
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
            throw new CompileError("E0402", `duplicate label '${s.label}'`, s.start, s.start + s.label.length);
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
            throw new CompileError("E1102", `'${s.kind}' can't leave a comptime block, which runs while compiling, before the program does`, s.start, s.end);
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
          if (s.paramType) throw new CompileError("E0004", "a catch parameter takes no type annotation: its type is what the 'try' can throw", s.paramType.start, s.paramType.end);
          // What the block raises goes to the catch, which takes the union of it.
          handlers.push([]);
          scoped(s.block);
          const sites = handlers.pop()!;
          if (sites.length === 0) {
            const never = new CompileError("E0603", "nothing in this 'try' can throw, so its 'catch' never runs; remove the try/catch", s.start, s.start + 3);
            tryCallees.set(never, [...instance.calls].filter(([x]) => x.start >= s.start && x.end <= s.end).map(([, i]) => i.body));
            throw never;
          }
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
            throw new CompileError("E1102", "'return' can't leave a comptime block, which runs while compiling; give a value with a 'comptime' expression instead", s.start, s.end);
          }
          if (arm) {
            jumps.set(s, arm.stmt);
            if (arm.wanted && !s.value) throw new CompileError("E0605", "this match gives a value, so a 'return' in its arm needs one", s.start, s.end);
            // In TypeScript this would leave the function, which a return in an arm never does.
            if (!arm.wanted && s.value) {
              throw new CompileError("E0605", "this match's value isn't used, so a 'return' in its arm can't give one, and it never leaves the function; return after the match instead", s.start, s.end);
            }
            if (s.value) arm.gives!.push([s.value, arm.wanted ? value(s.value) : result(s.value)]);
            return;
          }
          if (generator) {
            if (s.value) throw new CompileError("E0801", "a generator can't return a value yet; 'return;' ends it", s.value.start, s.value.end);
            return;
          }
          if (s.value && isAwait(s.value)) awaiting(s.value);
          if (f.self?.constructor && s.value) throw new CompileError("E0605", "a constructor can't return a value", s.start, s.end);
          if (unset.size > 0) throw new CompileError("E0605", "a constructor can't return before every field is assigned", s.start, s.end);
          if (declared && s.value) expect(s.value, declared);
          // An arrow's expression body may be a call returning nothing.
          const type = !s.value ? "void" : s.value === f.closure?.value && (s.value.kind === "call" || s.value.kind === "tagged") ? result(s.value) : value(s.value);
          // A closure returned is boxed into the callable the function declares.
          // A generic function value is returned as it is, capturing nothing.
          if (typeof type !== "string" && type.kind === "closure" && !type.generic && (typeof declared === "string" || declared?.kind !== "dyn")) throw unsupported("functions returned without a function return type", s.value!);
          // Returns of different regexes give any regex, as TypeScript infers 'RegExp'.
          if (!declared && typeof inferred !== "string" && inferred?.kind === "regex" && typeof type !== "string" && type.kind === "regex" && inferred !== type) inferred = ANY_REGEX;
          const expected = declared ?? inferred;
          const message = `type '${show(type)}' is not assignable to return type '${show(expected ?? type)}'`;
          if (expected && s.value) coerce(s.value, type, expected, message);
          else if (expected && type !== expected) throw new CompileError("E0101", message, s.start, s.end);
          const passedOn = typeof type !== "string" && type.kind === "param" && type.bound?.kind === "function" && type.bound.generic !== undefined;
          if (family && !passedOn && !(typeof type !== "string" && type.kind === "closure" && type.generic)) throw new CompileError("E0101", `type '${show(type)}' is not assignable to return type '${show(family)}': it takes a generic function, one that works for every type`, (s.value ?? s).start, (s.value ?? s).end);
          const reason = trait && unsatisfied(type, trait, members, s.value ?? s);
          if (reason) throw new CompileError("E0101", `type '${show(type)}' is not assignable to return type '${trait!.name}': ${reason}`, (s.value ?? s).start, (s.value ?? s).end);
          inferred = expected ?? type;
          return;
        }
      }
    }

    // `for await`: an async generator gives each value it yields, as a generator's loop does, and
    // a Channel each value it receives until it is closed and drained.
    function awaitLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, name: string, mutable: boolean, through: Type, object: Type) {
      const yields = yieldsOf(object, true);
      const channel = typeof object !== "string" && object.kind === "block" && object.which === "Channel" ? lower(object.of) : undefined;
      if (yields === undefined && channel === undefined) {
        throw new CompileError("E0119", `'for await' loops over an async generator or a Channel, not '${show(through)}'`, s.right.start, s.right.end);
      }
      if (yields !== undefined && isRef(through) && !through.mutable) throw new CompileError("E0206", "a 'for await' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
      const error = generatorThrows(object);
      if (error) raise(s.right, error, "this generator");
      scopes.push(new Map());
      declare(name, yields ?? channel!, mutable, false, s.left as Stmt);
      within({ stmt: s, kind: "loop" }, () => scoped(s.body));
      scopes.pop();
    }

    // The `this.x` a statement assigns, when it is a plain assignment to one of the class's
    // own fields. A setter is a method, which can't run until every field is set.
    // `yield v;`: the generator gives `v` and stops until `next()` is called again. It runs as
    // a statement of its own, or as all of a declaration's initializer or an assignment's value,
    // so nothing the statement made is pending across it. Its value is what `next(x)` sends.
    function yielding(e: Extract<Expr, { kind: "yield" }>): Type {
      if (!generator) throw new CompileError("E0606", "'yield' can only be used inside a 'function*'", e.start, e.end);
      if (yieldable.has(e) && f.async) throw unsupported("values sent into an async generator's 'next'", e);
      if (yieldable.has(e) && sends === undefined) {
        throw new CompileError("E0606", `this 'yield' gives what 'next(x)' sends, so declare what that is, as in 'Generator<${yielded ? show(yielded) : "T"}, void, string>'`, e.start, e.end);
      }
      if (targets.some((t) => t.kind === "arm")) throw unsupported("'yield' inside match arms", e);
      if (finalizing > 0) throw unsupported("'yield' statements in a 'try' with a 'finally'", e);
      if (e.delegate) throw unsupported("'yield*'", e);
      if (!e.value) throw new CompileError("E0606", "a generator's 'yield' gives a value, like 'yield x;'", e.start, e.end);
      if (yielded) expect(e.value, yielded);
      const t = value(e.value);
      if (!yielded) yielded = widenLet(t);
      if (holdsRef(yielded)) throw unsupported("generators yielding references", e.value);
      coerce(e.value, t, yielded, `type '${show(t)}' is not assignable to the generator's '${generatorName}<${show(yielded)}>'`);
      return sends ?? "void";
    }

    // An `await` written as a statement of its own, or as all of a declaration's initializer,
    // an assignment's value or a return's: one the state machine can stop at with nothing else
    // of the statement pending.
    function awaiting(e: Expr) {
      if (!f.async) return;
      if (targets.some((t) => t.kind === "arm")) throw unsupported("'await' inside match arms", e);
      if (finalizing > 0) throw unsupported("'await' statements in a 'try' with a 'finally'", e);
      awaitable.add(e);
    }

    function fieldAssignment(s: Stmt): Extract<Expr, { kind: "member" }> | undefined {
      if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
      const target = s.expr.target;
      if (target.kind !== "member" || target.object.kind !== "this") return undefined;
      // Once `super(...)` has run, the base's fields are set, and may be set again before the
      // class's own are.
      const inherited = !unset.has(SUPER) && f.self!.type.base !== undefined && field(f.self!.type.base, target.name) !== undefined;
      return classOf(f.self!.type).fields.some((d) => d.name === target.name) || inherited ? target : undefined;
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
        throw new CompileError("E0604", `'${s.kind}' can't leave a match arm, which is a body of its own like an arrow's; 'return' a value and act on it after the match`, s.start, s.end);
      }
      const target = found?.kind === "arm" ? undefined : found;
      if (s.label === undefined) {
        if (target) return target.stmt;
        const message = s.kind === "break" ? "'break' can only be used inside a loop or 'switch'" : "'continue' can only be used inside a loop";
        throw new CompileError("E0604", message, s.start, s.end);
      }
      if (!target) throw new CompileError("E0604", `cannot find label '${s.label}'`, s.start, s.end);
      if (s.kind === "break") return target.stmt;
      if (!target.loop) throw new CompileError("E0604", "'continue' can only jump to a label on a loop", s.start, s.end);
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
      if (scope.has(name) && !name.startsWith("[") && !name.startsWith("{")) throw new CompileError("E0402", `cannot redeclare '${name}' in the same scope`, node.start, node.end);
      const local = { name, type, mutable, param, id: nextLocal++ };
      depths.set(local, scopes.length);
      scope.set(name, local);
      locals.set(node, local);
      declarations.add(node);
    }

    function lookup(name: string, at?: Expr | ObjectProp): Local | undefined {
      for (let i = scopes.length - 1; i >= (hidden ? 1 : 0); i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      const outside = outer?.lookup(name, at);
      // A local generic function holds nothing to capture.
      return outside && (outside.generic ? outside : capture(outside, at));
    }

    // Whether a binding is the one a sync nested function's declaration makes, or a closure's
    // capture of it.
    function nestedLocal(l: Local): boolean {
      const type = lower(l.type);
      if (!nestedBindings.has(l) || typeof type === "string" || type.kind !== "closure") return false;
      return closureBodies.get(type)?.body.async !== true;
    }

    function peek(name: string): Local | undefined {
      for (let i = scopes.length - 1; i >= (hidden ? 1 : 0); i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      return outer?.peek(name);
    }

    function inScope(): string[] {
      return [...scopes.slice(hidden ? 1 : 0).flatMap((scope) => [...scope.keys()]), ...(outer?.inScope() ?? [])];
    }

    // By the binding itself, not its name, which a body in between may have taken for another.
    function reach(l: Local, at?: Expr | ObjectProp): Local {
      if (captures?.has(l) || scopes.some((scope) => [...scope.values()].includes(l))) return l;
      return capture(outer!.reach(l, at), at);
    }

    // A generic function written in a body, or a generic arrow a const holds, is a generic
    // function of its own, instantiated per call, so it can use nothing of the body around it.
    function lift(s: Stmt, name: string, fn: Func): undefined {
      lifted(s, name, fn, `'${name}'`);
      Object.assign(s, { kind: "empty" });
      return statement(s) as undefined;
    }

    // A generic arrow written as a value is a generic function of its own, as one a const holds
    // is, and the arrow becomes its name.
    function liftArrow(e: Extract<Expr, { kind: "arrow" }>) {
      const fn = lifted(e, "", arrowFunction(ids, "", e, e), "this arrow");
      for (const key of Object.keys(e)) if (key !== "start" && key !== "end" && key !== "id") delete (e as Record<string, unknown>)[key];
      Object.assign(e, { kind: "ident", name: fn.name });
    }

    // Lifts a generic function out of the body around it, once per place it is written. `who`
    // names it in messages.
    function lifted(key: Stmt | Expr, name: string, fn: Func, who: string): Func {
      const own = fn as Extract<Stmt, { kind: "function" }>;
      if (holdsNode(fn.body, (n) => n.kind === "this")) {
        throw new CompileError("E0409", `${who} is generic, so it is made anew for each call and can't use 'this'; pass what it needs as a parameter`, fn.start, fn.end);
      }
      // It is checked apart from the body around it, so a name that body declares anywhere,
      // before or after, a sibling generic function or a type parameter included, would mean
      // something else inside it.
      const around = new Set([...declaredIn(f), ...(f.scope?.keys() ?? []), ...scopes.flatMap((s) => [...s.keys()])]);
      for (const n of freeNames(own)) {
        if (n !== name && (around.has(n) || lookup(n))) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use '${n}' from there; pass it as a parameter, or declare it at the top level`, fn.start, fn.end);
      }
      const typed = holdsNode([fn.params, fn.returnType, fn.body], (n) => n.kind === "ref" && typeof n.name === "string" && around.has(n.name) && !(fn.typeParams ?? []).some((p) => p.name === n.name));
      if (typed) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use its types; declare it at the top level`, fn.start, fn.end);
      let lifted = liftedFunctions.get(key);
      if (!lifted) {
        lifted = { name, fn: { ...fn, id: nextId(ids), name: `${f.name}.${name || "arrow"}#${counts.lifts++}` } };
        // Its calls of itself call what it was lifted to.
        const symbol = lifted.fn.name;
        holdsNode(fn.body, (n) => {
          const c = n as Expr;
          if (c.kind === "call" && c.callee.kind === "ident" && c.callee.name === name) c.callee.name = symbol;
          return false;
        });
        liftedFunctions.set(key, lifted);
        byName.set(lifted.fn.name, lifted.fn);
        funcs.push(lifted.fn);
      }
      return lifted.fn;
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
          throw new CompileError("E0207", `cannot ${action} '${from.name}${path}' in this closure because '${from.name}' is a constant; declare it with 'let'`, target.start, target.end);
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
      if (into) coerce(thrownValue, type, errorType!, `type '${show(type)}' can't be thrown here: ${who()} throws '${show(errorType!)}'`);
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
      if (built) throw new CompileError("E0602", "a constructor can only throw before it assigns its first field, so a failed 'new' leaves nothing half built; field initializers count as assigned first, so check and throw before assigning, then assign the fields", at.start, at.end);
      if (inferring) return void inferring.push([at, type]);
      if (!errorType && contextual) {
        const does = "kind" in at && at.kind === "throw" ? `this closure throws '${show(widenLet(type))}'` : `${what} can throw '${show(widenLet(type))}'`;
        throw new CompileError("E0602", `${does}, but the closure is given as '${show(contextual)}', which throws nothing; catch it inside the closure with try/catch`, at.start, at.end);
      }
      if (!errorType) {
        const does = "kind" in at && at.kind === "throw" ? "to throw here" : `since ${what} can throw '${show(type)}'`;
        throw new CompileError("E0602", `${who()} must declare 'throws ${show(type)}' after its return type ${does}, or catch it with try/catch`, at.start, at.end);
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
        throw new CompileError("E0602", `${does}, which isn't the '${show(errorType)}' that ${who()} throws; ${hint}`, at.start, at.end);
      }
      if (wrappers.length > 1) {
        throw new CompileError("E0602", `${does}, which ${wrappers.map((w) => `'${w.wrapper.name}'`).join(" and ")} both wrap; throw one of them yourself`, at.start, at.end);
      }
      instance.raises.set(at, { from: type, to: errorType, ...wrappers[0]! });
    }

    // Who throws, in messages: the function, or the closure or nested function it is in.
    function who(): string {
      return f.closure?.self !== undefined ? `'${f.closure.self}'` : f.closure ? "this closure" : `'${f.name}'`;
    }

    function noteThis(e: Expr) {
      if (!captures || [...captures.values()].includes("this")) return;
      const alias: Local = { name: "this", type: self!.type, mutable: false, param: false, id: nextLocal++ };
      captures.set(alias, "this");
      instance.captureUses!.set(alias, e);
      outer!.noteThis(e);
    }

    // Who a closure's body counts as for access to private members: its function's class.
    function closureOwner(b: Body): Body["owner"] {
      let outerBody = b;
      while (outerBody.closure) outerBody = outerBody.closure.parent.body;
      return outerBody.declared ?? (outerBody.owner && outerBody.owner === enclosing?.type ? self!.type : outerBody.owner);
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
        alias = { name: from.name, type: from.type, mutable: false, param: false, id: nextLocal++ };
        depths.set(alias, 0);
        captures!.set(alias, from);
        if (nestedBindings.has(from)) nestedBindings.add(alias);
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
// A return type describing the value returned, which keeps its own type: an interface, or a
// generic function type.
const describes = (t: Type) => isInterface(t) || (typeof t !== "string" && t.kind === "function" && t.generic !== undefined);

const isRef = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

// What a returned reference borrows from: a parameter, by index, or `this`.
export type Origin = number | "this";

const hasBody = (f: Declared): f is Func => f.body !== undefined;

// An abstract class a type holds as a value, not one embedded as a concrete class's base.
function abstractPart(t: Type): ClassType | undefined {
  const bases = new Set<Type>();
  let found: ClassType | undefined;
  holdsPart(t, (u) => {
    if (typeof u === "string" || u.kind !== "class") return false;
    if (u.base) bases.add(u.base);
    if (u.abstract && !bases.has(u)) found = u;
    return found !== undefined;
  }, true);
  return found;
}

// A net under the rules that decide what is compiled: no compiled function calls, and no
// compiled Dyn's table holds, an instance that isn't compiled. Only a value of an abstract
// class's own type, which escaped where no rule saw it, could reach one.
export function unreached(equalities: Tables["equalities"], compiled: Instance[], dropped: (i: Instance) => boolean) {
  for (const i of compiled) {
    const reached: [Expr, Instance, string][] = [
      ...[...i.calls, ...i.setters].map(([at, target]): [Expr, Instance, string] => [at, target, ""]),
      ...[...(i.dyns ?? [])].flatMap(([at, table]) => [...table.methods, ...table.fields, table.clone].flatMap((target): [Expr, Instance, string][] => (target && target !== "copy" ? [[at, target, " through a 'Dyn'"]] : []))),
    ];
    // A comparison of values runs each class's `equals` it reaches, through objects and unions.
    for (const [e] of i.types) {
      if (e.kind !== "binary" || !["===", "!==", "==", "!="].includes(e.op)) continue;
      for (const target of [...comparedBy(equalities, i.types.get(e.left)), ...comparedBy(equalities, i.types.get(e.right))]) reached.push([e, target, " to compare them"]);
    }
    const found = reached.find(([, target]) => dropped(target));
    if (!found) continue;
    const [at, target, through] = found;
    const abstract = (target.body.abstract ? target.body.owner : undefined) ?? [...target.bindings.values()].map(abstractPart).find((t) => t) ?? target.body.declared ?? target.body.owner;
    const root = (i.body.closure ? closureRoot(i) : i).body;
    const member = (root.owner ? root.name.slice(root.owner.name.length + 1) : root.name).replace(/#.*$/, "");
    // The name the call wrote, rather than the prelude function it may run.
    const callee = at.kind === "call" || at.kind === "new" ? at.callee : undefined;
    const named = callee?.kind === "ident" || callee?.kind === "member" ? callee.name : target.body.name.replace(/#.*$/, "");
    throw new CompileError("E0701", `a value of the abstract class '${abstract?.name}' can't reach '${named}'${through} here yet; pass a subclass's value instead, or give '${member}' to each subclass`, at.start, at.end);
  }
}

// Each `equals` a comparison of two values runs, as codegen finds them: a class's own stops the
// search, and otherwise its base and fields, an object's fields and a union's members compare.
function comparedBy(equalities: Tables["equalities"], t: Type | undefined, seen: Set<Type> = new Set<Type>()): Instance[] {
  if (t === undefined || typeof t === "string" || seen.has(t)) return [];
  seen.add(t);
  if (t.kind === "ref") return comparedBy(equalities, t.to, seen);
  if (t.kind === "class") {
    const own = equalities.get(t);
    return own ? [own] : [t.base, ...t.fields.map((f) => f.type)].flatMap((u) => comparedBy(equalities, u, seen));
  }
  if (t.kind === "union") return t.members.flatMap((u) => comparedBy(equalities, u, seen));
  if (t.kind === "object") return t.fields.flatMap((f) => comparedBy(equalities, f.type, seen));
  return [];
}

function closureRoot(i: Instance): Instance {
  return i.body.closure ? closureRoot(i.body.closure.parent) : i;
}
