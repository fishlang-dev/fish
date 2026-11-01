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
import { nextId, NodeMap, NodeSet, WeakNodeMap, renumber, Rewrites, walk, type Ids, type NodeOf, type RootKind } from "./nodes.ts";
import { rebuiltExpr, rebuiltParam, rebuiltStmts } from "./rebuild.ts";

type Arrow = Extract<Expr, { kind: "arrow" }>;
import { alwaysReturns, assignedNames } from "./flow.ts";
import { declareEnum, type EnumInfo, type EnumInstance } from "./enums.ts";
import { either, guard, type Facts } from "./narrow.ts";
import { comparable, numberMembers, objectsMeet } from "./unions.ts";
import { comptimeName, infer, GenericClasses, GenericClassesState, Instancing, InstancingState, typeParamsOf, type GenericClassesHost, type InstancingHost } from "./generics.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { Registry, RegistryState, type RegistryHost } from "./registry.ts";
import { addAlias, paramName, Resolver, ResolverState, tagStrings, typeName, type ResolverHost, type Sight } from "./resolve.ts";
import { openParam } from "./typefns.ts";
import { lowerDefaults, writtenName } from "./defaults.ts";
import { TypeSet, TypeMap, ANY_REGEX, type InterfaceType, type UnionType, type ObjectType, YIELD_NOW, type FutureType, type Field, type GeneratorType, isInteger, isNumeric, type ClassType, type ClosureType, type FunctionType, type Integer, type RefType, type Type, type Typing, type VariantType, type InstanceMaker, type Bound } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { hoistLocals } from "./locals.ts";
import { lowerOverloads } from "./overloads.ts";
import { checkMoves } from "./moves.ts";
import { NATIVE } from "./native.ts";
import { MATH_RUNTIME } from "./mathlib.ts";
import { RUNTIME } from "./runtime.ts";
import { Expressions, ExpressionsState, stringLike, type Context, type DynTable } from "./values.ts";
import { bodyOf, type Arenas, type BodyId, type ClassId, type InstanceId, type LocalId } from "./arenas.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

// A local generic function's name stands for the function it was lifted to, `generic`. `id`
// numbers it in its check, naming its slot in the IR; `localId` names it in the compilation's arena.
export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: usize; localId: LocalId; generic?: Func };

// Every function to compile: the top-level ones, then each class's constructor and methods.
// A checked program: the functions to compile, the tables its check filled in, and the
// compilation it was checked in.
// `warnings`: what the build reports without failing, in source order.
export type Checked = { instances: InstanceId[]; tables: Tables; compilation: Compilation; warnings: CompileError[] };

// The instances a checked program compiles, read from its arena.
export const compiledOf = ({ instances, tables }: Checked): Instance[] => instances.map((i) => tables.arenas.instanceOf(i));

// One compiled function: a body checked with concrete types, and the tables codegen reads
// to lower it. `symbol` names it in the IR.
export type Instance = {
  // Its place in the compilation's arena, which tables of instances key on.
  id: InstanceId;
  body: BodyId;
  symbol: string;
  // The tables of the check that made it.
  tables: Tables;
  // What a generic body's type parameters stand for in this instance. An instance holding a
  // type parameter is the definition check, which is never compiled.
  bindings: Map<string, Type>;
  concrete: boolean;
  // How many generic instantiations led to this one, which bounds instantiations that never end.
  depth: usize;
  // Its return type, written or inferred.
  returns: Type;
  // Every value expression's type.
  types: NodeMap<Expr, Type>;
  // Each `JSON.stringify` argument's type before lowering, which keeps how fields were spelled.
  spelled?: NodeMap<Expr, Type>;
  // The binding each name use, declaration, parameter and shorthand property refers to,
  // after shadowing.
  locals: NodeMap<Expr | Stmt | Param | ObjectProp, LocalId>;
  // The function each call of a user function or method runs, and the getter each read of
  // an accessor runs.
  calls: NodeMap<Expr, InstanceId>;
  // The setter each assignment to an accessor runs.
  setters: NodeMap<Expr, InstanceId>;
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
  raises: NodeMap<Expr | Stmt, { from: Type; to: Type; wrapper?: ClassType; param?: Type; via?: InstanceId }>;
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
  captures?: Map<LocalId, LocalId | "this">;
  captureUses?: Map<LocalId, Expr | ObjectProp>;
  // The captures it changes, which it captures mutably, and those it moves out of itself.
  changed?: Set<LocalId>;
  moved?: Set<LocalId>;
  // Each call or use as a value of a nested function by name, the function, and this body's
  // bindings for what it captures, in its environment's order, from which the call or the
  // value builds it.
  envs?: NodeMap<Expr, { of: InstanceId; env: LocalId[] }>;
  // What each value boxed into a Dyn runs for the interface's members.
  dyns?: NodeMap<Expr, DynTable>;
  // Each closure owning what it captures that holds nested functions as made where it is, and
  // this body's bindings for what each of those uses, which the closure borrows.
  made?: NodeMap<Expr, { of: InstanceId; env: LocalId[] }[]>;
  // Each call of a type predicate that narrows its argument: the predicate's type, and whether
  // its true and its false answers narrow, which codegen checks against the argument's tag.
  predicates?: NodeMap<Expr, { index: usize; type: Type; yes: boolean; no: boolean }>;
  // A closure's own type.
  closure?: ClosureType;
  // A C function's parameter types, for its declaration.
  signature?: Type[];
  // An async function's own future, which calling it gives.
  future?: FutureType;
  // A generator's own type, which calling it gives, and where each variable and each
  // `for...of` loop's state lives in its frame.
  generator?: GeneratorType;
  frame?: { locals: Map<LocalId, usize>; loops: NodeMap<Stmt, usize>; awaits: NodeMap<Expr, usize> };
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
type Target = { stmt: Stmt; kind: "loop" | "switch" | "label" | "arm"; label?: string; loop?: Stmt; facts?: usize; wanted?: boolean; gives?: [Expr, Type][] };

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
function identifiers(body: Stmt[] | undefined): Set<string> {
  const found = new Set<string>();
  walk("stmt", body, ({ of, node }) => {
    if ((of === "expr" || of === "pattern") && node.kind === "ident") found.add(node.name);
    // A shorthand property `{ x }` reads `x` too.
    if (of === "objectProp" && node.kind === "shorthand") found.add(node.name);
  });
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
  const typing = instance.tables.typing;
  const type = instance.coercions.get(e) ?? instance.types.get(e)!;
  if (typeof type === "string") return type;
  const r = typing.rec(type);
  // A fixed array it borrows is kept as a pointer to where it lives.
  if (r.kind === "fixed" && plainPlace(instance, e)) return typing.refType(type, false);
  // A Map or a Set it borrows is kept as its table's pointer, owning nothing.
  if (r.kind === "map") return borrowed(instance, e) || type !== instance.types.get(e) ? typing.refType(type, false) : type;
  if (r.kind !== "array" || !borrowed(instance, e)) return type;
  return typing.objectType([{ name: "a", type: typing.refType(r.element, false) }, { name: "b", type: "i64" }, { name: "c", type: "i64" }]);
}

// Whether a value lives where codegen can point at it for as long as a loop runs: a variable,
// `this`, a reference, or a field of an object or instance, or an element, of one. A field read
// through a shared value or a Dyn, or out of an Option, is a copy of its own.
function plainPlace(instance: Instance, e: Expr): boolean {
  const typing = instance.tables.typing;
  const recOf = <T extends Type>(t: T | undefined) => (t === undefined || typeof t === "string" ? undefined : typing.rec(t as Exclude<T, string>));
  if (recOf(instance.types.get(e))?.kind === "ref") return true;
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind !== "member" && e.kind !== "index") return false;
  if (e.kind === "member" && instance.calls.has(e)) return false;
  const outer = recOf(instance.types.get(e.object));
  const object = outer?.kind === "ref" ? recOf(outer.to) : outer;
  const holds = e.kind === "member" ? object?.kind === "object" || object?.kind === "class" : object?.kind === "array" || object?.kind === "fixed";
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
function receiverField(typing: Typing, self: NonNullable<Body["self"]>, laid: (t: Type) => Type): Field {
  return { name: "this", type: laid(self.owned ? self.type : typing.refType(self.type, self.mutable)) };
}

// A closure, future or generator type, marked as made for `instance`.
function madeBy<T extends ClosureType | FutureType | GeneratorType>(t: T, instance: Instance): T {
  instance.tables.typing.madeFor.set(t, `${instance.tables.typing.rec(t).kind} of ${instance.symbol}`);
  return t;
}

function frameOf(instance: Instance, generator: GeneratorType | FutureType) {
  const { typing, arenas } = instance.tables;
  const fields: Field[] = [{ name: "state", type: "i32" }];
  const locals = new Map<LocalId, usize>();
  const loops = new NodeMap<Stmt, usize>();
  // Each `await` keeps the future it awaits in the frame while it is pending.
  const awaits = new NodeMap<Expr, usize>();
  const add = (l: Local) => {
    if (locals.has(l.localId)) return;
    locals.set(l.localId, fields.length);
    fields.push({ name: `${l.name}.${l.id}`, type: l.type });
  };
  // An async arrow's frame holds what it captured, first, and an async method's its object.
  if (bodyOf(instance).closure) fields.push({ name: "env", type: "void" });
  const self = bodyOf(instance).self;
  if (self && !self.constructor) fields.push(receiverField(typing, self, (t) => (instance.concrete ? typing.lower(t) : t)));
  bodyOf(instance).params.forEach((p) => add(arenas.localOf(instance.locals.get(p)!)));
  // A local generic function's name holds nothing.
  [...new Set(instance.locals.values())].map((l) => arenas.localOf(l)).filter((l) => !l.generic).sort((a, b) => a.id - b.id).forEach(add);
  walk("stmt", bodyOf(instance).body, ({ of, node }) => {
    if (of === "expr" && node.kind === "arrow") return false;
    const s = node as Stmt;
    if (of === "stmt" && s.kind === "forOf") {
      loops.set(s, fields.length);
      const kept = iterated(instance, s.right);
      const ref = typeof kept === "string" ? undefined : typing.rec(kept);
      const held = ref?.kind === "ref" ? ref.to : kept;
      const h = typeof held === "string" ? undefined : typing.rec(held);
      // A `for await` loop holds its generator, or a count on its channel, and the future it awaits.
      if (s.await && h?.kind === "block") fields.push({ name: "loop", type: held }, { name: "at", type: "i64" }, { name: "await", type: typing.leafFuture("receive", typing.lower(h.of)) });
      else if (s.await) {
        // In a generic body, a parameter standing for the generator awaits what its bound's `next()` gives.
        const generator = h?.kind === "param" && h.concrete ? h.concrete : held;
        const g = typeof generator === "string" ? undefined : typing.rec(generator);
        // A boxed one awaits the boxed future its vtable's `next()` gives.
        const next = g?.kind === "generator" ? typing.leafFuture("next", generator)
          : g?.kind === "dyn" ? typing.lentPromise(typing.nextResult(typing.yieldsOf(held, true)!)) : typing.promiseInterface(typing.nextResult(typing.yieldsOf(held, true)!));
        fields.push({ name: "loop", type: kept }, { name: "at", type: "i64" }, { name: "await", type: next });
      } else fields.push({ name: "loop", type: kept }, { name: "at", type: "i64" });
    }
    const e = node as Expr;
    if (of === "expr" && isAwait(e)) {
      awaits.set(e, fields.length);
      fields.push({ name: "await", type: instance.types.get(e.operand)! });
    }
  });
  typing.rec(generator).frame = fields;
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
  const timers = holdsNode("stmt", written, (n) => n.kind === "call" && (n as { callee?: { kind?: string; name?: string } }).callee?.kind === "ident" && TIMER_GLOBALS.has((n as { callee: { name: string } }).callee.name) && !declared.has((n as { callee: { name: string } }).callee.name));
  if (!timers) return;
  const returns = main.returnType;
  const returnType: TypeNode | undefined = returns?.kind === "ref" && returns.name === "void" ? { id: nextId(ids), kind: "ref", name: "Promise", args: [returns], start: returns.start, end: returns.end } : returns;
  const rewrites = new Rewrites();
  timerMains.add(rewrites.replace(main, { ...main, async: true, returnType }));
  rebuiltStmts(written, rewrites);
}
const TIMER_GLOBALS = new Set(["setTimeout", "setInterval"]);

// Whether a piece of syntax holds a node `found` picks out.
// A node shared by several parents is tried once.
export function holdsNode<K extends RootKind>(of: K, roots: NodeOf<K> | NodeOf<K>[] | undefined, found: (n: { kind?: unknown; name?: unknown }) => boolean): boolean {
  const seen = new Set<unknown>();
  let hit = false;
  walk(of, roots, ({ node }) => {
    if (hit || seen.has(node)) return false;
    seen.add(node);
    hit = found(node as { kind?: unknown });
    return !hit;
  });
  return hit;
}

// Every name the body of a function declares anywhere, as a variable, a function, a class or a
// parameter, and the type parameters it is generic over.
function declaredIn(f: { params: Param[]; body?: Stmt[]; typeParams?: TypeParam[] }): Set<string> {
  const names = new Set<string>(f.params.flatMap((p) => namesIn(p.pattern)));
  for (const p of f.typeParams ?? []) names.add(p.name);
  holdsNode("stmt", f.body, (n) => {
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
  return new Checker(compilation, written, library, macros, module).run();
}

class Checker implements RegistryHost, GenericClassesHost, InstancingHost, ResolverHost, InstanceMaker {
  compilation: Compilation;
  written: Stmt[];
  library: boolean;
  macros: boolean;
  module: boolean;
  arenas: Compilation["arenas"];
  counts: Compilation["counts"];
  ids: Compilation["ids"];
  rewrites: Compilation["rewrites"];
  tables: Tables;
  typing: Tables["typing"];
  loopParts: Tables["loopParts"];
  nestedFunctions: Tables["nestedFunctions"];
  nestedBindings: Tables["nestedBindings"];
  liftedFunctions: Tables["liftedFunctions"];
  getterNames: Tables["getterNames"];
  destructuredParts: Tables["destructuredParts"];
  unusedDefaults: Tables["unusedDefaults"];
  timerMains: Tables["timerMains"];
  selfCalls: Tables["selfCalls"];
  jsCalledAt: Tables["jsCalledAt"];
  jsCalls: Tables["jsCalls"];
  jsGiven: Tables["jsGiven"];
  jsonCalls: Tables["jsonCalls"];
  jsUses: Tables["jsUses"];
  printed: Tables["printed"];
  presetParams: Tables["presetParams"];
  restStarts: Tables["restStarts"];
  substituted: Tables["substituted"];
  timerWrappers: Tables["timerWrappers"];
  defaulted: Tables["defaulted"];
  prologues: Tables["prologues"];
  asserts: Tables["asserts"];
  declarations: Tables["declarations"];
  equalities: Tables["equalities"];
  madeArrows: Tables["madeArrows"];
  files: Map<usize, Map<string, string>> | undefined;
  program: Stmt[];
  funcs: (Func & Body)[];
  classes: Map<string, ClassId>;
  // Generic classes, declared again for each set of type arguments they are used with.
  templates: Map<string, ClassNode & { name: string }>;
  interfaces: Map<string, Interface>;
  enums: Map<string, EnumInfo>;
  // For each class declaring lifetimes, which of its type parameters are lifetimes.
  slots: Map<string, boolean[]>;
  byName: Map<string, BodyId>;
  main: Body | undefined;
  // The pairs of a type and an interface being checked, each taken as satisfied while it is.
  assuming: Set<string>;
  registryState: RegistryState;
  genericClassesState: GenericClassesState;
  resolverState: ResolverState;
  // The instance being checked, which new instantiations count their depth from.
  beingChecked: Instance | undefined;
  done: Set<InstanceId>;
  // Each Rust function's types, by its shim symbol, as first declared.
  rustTypes: Map<string, string>;
  // Each concrete instance's return type as its own body saw it, before lowering.
  views: Map<InstanceId, Type>;
  // Each unannotated `let` of integer literals a use needs as another integer type, as Rust
  // infers it, and the variables still open to that in the pass being checked.
  demands: NodeMap<Stmt, Integer>;
  candidates: Map<LocalId, Stmt>;
  // How many new demands the body being checked made itself, not counting its callees'.
  demanded: usize;
  instancingState: InstancingState;
  querying: Set<string>;
  // A generic definition's placeholder for each comptime argument, one per argument.
  placeholders: WeakNodeMap<Expr, Type>;
  // The targets some `break` leaves, and the loops some `continue` repeats.
  broken: NodeSet<Stmt>;
  continued: NodeSet<Stmt>;
  inProgress: Set<InstanceId>;
  nextLocal: usize;
  // Every closure's instance, and the instance each closure type calls.
  closures: InstanceId[];
  closureBodies: TypeMap<ClosureType, InstanceId>;
  // Each declaration and body is checked on its own, so one mistake doesn't hide the next; the
  // errors are reported together. A bad signature, or a failed body whose result another needs,
  // is met again from every body that uses it, and is reported once.
  errors: CompileError[] = [];
  // Instances that never stop growing would be queued without end once their error is recovered.
  unending = false;
  // Errors a recorded mistake makes elsewhere: a use repeating why a class's `implements` claim
  // was refused, or a `try` that can't throw only because a function it calls failed before its
  // throws were known.
  claimErrors: CompileError[] = [];
  refused: Members["refused"] = [];
  // Each such `try`'s error, with the bodies its block calls.
  tryCallees: [CompileError, BodyId[]][] = [];
  // The error each failed body's check gave, which a call of it gives again rather than another.
  failed = new Map<BodyId, CompileError>();

  constructor(compilation: Compilation, written: Stmt[], library: boolean, macros: boolean, module: boolean) {
    this.compilation = compilation;
    this.written = written;
    this.library = library;
    this.macros = macros;
    this.module = module;
    this.arenas = this.compilation.arenas;
    this.counts = this.compilation.counts;
    this.ids = this.compilation.ids;
    this.rewrites = this.compilation.rewrites;
    const rustNames: Compilation["rust"]["names"] = this.compilation.rust.names;
    const rustClassNodes: Compilation["rust"]["classNodes"] = this.compilation.rust.classNodes;
    this.tables = newTables(this.compilation);
    this.typing = this.tables.typing;
    this.loopParts = this.tables.loopParts;
    this.nestedFunctions = this.tables.nestedFunctions;
    this.nestedBindings = this.tables.nestedBindings;
    this.liftedFunctions = this.tables.liftedFunctions;
    this.getterNames = this.tables.getterNames;
    this.destructuredParts = this.tables.destructuredParts;
    this.unusedDefaults = this.tables.unusedDefaults;
    this.timerMains = this.tables.timerMains;
    this.selfCalls = this.tables.selfCalls;
    const jsBodies: Tables["jsBodies"] = this.tables.jsBodies;
    this.jsCalledAt = this.tables.jsCalledAt;
    this.jsCalls = this.tables.jsCalls;
    const jsClasses: Tables["jsClasses"] = this.tables.jsClasses;
    this.jsGiven = this.tables.jsGiven;
    this.jsonCalls = this.tables.jsonCalls;
    this.jsUses = this.tables.jsUses;
    this.printed = this.tables.printed;
    this.presetParams = this.tables.presetParams;
    this.restStarts = this.tables.restStarts;
    this.substituted = this.tables.substituted;
    this.timerWrappers = this.tables.timerWrappers;
    this.defaulted = this.tables.defaulted;
    this.prologues = this.tables.prologues;
    this.asserts = this.tables.asserts;
    this.declarations = this.tables.declarations;
    this.equalities = this.tables.equalities;
    this.madeArrows = this.tables.madeArrows;
    this.files = this.compilation.fileNames.get(this.written);
    // A macro applies only to a top-level declaration; the top-level ones are expanded already.
    holdsNode("stmt", this.written, (n) => {
      const decorators = (n as { kind?: string; decorators?: Expr[] }).decorators;
      if (["function", "typeAlias", "interface", "enum"].includes(n.kind as string) && decorators && decorators.length > 0) throw new CompileError("E1103", "a macro applies to a top-level declaration", decorators[0]!.start, decorators[0]!.end);
      // A member's decorator a top-level class's expansion didn't reach is on a class no macro runs on.
      const member = n as { kind?: string; decorators?: Expr[]; modifiers?: unknown };
      if (MEMBERS.has(member.kind!) && Array.isArray(member.modifiers) && member.decorators && member.decorators.length > 0) throw new CompileError("E1103", "a macro on a member applies in a top-level class", member.decorators[0]!.start, member.decorators[0]!.end);
      return false;
    });
    this.written = lowerOverloads(this.ids, this.written);
    this.written = [...this.written, ...hoistLocals(this.compilation, this.written)];
    holdsNode("stmt", this.written, (n) => {
      if (n.kind === "get" && typeof (n as { name?: unknown; key?: unknown }).name === "string") this.getterNames.add((n as { name: string }).name);
      if (n.kind === "get" && typeof (n as { key?: unknown }).key === "string") this.getterNames.add((n as { key: string }).key);
      return false;
    });
    lowerDefaults(this.tables, this.written);
    if (!this.library) timersRunAsync(this.ids, this.written, this.timerMains);
    this.program = [...lowerOverloads(this.ids, stdFor(this.compilation, this.written)), ...this.written];
    this.funcs = [];
    const aliases: Tables["aliases"] = this.tables.aliases;
    this.classes = new Map<string, ClassId>();
    this.templates = new Map<string, ClassNode & { name: string }>();
    this.interfaces = new Map<string, Interface>();
    this.enums = new Map<string, EnumInfo>();
    this.slots = new Map<string, boolean[]>();
    separatePrivateNames(this.program.flatMap((s) => (s.kind === "class" && s.name !== undefined ? [{ ...s, name: s.name }] : [])));
    for (const s of this.program) {
      try {
        // A `declare const enum` writes its values, so it is an enum like any other.
        const e = s.kind === "declare" && s.body.kind === "enum" && s.body.const ? s.body : s;
        if (e.kind === "enum") {
          typeName(e.name, e, aliases, this.classes, this.templates, this.interfaces, this.enums);
          this.enums.set(e.name, declareEnum(this.compilation, e, (owner, member, init) => this.enumMemberValue(owner, member, init)));
          continue;
        }
        if (s.kind === "typeAlias") {
          addAlias(aliases, s, this.classes, this.templates, this.interfaces, this.enums);
          continue;
        }
        if (s.kind === "interface") {
          typeName(s.name, s, aliases, this.classes, this.templates, this.interfaces, this.enums);
          this.interfaces.set(s.name, s);
          if (s.jsClass) jsClasses.set(s.name, s);
          continue;
        }
        if (s.kind === "class" && s.name !== undefined) {
          typeName(s.name, s, aliases, this.classes, this.templates, this.interfaces, this.enums);
          // A class's lifetimes are checked and erased, never instanced, so they are set aside.
          const node = { ...s, id: nextId(this.ids), name: s.name, typeParams: s.typeParams.filter((p) => !isLifetime(p)) };
          if (s.typeParams.some(isLifetime)) this.slots.set(s.name, s.typeParams.map(isLifetime));
          if (node.typeParams.length > 0) this.templates.set(s.name, node);
          else this.classes.set(s.name, declareClass(this.tables, node).classId);
          const declared = this.arenas.classOf(this.classes.get(s.name));
          const rust = rustClassNodes.get(s);
          if (rust) this.typing.rec(declared!.type).rust = rust;
          // A Rust type declaring no constructor is never made with `new`, so its handle needs no
          // assigning in the empty one it is given.
          if (rust && !this.arenas.bodyOf(declared!.constructor).rust) declared!.required.clear();
          // A `static readonly` field is a top-level const named `C.x`, which no source name can be.
          for (const f of declared?.staticFields.values() ?? []) {
            const giving: Stmt = { id: nextId(this.ids), kind: "return", value: f.init!, start: f.init!.start, end: f.init!.end };
            this.funcs.push(this.addBody(Object.assign({ id: nextId(this.ids), kind: "function" as const, async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${s.name}.${f.name}`, returnType: f.type, body: [giving], start: f.start, end: f.end }, { comptime: "const" as const, owner: declared!.type })));
          }
          continue;
        }
        // `declare function f(...): T;` names a C function, called inside `unsafe`.
        if (s.kind === "declare" && s.body.kind === "function" && !hasBody(s.body)) {
          const rest = s.body.params.find((p) => p.rest);
          if (rest) throw unsupported("variadic C functions", rest);
          this.funcs.push(this.addBody(Object.assign({ ...s.body, id: nextId(this.ids), body: [] }, { foreign: true })));
          continue;
        }
        // `export function f() {}` is an ordinary function, and in a library a C function too; an
        // exported macro is for other files.
        if (s.kind === "export" && s.body.kind === "function" && hasBody(s.body)) {
          if (s.body.macro) macroShape(s.body);
          this.funcs.push(this.addBody(s.body.macro ? s.body : Object.assign({ ...s.body, id: nextId(this.ids) }, { exported: true })));
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
              this.funcs.push(this.addBody(arrowFunction(this.ids, d.target.name, d.init, d)));
              continue;
            }
            const giving: Stmt = { id: nextId(this.ids), kind: "return", value: d.init, start: d.init.start, end: d.init.end };
            this.funcs.push(this.addBody(Object.assign({ ...made, id: nextId(this.ids), name: `const ${d.target.name}`, returnType: d.type, body: [giving], start: d.start, end: d.end }, { comptime: "const" as const })));
          }
          continue;
        }
        if (s.kind === "comptime") {
          this.funcs.push(this.addBody(Object.assign({ ...made, id: nextId(this.ids), name: `comptime ${s.start}`, returnType: undefined, body: s.body }, { comptime: "block" as const })));
          continue;
        }
        if (s.kind === "let") throw new CompileError("E0404", "a top-level 'let' would be a global that changes; use 'const', whose value is computed while compiling, or a const holding an Atomic or a Lock", s.start, s.end);
        // Top-level code with side effects belongs in main(); the migration lint moves it there.
        if (s.kind !== "function") throw new CompileError("E0404", "only declarations are allowed at the top level; move this into main()", s.start, s.end);
        const rust = rustNames.get(s);
        if (rust) {
          this.funcs.push(this.addBody(Object.assign({ ...s, id: nextId(this.ids), body: [] }, { foreign: true, rust })));
          continue;
        }
        if (s.js) {
          const body = this.addBody({ ...s, id: nextId(this.ids), body: [] });
          jsBodies.set(s, body.bodyId);
          this.funcs.push(body);
          continue;
        }
        if (!hasBody(s)) throw new CompileError("E0410", `'${s.name}' has no implementation; follow its overload signatures with a 'function ${s.name}' that has a body`, s.start, s.end);
        if (s.macro) macroShape(s);
        this.funcs.push(this.addBody(s));
      } catch (e) {
        this.recover(e);
      }
    }
    // Overloads are lowered on the tree, where an implementation holds its signatures' functions;
    // as a body it names them by id.
    for (const f of this.funcs) if (f.overloads) f.overloads = (f.overloads as unknown as Func[]).map((w) => this.addBody(w).bodyId);
    this.byName = new Map<string, BodyId>();
    for (const f of this.funcs) {
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
        if (this.byName.has(f.name) || this.byName.has(named) || this.byName.has(`const ${named}`) || this.classes.has(named) || this.templates.has(named) || this.enums.has(named)) throw new CompileError("E0402", `'${named}' is already defined`, f.start, f.end);
        this.byName.set(f.name, f.bodyId);
      } catch (e) {
        this.recover(e);
      }
    }
    // A body using a declaration that failed would only say it can't find it.
    this.stopOnErrors();
    this.main = this.bodyNamed("main");
    if (!this.main && !this.library && !this.macros && !this.module) throw new CompileError("E0405", "no main() function; execution starts there", 0, 0);
    this.assuming = new Set<string>();
    this.registryState = new RegistryState();
    this.classes.forEach((c) => this.registry().register(this.arenas.classOf(c)));
    this.genericClassesState = new GenericClassesState();
    this.resolverState = new ResolverState();
    this.typing.lowersRecursive(this.resolver());
    this.typing.lowersInstances(this);
    this.done = new Set<InstanceId>();
    this.rustTypes = new Map<string, string>();
    // Comptime runs a function only once the checker has been through it.
    comptimeChecks(this.tables, (i) => {
      if (this.inProgress.has(i.id)) return false;
      this.checkBody(i);
      return true;
    });
    this.views = new Map<InstanceId, Type>();
    this.demands = new NodeMap<Stmt, Integer>();
    this.candidates = new Map<LocalId, Stmt>();
    this.demanded = 0;
    this.instancingState = new InstancingState(this.typing);
    this.querying = new Set<string>();
    this.placeholders = new WeakNodeMap<Expr, Type>();
    this.broken = new NodeSet<Stmt>();
    this.continued = new NodeSet<Stmt>();
    this.inProgress = new Set<InstanceId>();
    this.nextLocal = 0;
    this.closures = [];
    this.closureBodies = new TypeMap<ClosureType, InstanceId>();
  }

  recover(this: Mut<this>, e: unknown) {
    if (!(e instanceof CompileError)) throw e;
    if (e.code === "E0113") this.unending = true;
    if (!this.errors.some((x) => x.start === e.start && x.end === e.end && x.message === e.message)) this.errors.push(e);
  }

  // A callee only accounts for a `try` when its failure is reported itself: a recursive function's
  // failure may be that very `try`'s.
  private followsOn(e: CompileError): boolean {
    if (!this.claimErrors.includes(e) && this.refused.some(({ type, trait, reason }) => e.message.includes(`'${type}'`) && e.message.includes(`'${trait}'`) && e.message.includes(reason))) return true;
    const callees = this.tryCallees.find(([x]) => x === e)?.[1];
    return callees?.some((b) => this.failed.has(b) && !this.arenas.bodyOf(b).throws && !this.tryCallees.some(([x]) => x === this.failed.get(b))) ?? false;
  }

  stopOnErrors(this: Mut<this>) {
    const held = this.errors.filter((e) => !this.followsOn(e));
    // Errors are never all held back, or a program that failed would build.
    const reported = held.length > 0 ? held : this.errors;
    if (reported.length === 1) throw reported[0];
    if (reported.length > 1) throw new CompileErrors(reported.sort((a, b) => a.start - b.start || a.end - b.end));
  }

  // The error a body's check failed with, when it did.
  failure(f: Body): CompileError | undefined {
    return this.failed.get(f.bodyId);
  }

  // The modules that call back into the checker, each made over it where it is used; what
  // they keep between uses is the checker's.
  registry(this: Mut<this>): Registry {
    return new Registry(this);
  }

  genericClasses(this: Mut<this>): GenericClasses {
    return new GenericClasses(this);
  }

  resolver(this: Mut<this>): Resolver {
    return new Resolver(this);
  }

  instancing(this: Mut<this>): Instancing {
    return new Instancing(this);
  }

  // A class's members, for interface satisfaction.
  members(this: Mut<this>): Members {
    return new ClassMembers(this);
  }

  resolveType(this: Mut<this>, t: TypeNode): Type {
    return this.resolver().resolveType(t);
  }

  withScope<T>(this: Mut<this>, bindings: Map<string, Type>, f: () => T): T {
    return this.resolver().withScope(bindings, f);
  }

  paramType(this: Mut<this>, p: Param, property?: boolean): Type {
    return this.resolver().paramType(p, property);
  }

  instanceOf(this: Mut<this>, f: Body): Instance {
    return this.instancing().instanceOf(f);
  }

  definition(this: Mut<this>, f: Body): Instance {
    return this.instancing().definition(f);
  }

  classNames(at: usize): string[] {
    return this.reached([...this.classes.keys(), ...this.templates.keys()], at);
  }

  register(this: Mut<this>, c: ClassInfo) {
    this.registry().register(c);
  }

  layout(this: Mut<this>, c: ClassInfo) {
    this.registry().layout(c);
  }

  classNamed(this: Mut<this>, name: string, args: Type[], at: Span): ClassType | undefined {
    return this.genericClasses().classNamed(name, args, at);
  }

  fieldsLaid(this: Mut<this>, c: ClassType): boolean {
    return this.registry().layout(this.registry().classOf(c));
  }

  valueType(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type {
    return this.valueTypeOf(name, at, shadowed);
  }

  // An interface is met by shape, as a conditional type's `extends` asks of it.
  conforms(this: Mut<this>, from: Type, to: Type, at: Span): boolean {
    const trait = this.recOf(to);
    return trait?.kind === "interface" ? unsatisfied(from, to as InterfaceType, this.members(), at) === undefined : this.typing.fits(from, to);
  }

  typeNames(at: usize): string[] {
    return this.reached([...this.tables.aliases.keys(), ...this.classes.keys(), ...this.templates.keys(), ...this.interfaces.keys(), ...this.enums.keys()], at);
  }

  // A generic enum's variant made with other type arguments, while lowering.
  variantInstance(this: Mut<this>, v: VariantType, args: Type[]): VariantType {
    const r = this.typing.rec(v);
    return this.resolver().enumInstance(this.enums.get(r.enum)!, args, (this.beingChecked && bodyOf(this.beingChecked)) ?? { start: 0, end: 0 }).variants.get(r.member)!;
  }

  interfaceInstance(this: Mut<this>, t: InterfaceType, args: Type[]): InterfaceType {
    return this.resolver().interfaceInstance(t, args);
  }

  // A class first made while lowering is reported at the function being checked.
  classInstance(this: Mut<this>, c: ClassType, args: Type[]): ClassType {
    return this.genericClasses().classNamed(this.typing.rec(c).generic!.name, args, (this.beingChecked && bodyOf(this.beingChecked)) ?? { start: 0, end: 0 })!;
  }

  checking(): Instance | undefined {
    return this.beingChecked;
  }

  // A body's own signature, where its parameter names shadow top-level ones.
  signing<T>(this: Mut<this>, f: Body, run: () => T): T {
    return this.resolver().withSight(new ParamsInSight(f), run);
  }

  classParams(f: Body): TypeParam[] {
    return f.scope?.size && f.owner ? this.registry().classOf(f.owner).node.typeParams : [];
  }

  comptimeArgument(this: Mut<this>, arg: Expr): Type {
    return this.comptimeLiteral(arg);
  }

  run(this: Mut<this>): Checked {

    this.classes.forEach((c) => this.registry().link(this.arenas.classOf(c), new TypeSet()));
    this.typing.setJsError(this.arenas.classOf(this.classes.get("JsError"))?.type);
    // Classes are laid out before any body is checked, since checking one may need another's
    // fields. Until the resolver exists, a generic class's instance waits for `start`.
    this.registryState.infoOf.forEach((c) => this.registry().layout(this.arenas.classOf(c)));
    this.genericClasses().start();
    this.genericClasses().define();
    // Aliases are checked once classes are laid out, since one may read a class's fields or a
    // function's inferred result, and so is an enum with no type parameters, made now so a
    // payload naming no type is caught unused.
    this.resolver().validate();
    for (const e of this.enums.values()) if (e.data && e.data.params.length === 0) e.type = this.resolver().enumInstance(e, [], e.data.at).type;
    this.classes.forEach((c) => this.implementsSignatures(this.arenas.classOf(c)));
    // An enum with computed members is settled when first read; one nothing reads still reports
    // a bad initializer.
    for (const e of this.enums.values()) void e.members;
    const { unsettled } = this.registryState;
    const { pending } = this.instancingState;
    // The classes as declared, and generic classes' definitions; any other is an instance a call made.
    const declaredClasses = new Set(unsettled);
    // A class's `implements` claims are checked before any body uses the class, so a refused one is
    // reported at the class rather than at each use.
    for (const c of declaredClasses) {
      try {
        this.registry().claims(this.arenas.classOf(c));
      } catch (e) {
        if (e instanceof CompileError) this.claimErrors.push(e);
        this.recover(e);
      }
    }
    this.funcs.forEach((f) => {
      try {
        this.checkBody(this.instancing().definition(f));
      } catch (e) {
        // A package's function Fish can't type is refused where a program calls it.
        if (!f.js || !(e instanceof CompileError)) {
          // A bad signature fails before the body's check does, and fails each call of it as well.
          if (e instanceof CompileError && !this.failed.has(f.bodyId)) this.failed.set(f.bodyId, e);
          return this.recover(e);
        }
        this.typing.jsUncalled.set(f, e);
      }
    });
    // Once a body has failed, a generic body's or class's instances aren't checked: their
    // definitions were, and an instance's error then is most often one a refused call already
    // reported.
    while (!this.unending && (unsettled.length > 0 || pending.length > 0)) {
      if (this.errors.length > 0) {
        pending.length = 0;
        const kept = unsettled.filter((c) => declaredClasses.has(c));
        unsettled.length = 0;
        unsettled.push(...kept);
        if (unsettled.length === 0 && pending.length === 0) break;
      }
      try {
        if (unsettled.length > 0) {
          this.registry().settle(this.arenas.classOf(unsettled.shift()!), (run) => {
            try {
              run();
            } catch (e) {
              this.recover(e);
            }
          });
        } else this.checkBody(this.arenas.instanceOf(pending.shift()!));
      } catch (e) {
        this.recover(e);
      }
    }
    // What follows reads every body's results.
    this.stopOnErrors();
    if (this.main && this.main.params.length > 0) throw new CompileError("E0405", "main() takes no parameters", this.main.start, this.main.end);
    const started = this.main && this.instancing().instanceOf(this.main).returns;
    const future = this.recOf(started);
    if (this.main && (future?.kind === "future" ? future.gives : started) !== "void") throw new CompileError("E0405", "main() can't return a value yet", this.main.start, this.main.end);
    if (this.library) this.funcs.filter((f) => (f as Body).exported).forEach((f) => this.exportable(this.instancing().definition(f)));
    if (this.library && !this.funcs.some((f) => (f as Body).exported)) throw new CompileError("E1003", "a library has nothing for C to call; mark functions with 'export'", 0, 0);
    // An abstract member and a template are checked but never compiled; each concrete class's copy is.
    const compiled = new NodeSet([...this.funcs.filter((f) => !f.macro || this.macros), ...[...this.registryState.infoOf.values()].flatMap((c) => this.registry().bodiesOf(this.arenas.classOf(c))).filter((f) => !f.abstract && !f.template)]);
    // So is an instance made for an abstract class, which only a template's check makes.
    const checkedOnly = (i: Instance): boolean => bodyOf(i).template === true || [...i.bindings.values()].some((t) => abstractPart(this.typing, t)) || (bodyOf(i).closure !== undefined && checkedOnly(this.arenas.instanceOf(bodyOf(i).closure!.parent)));
    const compiledInstances = [...this.instancing().all().filter((i) => i.concrete && compiled.has(bodyOf(i)) && !bodyOf(i).js && !checkedOnly(i)), ...this.closures.map((c) => this.arenas.instanceOf(c)).filter((i) => i.concrete && !checkedOnly(i))];
    unreached(this.typing, this.equalities, this.arenas, compiledInstances.map((i) => i.id), (i) => bodyOf(i).abstract === true || checkedOnly(i));
    // A package's const whose value has no JS form yet stops the program where it is read.
    const earliest = (spans: Span[]) => spans.reduce<Span | undefined>((first, e) => (first === undefined || e.start < first.start ? e : first), undefined);
    const used = earliest(this.jsUses);
    if (used) throw new CompileError("E1005", "reading this package's const isn't supported yet, as its value has no JS form", used.start, used.end);
    // A package's function called with a value, or giving one, that has no JS form.
    const unconverted = earliest(compiledInstances.flatMap((i) => [...i.calls.keys()].filter((x) => {
      if (x.kind !== "call" || !this.jsCalls.has(x)) return false;
      const gives = this.arenas.instanceOf(i.calls.get(x))?.returns ?? "void";
      // A callback crosses as the stored callable it meets.
      const given = (a: Expr) => {
        const to = i.coercions.get(a);
        return to !== undefined && this.typing.holdsPart(to, (u) => this.recOf(u)?.kind === "dyn") ? to : i.types.get(a)!;
      };
      return x.args.some((a) => !this.typing.jsConverts(given(a))) || (gives !== "void" && !this.typing.jsConverts(gives));
    })));
    if (unconverted) throw new CompileError("E1005", "this call gives a package's function a value with no JS form yet", unconverted.start, unconverted.end);
    // A value given to JS becomes a JS value as the call or write converts it.
    const crossing = earliest(compiledInstances.flatMap((i) => [...i.coercions].filter(([x, t]) => !this.jsGiven.has(x as Expr) && this.intoJs(i.types.get(x as Expr) ?? "void", t)).map(([x]) => x)));
    if (crossing) throw new CompileError("E1005", "turning a Fish value into a JS value isn't supported yet, outside a call or a write that gives it to JS; a 'JsValue' or a package's object comes only from JS", crossing.start, crossing.end);
    // A package's declarations have no body to compile.
    // An interface's method may be any class's, as interfaces are met by shape.
    const signed = new Set([...this.interfaces.values()].flatMap((x) => x.members.flatMap((m) => (m.kind === "method" && typeof m.name === "string" ? [m.name] : []))));
    // A method's body is named for its class, as in `C.m`.
    const method = (b: Body) => b.name.slice(b.name.lastIndexOf(".") + 1);
    const overrides = (b: Body) => {
      const base = this.arenas.classOf(this.registry().classOf(b.owner!).base);
      return base !== undefined && inherited(this.arenas, base, "methods", method(b)) !== undefined;
    };
    const required = (b: Body) => b.exported === true || b.accessor === true || b.signature === true || (b.owner !== undefined && (signed.has(method(b)) || overrides(b)));
    const compiledIds = compiledInstances.map((i) => i.id);
    return { instances: compiledIds, tables: this.tables, compilation: this.compilation, warnings: warnings(this.tables, compiledIds, required) };
  }

  localOf(this: Mut<this>, id: LocalId): Local {
    return this.arenas.localOf(id);
  }
  recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.typing.rec(t as Exclude<T, string>);
  }
  isInterface(t: Type) {
    return this.recOf(t)?.kind === "interface";
  }
  // A return type describing the value returned, which keeps its own type: an interface, or a
  // generic function type.
  describes(t: Type) {
    const r = this.recOf(t);
    return r?.kind === "interface" || (r?.kind === "function" && r.generic !== undefined);
  }
  isRef(t: Type): t is RefType {
    return this.recOf(t)?.kind === "ref";
  }
  addBody<F extends Func>(this: Mut<this>, f: F) {
    return this.arenas.addBody(f);
  }
  bodyNamed(this: Mut<this>, name: string) {
    return this.arenas.bodyOf(this.byName.get(name));
  }
  // The name the file holding `at` writes for a top-level name, or nothing when that file can't
  // reach it. Std's prelude is in no file's table and reaches every file, but for its internals.
  reachedAs(name: string, at: usize): string | undefined {
    const file = this.files?.get(at - (at % FILE_SPAN));
    const written = file?.get(name);
    if (written !== undefined) return written;
    if (this.files && [...this.files.values()].some((f) => f.has(name))) return undefined;
    return STD_INTERNAL.has(name) || name.startsWith("__") ? undefined : name;
  }
  reached(names: Iterable<string>, at: usize) {
    return [...names].flatMap((n) => this.reachedAs(n, at) ?? []);
  }
  // What `typeof name` names in a type: a top-level const's type, or a non-generic function's,
  // whose result is checked from its body when it isn't written.
  valueTypeOf(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type {
    if (shadowed) throw new CompileError("E0801", `'typeof' of the local '${name}' isn't supported yet; 'typeof' in a type names a top-level function or const`, at.start, at.end);
    if (this.classes.has(name)) throw new CompileError("E0801", `'typeof' of the class '${name}' isn't supported yet, since classes aren't values in Fish; name the class itself as the type`, at.start, at.end);
    const constant = this.bodyNamed(`const ${name}`);
    const f = constant ?? this.bodyNamed(name);
    if (!f) throw new CompileError("E0114", `'typeof' in a type names a top-level function or const, and there is none named '${name}'`, at.start, at.end);
    if (this.querying.has(name)) throw new CompileError("E0113", `'typeof ${name}' is used in working out ${name}'s own type, so that type would depend on itself; write it out`, at.start, at.end);
    this.querying.add(name);
    try {
      if (!constant) return this.functionTypeOf(f, at);
      const declared = this.instancing().returnTypeOf(constant, new Map());
      if (!declared || this.isInterface(declared)) this.unlaid(name, at);
      return this.typing.widenLet(this.returnOf(this.instancing().instanceOf(constant), at));
    } finally {
      this.querying.delete(name);
    }
  }

  // A computed enum member's value: its initializer, run while compiling as a top-level const is.
  enumMemberValue(this: Mut<this>, owner: string, member: string, init: Expr): Value {
    const giving: Stmt = { id: nextId(this.ids), kind: "return", value: init, start: init.start, end: init.end };
    const f = this.addBody(Object.assign({ id: nextId(this.ids), kind: "function" as const, async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${owner}.${member}`, returnType: undefined, body: [giving], start: init.start, end: init.end }, { comptime: "const" as const }));
    const instance = this.instancing().definition(f);
    this.checkBody(instance);
    return untagged(comptimeBody(instance));
  }

  // A result worked out from a body may need the class being laid out, whose fields aren't known.
  unlaid(this: Mut<this>, name: string, at: Span) {
    const [mid] = this.registryState.laying.values();
    if (mid) throw new CompileError("E0114", `'typeof ${name}' needs ${name}'s result, worked out from its body, while the field types of '${this.typing.rec(this.arenas.classOf(mid).type).name}' are being worked out; write ${name}'s return type`, at.start, at.end);
  }

  // A function's type for `typeof`: a parameter typed with an object type, an interface or a
  // function type makes it generic in Fish, but its declared type is what `typeof` names.
  functionTypeOf(this: Mut<this>, f: Body, at: Span): Type {
    const explicit = (f.typeParams ?? []).filter((p) => !(p.constraint?.kind === "ref" && p.constraint.name === "Lifetime"));
    if (explicit.length > 0 || f.params.some((p) => p.comptime)) {
      throw new CompileError("E0801", `'typeof' of the generic function '${f.name}' isn't supported yet: it has a type per instance, and none is chosen here`, at.start, at.end);
    }
    if (f.generator) throw unsupported("generator functions in 'typeof' types", at);
    const def = this.instancing().definition(f);
    // An async function's written `Promise<T>` is its type; any other interface result, or one
    // left to inference, is worked out from the body.
    const declared = this.instancing().returnTypeOf(f, def.bindings);
    let result: Type;
    if (declared && (f.async || !this.isInterface(declared))) result = declared;
    else {
      this.unlaid(f.name, at);
      const returns = this.returnOf(def, at);
      const future = this.recOf(returns);
      result = f.async && future?.kind === "future" ? this.typing.promiseInterface(future.gives) : returns;
    }
    const open = openParam(this.typing, result, true);
    if (open) {
      const i = f.params.findIndex((_, i) => def.bindings.get(`#${i}`) === open);
      const param = f.params[i]?.pattern;
      throw new CompileError("E0114", `'typeof ${f.name}' can't name its result, which depends on the type of the argument given for '${param?.kind === "ident" ? param.name : this.typing.rec(open).name}'; write the return type`, at.start, at.end);
    }
    return this.typing.functionType(f.params.map((p) => (p.pattern.kind === "ident" ? writtenName(this.tables, p) : "_")), this.instancing().declaredParams(f), result);
  }

  // A comptime parameter's argument: its value, computed in the calling instance, as a literal
  // type. Inside a generic definition the caller's own values aren't known, so it stays open.
  comptimeLiteral(this: Mut<this>, arg: Expr): Type {
    // The caller's own comptime parameter passed on: the same value, or in a definition the same
    // placeholder, so a call passing it on shares the caller's instance.
    const local = arg.kind === "ident" ? this.beingChecked?.locals.get(arg) : undefined;
    const own = local && this.beingChecked && bodyOf(this.beingChecked).params.find((p) => p.comptime && this.beingChecked!.locals.get(p) === local);
    if (own && this.beingChecked) return this.beingChecked.bindings.get(comptimeName(own))!;
    if (!this.beingChecked?.concrete) {
      let open = this.placeholders.get(arg);
      if (!open) this.placeholders.set(arg, open = this.typing.typeParameter("comptime argument", undefined));
      return open;
    }
    // The argument was checked in the innermost body being checked, a closure's perhaps.
    const site = [...this.inProgress].reverse().map((i) => this.arenas.instanceOf(i)).find((i) => i.types.has(arg)) ?? this.beingChecked;
    const given = site.types.get(arg);
    const member = this.recOf(given);
    if (member?.kind === "literal" && member.owner) return given!;
    // The interpreter reads a plain tree, and this body's replacements aren't in place yet.
    const tagged = comptimeArgument(site, rebuiltExpr(arg, this.rewrites));
    const tag = tagged && typeof tagged === "object" && tagged.kind === "member" ? tagged.type : undefined;
    if (this.recOf(tag)?.kind === "literal") return tag!;
    const v = untagged(tagged);
    if (typeof v === "bigint" || typeof v === "string" || typeof v === "boolean") return this.typing.literalType(v);
    if (typeof v === "object" && v?.kind === "array" && v.items.every((x) => typeof x === "string")) return stringsType(this.tables, v.items as string[]);
    throw new CompileError("E1102", "a comptime parameter takes an integer, a boolean, a string, an enum member or a string array", arg.start, arg.end);
  }

  // A generic class's constructor parameters, its base's when it declares no constructor.
  templateParams(this: Mut<this>, name: string, seen: Set<string> = new Set<string>()): Param[] | undefined {
    const t = this.templates.get(name);
    if (!t || seen.has(name)) return undefined;
    const ctor = t.members.find((m) => m.kind === "constructor");
    if (ctor) return ctor.params;
    const named = t.extends?.kind === "instantiation" ? t.extends.expr : t.extends;
    if (named?.kind !== "ident") return undefined;
    return this.templateParams(named.name, seen.add(name)) ?? this.arenas.bodyOf(this.arenas.classOf(this.classes.get(named.name))?.constructor)?.params;
  }

  // Whether a value of type `from` meeting `to` would become a JS value somewhere inside it: a
  // part that isn't a JsValue or a handle where `to` takes only one. An empty array's `never`
  // elements hold nothing.
  intoJs(this: Mut<this>, from: Type, to: Type): boolean {
    const held = (t: Type) => {
      const r = this.recOf(t);
      return r?.kind === "ref" ? r.to : t;
    };
    const js = (t: Type) => {
      const r = this.recOf(t);
      return r?.kind === "block" && r.which === "JsValue";
    };
    [from, to] = [held(from), held(to)];
    if (from === to || from === "never" || typeof to === "string" || !this.typing.holdsPart(to, js, true)) return false;
    if (js(to)) return !js(from);
    const into = this.typing.rec(to);
    const source = this.recOf(from);
    if (into.kind === "union") {
      const others = into.members.filter((m) => !js(m));
      const members = source?.kind === "union" ? source.members : [from];
      return members.some((m) => !into.members.includes(m) && !js(m) && !others.some((o) => this.typing.fits(m, o) && !this.intoJs(m, o)));
    }
    if (source === undefined) return false;
    // An array is never converted element by element where JS values are wanted.
    if ((into.kind === "array" || into.kind === "fixed") && (source.kind === "array" || source.kind === "fixed")) return source.element !== "never" && !(js(source.element) && js(into.element)) && (source.element !== into.element || this.intoJs(source.element, into.element));
    // A field the value leaves out is an absent optional one, which turns nothing into JS.
    if (into.kind === "object" && (source.kind === "object" || source.kind === "class")) return into.fields.some((f) => source.fields.some((g) => g.name === f.name && this.intoJs(g.type, f.type)));
    return false;
  }

  // What a function's returned reference borrows from: the parameters with its written
  // lifetime, or by elision `this` for a method, or the only reference parameter.
  originsOf(this: Mut<this>, f: Body, params: Type[], returns: RefType): Origin[] {
    const at = f.returnType ?? f;
    const { life } = this.typing.rec(returns);
    if (life) {
      const found: Origin[] = f.params.flatMap((p, i) => (this.named(p.type).has(life) ? [i] : []));
      // A lifetime of the method's own class is the object's.
      if (f.owner && this.classLifetimes(f).has(life)) found.push("this");
      if (found.length === 0) throw new CompileError("E0209", `no parameter is borrowed for lifetime '${life}'; write 'Ref<T, ${life}>' on the parameter the result points into`, at.start, at.end);
      return found;
    }
    if (f.self && !f.self.constructor && !f.self.owned) return ["this"];
    const refs = params.flatMap((p, i) => (this.typing.holdsRef(p) ? [i] : []));
    if (refs.length === 1) return refs;
    throw new CompileError("E0209", refs.length === 0
      ? "this function returns a reference but borrows nothing it could point into; return an owned value instead"
      : "this function returns a reference and takes several, so say which it points into: declare '<A extends Lifetime>' and write 'Ref<T, A>' on that parameter and the return type", at.start, at.end);
  }

  // What a value holding references a body returns may point into: the parameters whose
  // annotations name a lifetime its type names, or, naming none, whatever was lent.
  heldOrigins(f: Body): Origin[] | undefined {
    const names = this.named(f.returnType);
    if (names.size === 0) return undefined;
    const found: Origin[] = f.params.flatMap((p, i) => ([...this.named(p.type)].some((n) => names.has(n)) ? [i] : []));
    if ([...this.classLifetimes(f)].some((n) => names.has(n))) found.push("this");
    return found;
  }

  // The lifetime names an annotation writes: on references, and in classes' lifetime slots.
  named(t: TypeNode | undefined): Set<string> {
    const found = new Set<string>();
    walk("typeNode", t, ({ of, node }) => {
      if (of !== "typeNode" || node.kind !== "ref") return;
      const args = node.args as (TypeNode & { name?: string })[];
      if ((node.name === "Ref" || node.name === "Mut") && args.length === 2) found.add(args[1]!.name!);
      const lifetime = this.slots.get(node.name);
      if (lifetime && args.length === lifetime.length) args.forEach((a, i) => lifetime[i] && found.add(a.name!));
    });
    return found;
  }

  // What a call's returned reference, or returned value holding references, borrows from, as
  // the callee's signature says; with no lifetime written, whatever was lent to the call.
  sourcesOf(this: Mut<this>, instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[] {
    const f = bodyOf(instance);
    const returns = this.returnOf(instance, at);
    if (!this.typing.holdsRef(returns)) return [];
    const ref = this.isRef(returns) ? returns : this.typing.optionRef(returns);
    const origins = ref ? this.originsOf(f, this.instancing().paramTypes(instance), ref) : this.heldOrigins(f);
    if (!origins) return [...args.filter(lends), ...(receiver ? [receiver] : [])];
    return origins.flatMap((o) => (o === "this" ? (receiver ? [receiver] : []) : [args[o]!]));
  }

  // Every lifetime a body writes must be one it declares.
  lifetimes(f: Body) {
    const declared = new Set([...(f.typeParams ?? []), ...(f.owner ? this.classNode(this.typing.rec(f.owner).name)?.typeParams ?? [] : [])].filter(isLifetime).map((p) => p.name));
    const types = [...f.params.flatMap((p) => p.type ?? []), ...(f.returnType ? [f.returnType] : [])];
    walk("typeNode", types, ({ of, node }) => {
      if (of !== "typeNode" || node.kind !== "ref") return;
      const lives = (node.name === "Ref" || node.name === "Mut") && node.args.length === 2 ? [node.args[1]!]
        : this.slots.get(node.name)?.length === node.args.length ? node.args.filter((_, i) => this.slots.get(node.name)![i]) : [];
      for (const life of lives as (Span & { name: string })[]) {
        if (!declared.has(life.name)) throw new CompileError("E0209", `cannot find lifetime '${life.name}'; declare it as '<${life.name} extends Lifetime>'`, life.start, life.end);
      }
    });
  }

  // The lifetimes a method's class declares.
  classLifetimes(f: Body): Set<string> {
    return new Set((f.owner ? this.classNode(this.typing.rec(f.owner).name)?.typeParams ?? [] : []).filter(isLifetime).map((p) => p.name));
  }

  // A class's declaration as written, lifetimes included.
  classNode(name: string): ClassNode | undefined {
    const base = name.split("<")[0]!;
    return this.program.find((s): s is ClassNode & Stmt => s.kind === "class" && s.name === base);
  }

  // Codegen sees each type parameter as the concrete type it stands for.
  lowerTables(this: Mut<this>, instance: Instance) {
    this.views.set(instance.id, instance.returns);
    // `JSON.stringify` and printing write a field by how it was spelled, which lowering forgets.
    for (const e of instance.types.keys()) {
      const stringified = e.kind === "call" && this.jsonCalls.get(e) === "stringify" ? e.args[0] : undefined;
      for (const x of [...(stringified ? [stringified] : []), ...(this.printed.has(e) ? [e] : [])]) {
        const type = instance.coercions.get(x) ?? instance.types.get(x);
        if (type) (instance.spelled ??= new NodeMap()).set(x, type);
      }
    }
    for (const table of [instance.types, instance.coercions]) table.forEach((t, e) => table.set(e, this.typing.lower(t)));
    // A pipe's topic written in as a field read would run a getter once for each `%`.
    for (const e of instance.types.keys()) {
      if (e.kind !== "member" || !this.substituted.has(e)) continue;
      const held = this.recOf(instance.types.get(e.object));
      const objectType = held?.kind === "ref" ? held.to : instance.types.get(e.object);
      if (this.recOf(objectType)?.kind === "class" && !this.typing.field(objectType as ClassType, e.name)) throw unsupported("pipes over a field a getter provides", e);
    }
    instance.patterns.forEach((info, p) => instance.patterns.set(p, lowerPattern(this.tables.typing, info)));
    instance.raises.forEach((r, at) => instance.raises.set(at, { ...r, from: this.typing.lower(r.from), to: this.typing.lower(r.to), ...(r.param && { param: this.typing.lower(r.param) }) }));
    instance.caught.forEach((t, s) => instance.caught.set(s, this.typing.lower(t)));
    instance.predicates?.forEach((p, e) => instance.predicates!.set(e, { ...p, type: this.typing.lower(p.type) }));
    if (instance.throws) instance.throws = this.typing.lower(instance.throws);
    for (const local of new Set(instance.locals.values())) this.arenas.localOf(local).type = this.typing.lower(this.arenas.localOf(local).type);
    for (const table of [instance.calls, instance.setters]) table.forEach((target, e) => table.set(e, this.counterpart(this.arenas.instanceOf(target)).id));
    instance.returns = this.typing.lower(instance.returns);
  }

  // A member of a generic class made from a type parameter runs as the same member of the
  // class made from what the parameter stands for. Both come from one template, so their
  // members are in the same order.
  counterpart(this: Mut<this>, target: Instance): Instance {
    const owner = bodyOf(target).owner;
    const to = owner && (this.typing.lower(owner) as ClassType);
    if (!owner || to === owner) return target;
    const body = this.registry().bodiesOf(this.registry().classOf(to!))[this.registry().bodiesOf(this.registry().classOf(owner)).indexOf(bodyOf(target))]!;
    const implicit = [...this.instancing().implicitOf(body).keys()].map((i): [string, Type] => [`#${i}`, target.bindings.get(`#${i}`)!]);
    // Its comptime parameters' values carry over too, as do a generic method's own type
    // arguments.
    const fixed = [...target.bindings].filter(([name]) => name.startsWith("comptime "));
    const own = typeParamsOf(body).map((p): [string, Type] => [p.name, target.bindings.get(p.name)!]);
    return this.instancing().instanceOf(body, new Map([...body.scope!, ...own, ...implicit, ...fixed]));
  }

  // An export in a library is a C function too, so its signature crosses to C as a declared
  // function's does, and it can't throw, be generic or be a generator, which C can't call.
  exportable(this: Mut<this>, instance: Instance) {
    const f = bodyOf(instance);
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || this.recOf(t)?.kind === "pointer";
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
      if (this.defaulted.has(p)) throw new CompileError("E1003", "an exported function's parameter can't have a default in a library, since C callers pass every argument", p.start, p.end);
      const t = this.arenas.localOf(instance.locals.get(p)!).type;
      if (!crosses(t)) throw new CompileError("E1003", `an exported function's parameter can't be a '${this.typing.show(t)}' in a library; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    if (instance.returns !== "void" && !crosses(instance.returns)) {
      const at = f.returnType ?? f;
      throw new CompileError("E1003", `an exported function can't return a '${this.typing.show(instance.returns)}' in a library; C gives numbers, booleans and raw pointers`, at.start, at.end);
    }
  }

  // A C function's signature, which must cross to C as it is: numbers, booleans and raw
  // pointers, with `void` for no result.
  foreignSignature(this: Mut<this>, instance: Instance) {
    const f = bodyOf(instance);
    if (f.rust) return this.rustSignature(instance);
    if (f.typeParams?.length) throw unsupported("generic C functions", f);
    if (f.generator) throw new CompileError("E1002", "a C function can't be a generator; drop the '*'", f.start, f.end);
    if (f.async) throw new CompileError("E1002", "a C function can't be async; C calls return when they finish", f.start, f.end);
    if (f.name === "main") throw new CompileError("E1002", "'main' can't be a C function; it is where the program starts", f.start, f.end);
    if (f.throws) throw new CompileError("E1002", "a C function can't throw; C reports failures in its result", f.throws.start, f.throws.end);
    if (!f.returnType) throw new CompileError("E1002", "a C function needs its return type written, 'void' if it returns nothing", f.start, f.end);
    const crosses = (t: Type) => isNumeric(t) || t === "boolean" || this.recOf(t)?.kind === "pointer";
    const params = this.instancing().paramTypes(instance, this.instancing().scopeOf(instance));
    f.params.forEach((p, i) => {
      if (p.rest || p.optional || p.default) throw unsupported("rest, optional and default parameters on C functions", p);
      if (!crosses(params[i]!)) throw new CompileError("E1002", `a C function's parameter can't be a '${this.typing.show(params[i]!)}'; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    });
    instance.signature = params;
    const returns = this.resolver().resolveType(f.returnType);
    if (returns !== "void" && !crosses(returns)) throw new CompileError("E1002", `a C function can't return a '${this.typing.show(returns)}'; C gives numbers, booleans and raw pointers`, f.returnType.start, f.returnType.end);
    instance.returns = returns;
    this.done.add(instance.id);
  }

  // A Rust function's signature: numbers and booleans, with `void` for no result, so far.
  rustSignature(this: Mut<this>, instance: Instance) {
    const f = bodyOf(instance);
    const what = `the Rust function '${f.name}'`;
    const constructor = f.self?.constructor === true;
    if (f.typeParams?.length) throw unsupported("generic Rust functions", f);
    if (f.generator || f.async) throw new CompileError("E1004", `${what} can't be ${f.async ? "async" : "a generator"}; it returns when the Rust function does`, f.start, f.end);
    // A Rust `Result`'s `Err` is thrown: as Fish's `Error`, made from its Display text, or as the
    // Rust type it is, declared as a class.
    if (f.throws) {
      const error = this.resolver().resolveType(f.throws);
      const r = this.recOf(error);
      const isError = r?.kind === "class" && r.name === "Error" && !r.generic;
      if (!isError && !rustClassOf(this.typing, error)) throw new CompileError("E1004", `${what} throws a Rust 'Err' as Fish's 'Error', made from its Display text, or as a Rust type declared in a 'rust:' block, not as a '${this.typing.show(error)}'`, f.throws.start, f.throws.end);
      if (isError) this.registry().classOf(error as ClassType);
      instance.throws = error;
    }
    if (!f.returnType && !constructor) throw new CompileError("E1004", `${what} needs its return type written, 'void' if it returns nothing`, f.start, f.end);
    const refuse = (t: Type, giving: boolean, at: Span) => {
      const why = crossingOf(this.typing, t, giving);
      if (typeof why === "string") throw new CompileError("E1004", `${giving ? `${what} can't give` : "a Rust function can't take"} a '${this.typing.show(t)}': ${why}`, at.start, at.end);
    };
    const params = this.instancing().paramTypes(instance, this.instancing().scopeOf(instance));
    f.params.forEach((p, i) => {
      if (p.rest || p.optional || p.default || p.comptime) throw unsupported("rest, optional, default and comptime parameters on Rust functions", p);
      refuse(params[i]!, false, p);
    });
    instance.signature = params;
    const returns = f.returnType ? this.resolver().resolveType(f.returnType) : "void";
    if (returns !== "void") refuse(returns, true, f.returnType!);
    // A constructor gives the handle to the value it made.
    instance.returns = constructor ? f.owner! : returns;
    // Every declaration of one Rust function calls the one shim function, so they agree on types.
    // The receiver and what it throws are part of how the shim calls it, so they have to agree too.
    const self = f.self && !constructor ? [f.self.owned ? "self" : f.self.mutable ? "&mut self" : "&self"] : [];
    const types = `(${[...self, ...params.map((t) => this.typing.show(t))].join(", ")}): ${this.typing.show(instance.returns)}${instance.throws ? ` throws ${this.typing.show(instance.throws)}` : ""}`;
    const other = this.rustTypes.get(f.rust!.symbol);
    if (other !== undefined && other !== types) throw new CompileError("E1004", `'${f.rust!.crate}::${f.rust!.path}' is declared elsewhere as ${other}; declare it with the same types`, f.start, f.end);
    this.rustTypes.set(f.rust!.symbol, types);
    this.done.add(instance.id);
  }

  // A package's function's signature, from its declaration: what it takes and gives must cross
  // between Fish and JS, as strings, booleans, numbers, Options, unions and literals of them,
  // arrays of them copied across, and opaque JS values.
  // One imported but not called yet is refused only where a program calls it.
  jsSignature(this: Mut<this>, instance: Instance) {
    try {
      this.jsSigned(instance);
    } catch (e) {
      if (!(e instanceof CompileError) || this.jsCalledAt.has(bodyOf(instance))) throw e;
      this.typing.jsUncalled.set(bodyOf(instance), e);
      instance.signature = [];
      instance.returns = this.typing.blockType("JsValue");
      this.done.add(instance.id);
    }
  }

  jsSigned(this: Mut<this>, instance: Instance) {
    const f = bodyOf(instance);
    const named = `'${f.js!.name}' from '${f.js!.module}'`;
    // A declaration Fish can't type is refused where it is declared, noting the call that reached it.
    const at = this.jsCalledAt.get(f);
    const refuse = (message: string, where: Span) => new CompileError("E1005", message, where.start, where.end, at && { message: `'${f.js!.name}' is called here`, start: at.start, end: at.end });
    // A generic one is checked for each set of type arguments it is called with, as what crosses
    // is known only then; its definition, never compiled, is typed only by each call.
    if (!instance.concrete) {
      instance.signature = [];
      instance.returns = this.typing.blockType("JsValue");
      this.done.add(instance.id);
      return;
    }
    // What its type parameters stand for, as plain types, since JS sees no Fish placeholders.
    const concrete = new Map([...this.instancing().scopeOf(instance)].map(([n, t]): [string, Type] => [n, this.typing.lower(t)]));
    const declared = this.instancing().paramTypes(instance, concrete);
    const params = declared.map((t) => this.typing.jsTakes(t));
    f.params.forEach((p, i) => {
      if (p.rest) throw unsupported(`rest parameters on a package's functions, as ${named} takes,`, p);
      // An object type taken as a JS object's shape is still checked for what it holds.
      const why = this.typing.uncrossable(params[i]!) ?? (params[i] !== declared[i] && typeof declared[i] !== "string" && this.typing.rec(declared[i]!).kind !== "function" && this.typing.rec(declared[i]!).kind !== "interface" ? this.typing.uncrossable(declared[i]!) : undefined);
      if (why) throw refuse(`${named} takes a '${this.typing.show(params[i]!)}', which can't cross between Fish and JS yet: ${why}`, p.type ?? p);
    });
    instance.signature = params;
    const returns = this.typing.jsView(f.returnType ? this.resolver().withScope(concrete, () => this.resolver().resolveType(f.returnType!)) : this.typing.blockType("JsValue"));
    const why = returns === "void" ? undefined : this.typing.uncrossable(returns);
    if (why) throw refuse(`${named} gives a '${this.typing.show(returns)}', which can't cross between Fish and JS yet: ${why}`, f.returnType!);
    instance.returns = returns;
    this.done.add(instance.id);
  }

  // An overload signature's body only passes its parameters on, so what fails there is the
  // signature not matching its implementation.
  incompatible(signature: Body, e: unknown): unknown {
    const prefix = "this overload signature is not compatible with its implementation";
    if (!(e instanceof CompileError) || e.start < signature.start || e.end > signature.end || e.message.startsWith(prefix)) return e;
    return new CompileError("E0410", `${prefix}: ${e.message}`, e.start, e.end, e.note);
  }

  // A call made inside an instance with one of its type parameters gets the type the definition
  // gave it: the callee's return with the callee's parameters as the ones the call passed.
  resultOf(this: Mut<this>, instance: Instance, at: Span & Id): Type {
    // Checking the callee may instantiate from this call again, so its site is read first.
    const site = this.instancing().siteOf(at);
    const returns = this.returnOf(instance, at);
    if (!site || (bodyOf(instance).js && instance.concrete)) return returns;
    const f = bodyOf(instance);
    const declared = this.instancing().returnTypeOf(f, new Map([...instance.bindings, ...site]));
    if (declared && !this.describes(declared)) return declared;
    const own = this.instancing().scopeOf(instance);
    return this.typing.replaced(this.views.get(instance.id) ?? returns, new TypeMap([...site].map(([name, t]) => [own.get(name)!, t])));
  }

  // Each member a class writes that implements an abstract member takes what the declaration
  // takes and gives what it gives, as a template calling it through the abstract class expects.
  implementsSignatures(this: Mut<this>, c: ClassInfo) {
    for (const table of ["methods", "getters", "setters"] as const) {
      for (const [name, id] of c[table]) {
        const f = this.arenas.bodyOf(id);
        if (f.abstract || f.copyOf !== undefined) continue;
        for (let b = this.arenas.classOf(c.base); b; b = this.arenas.classOf(b.base)) {
          const declared = this.arenas.bodyOf(b[table].get(name));
          if (declared?.abstract) this.implementsSignature(f, declared, b);
        }
      }
    }
    for (let b = this.arenas.classOf(c.base); b; b = this.arenas.classOf(b.base)) {
      for (const [name, id] of b.getters) {
        const declared = this.arenas.bodyOf(id);
        const own = this.typing.rec(c.type).fields.find((x) => x.name === name);
        if (!declared.abstract || !own) continue;
        const wanted = this.returnOf(this.instancing().instanceOf(declared), declared);
        const at = c.fields.find((x) => x.name === name)!;
        // A field is read as it is, so it has the declared type exactly.
        if (own.type !== wanted) throw new CompileError("E0701", `'${name}' must be a '${this.typing.show(wanted)}', not a '${this.typing.show(own.type)}', as '${this.typing.rec(b.type).name}' declares it abstract`, at.start, at.end);
      }
    }
  }

  implementsSignature(this: Mut<this>, f: Body, declared: Body, b: ClassInfo) {
    const base = this.typing.rec(b.type).name;
    const why = (text: string) => new CompileError("E0701", `'${declared.name.slice(base.length + 1)}' ${text}, as '${base}' declares it abstract`, f.start, f.end);
    const want = this.instancing().declaredParams(declared);
    const rest = f.params.find((p) => p.rest);
    if (rest && !declared.params.some((p) => p.rest)) throw new CompileError("E0801", `'${f.name.slice(this.typing.rec(f.owner!).name.length + 1)}' can't gather its arguments into a rest parameter yet where '${base}' declares it abstract with separate ones`, rest.start, rest.end);
    // A generic implementation is the instance its type parameters take from the declaration's.
    const names = new Set(typeParamsOf(f).map((p) => p.name));
    const bindings = new Map<string, Type>();
    if (names.size > 0) f.params.forEach((p, i) => p.type && want[i] !== undefined && infer(this.tables, p.type, want[i]!, names, bindings, f));
    if (bindings.size < names.size) throw why(`must take (${want.map((t) => this.typing.show(t)).join(", ")})`);
    const instance = names.size > 0 ? this.instancing().instanceOf(f, new Map([...(f.scope ?? []), ...bindings])) : this.instancing().instanceOf(f);
    const have = names.size > 0 ? this.instancing().paramTypes(instance) : this.instancing().declaredParams(f);
    // Parameters past the declaration's must be optional, as the calls through it leave them out.
    const extra = f.params.slice(want.length).some((p) => !p.optional);
    if (have.length < want.length || extra || want.some((t, i) => !this.typing.fits(t, have[i]!))) throw why(`must take (${want.map((t) => this.typing.show(t)).join(", ")})`);
    if (!!f.async !== !!declared.async) throw why(declared.async ? "must be async" : "can't be async");
    if (!!f.generator !== !!declared.generator) throw why(declared.generator ? "must be a generator" : "can't be a generator");
    if (f.self!.mutable && !declared.self!.mutable) throw why("can't change 'this'; it borrows 'this' read-only");
    if (!!f.self!.owned !== !!declared.self!.owned) throw why(declared.self!.owned ? "must take 'this: Own<this>'" : "can't take 'this: Own<this>'");
    const [error, allowed] = [this.errorOf(instance), this.errorOf(this.instancing().instanceOf(declared))];
    if (error && (!allowed || !this.typing.fits(error, allowed))) throw why(allowed ? `can only throw '${this.typing.show(allowed)}'` : "can't throw");
    const [gives, wanted] = [this.returnOf(instance, f), this.returnOf(this.instancing().instanceOf(declared), declared)];
    if (!this.typing.fits(gives, wanted)) throw why(`must return '${this.typing.show(wanted)}', not '${this.typing.show(gives)}'`);
  }

  // What a call of an instance may throw, as its caller sees it.
  errorOf(this: Mut<this>, instance: Instance): Type | undefined {
    const f = bodyOf(instance);
    return f.throws && this.resolver().withScope(instance.bindings, () => this.resolver().resolveType(f.throws!));
  }

  returnOf(this: Mut<this>, instance: Instance, at: Span): Type {
    const f = bodyOf(instance);
    // A package's function gives what its signature made of its declaration for JS; a generic
    // one's definition gives what it declares, as each instance makes its own.
    if (f.js && instance.concrete) {
      this.checkBody(instance);
      return instance.returns;
    }
    const declared = this.instancing().returnTypeOf(f, instance.bindings);
    if (declared && !this.describes(declared)) return declared;
    if (this.inProgress.has(instance.id)) {
      if (f.generator) throw new CompileError("E0113", `a generator can't make another of itself, since its state would have to hold itself; loop inside one generator instead`, at.start, at.end);
      if (f.async) throw new CompileError("E0113", `an async function can't await another of itself, since its state would have to hold itself; loop inside one instead`, at.start, at.end);
      throw new CompileError("E0104", `'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    this.checkBody(instance);
    return instance.returns;
  }

  // The check of a generic body as written, before an instance's: a generic function's
  // definition, or the same member of its generic class's definition, with a closure's body
  // checked within the body it is written in.
  asWritten(this: Mut<this>, instance: Instance): void {
    let f = bodyOf(instance);
    if (f.closure) return this.asWritten(this.arenas.instanceOf(f.closure.parent));
    const generic = f.scope && f.owner ? this.typing.rec(f.owner).generic : undefined;
    const template = generic ? this.genericClasses().definedClass(generic.name) : undefined;
    if (template) f = this.registry().bodiesOf(template).find((b) => b.start === f.start && b.end === f.end) ?? f;
    const written = this.instancing().definition(f);
    if (written !== instance && !this.inProgress.has(written.id)) this.checkBody(written);
  }

  // Checks an instance with its type arguments in scope.
  checkBody(this: Mut<this>, instance: Instance) {
    if (this.done.has(instance.id)) return;
    const outer = this.beingChecked;
    const outerDemanded = this.demanded;
    this.beingChecked = instance;
    try {
      // A pass whose body made a new demand is thrown away, whatever it concluded, and the body
      // is checked again with the demanded types; each pass adds one, so this ends.
      for (;;) {
        this.demanded = 0;
        try {
          // A body sees its own names, not those of a body whose check needed it.
          this.resolver().withSight(undefined, () => this.resolver().withScope(this.instancing().scopeOf(instance), () => this.checkInstance(instance)));
        } catch (e) {
          this.inProgress.delete(instance.id);
          if (!(e instanceof CompileError) || this.demanded === 0) {
            const thrown = bodyOf(instance).signature ? this.incompatible(bodyOf(instance), e) : e;
            if (thrown instanceof CompileError) this.failed.set(instance.body, thrown);
            throw thrown;
          }
        }
        if (this.demanded === 0) return;
        this.forget(instance);
      }
    } finally {
      this.beingChecked = outer;
      this.demanded = outerDemanded;
    }
  }

  // Clears what checking an instance recorded, for another pass: its tables and its closures.
  // A callee checked during the pass stays checked, closures and all.
  forget(this: Mut<this>, instance: Instance) {
    for (const table of [instance.types, instance.locals, instance.calls, instance.setters, instance.coercions, instance.jumps, instance.borrowsFrom, instance.raises, instance.caught, instance.consumes, instance.patterns, instance.copiesOut]) table.clear();
    instance.returns = "void";
    delete instance.throws;
    delete instance.envs;
    delete instance.dyns;
    delete instance.made;
    delete instance.predicates;
    const within = (c: Instance): boolean => c === instance || (bodyOf(c).closure !== undefined && within(this.arenas.instanceOf(bodyOf(c).closure!.parent)));
    // A closure checked within a discarded pass isn't in progress any more either.
    for (const c of [...this.inProgress]) if (within(this.arenas.instanceOf(c))) this.inProgress.delete(c);
    const kept = this.closures.filter((c) => !within(this.arenas.instanceOf(c)));
    this.closures.length = 0;
    this.closures.push(...kept);
    this.views.delete(instance.id);
    this.done.delete(instance.id);
    this.inProgress.delete(instance.id);
  }

  checkInstance(this: Mut<this>, instance: Instance, outer?: Outer) {
    const f = bodyOf(instance);
    // A comptime parameter's value is the instance's own; one called from C, or kept in an async
    // function's or a generator's state, or given to an accessor, has no instance per value.
    const fixedParam = f.params.find((p) => p.comptime);
    if (fixedParam && f.foreign && !f.rust) throw new CompileError("E1002", "a C function can't take a comptime parameter: C takes every argument at run time", fixedParam.start, fixedParam.end);
    if (fixedParam && f.accessor) throw new CompileError("E1102", "an accessor can't take a comptime parameter, since a read or an assignment gives it no value while compiling", fixedParam.start, fixedParam.end);
    if (f.foreign) return this.foreignSignature(instance);
    if (f.abstract) {
      instance.returns = this.instancing().returnTypeOf(f, instance.bindings) ?? "void";
      this.done.add(instance.id);
      return;
    }
    if (f.js) return this.jsSignature(instance);
    if (fixedParam && (f.async || f.generator)) throw unsupported("comptime parameters on async functions and generators", fixedParam);
    if (fixedParam && f.exported) throw new CompileError("E1003", "an exported function can't take a comptime parameter, since C calls it with run-time values", fixedParam.start, fixedParam.end);
    this.inProgress.add(instance.id);
    new BodyChecker(this, instance, outer, f).check();
  }
}

// Whether a type written at `at` sits inside a body.
function writtenIn(f: Body, at: Span): boolean {
  return at.start >= f.start && at.end <= f.end;
}

// A class's members, for interface satisfaction, read through the checker.
class ClassMembers implements Members {
  cx: Mut<Checker>;
  typing: Typing;
  arenas: Arenas;
  assuming: Set<string>;
  refused: Members["refused"];

  constructor(cx: Mut<Checker>) {
    this.cx = cx;
    this.typing = cx.typing;
    this.arenas = cx.arenas;
    this.assuming = cx.assuming;
    this.refused = cx.refused;
  }

  classOf(t: ClassType): ClassInfo {
    return this.cx.registry().classOf(t);
  }

  returnOf(this: Mut<this>, b: Body, at: Span): Type {
    return this.cx.returnOf(this.cx.instancing().definition(b), at);
  }

  // A generic method's, with its own type parameters standing for themselves.
  paramTypesOf(this: Mut<this>, b: Body): Type[] {
    const instancing = this.cx.instancing();
    return (b.typeParams ?? []).some((p) => !isLifetime(p)) ? instancing.paramTypes(instancing.definition(b), instancing.scopeOf(instancing.definition(b))) : instancing.declaredParams(b);
  }

  bodyNamed(name: string): Body | undefined {
    return this.cx.bodyNamed(name);
  }

  typeParamsOf(this: Mut<this>, b: Body): Type[] {
    const scope = this.cx.instancing().scopeOf(this.cx.instancing().definition(b));
    return (b.typeParams ?? []).filter((p) => !isLifetime(p)).map((p) => scope.get(p.name)!);
  }
}

// What a body's signature sees: its own parameters' names, where written inside it.
class ParamsInSight implements Sight {
  f: Body;

  constructor(f: Body) {
    this.f = f;
  }

  inSight(name: string, at: Span): boolean {
    return writtenIn(this.f, at) && this.f.params.some((p) => p.pattern.kind === "ident" && p.pattern.name === name);
  }
}

class BodyChecker implements Context, Outer, Sight {
  cx: Mut<Checker>;
  instance: Instance;
  outer: Outer | undefined;
  f: Body;
  types: Instance["types"];
  locals: Instance["locals"];
  coercions: Instance["coercions"];
  calls: Instance["calls"];
  jumps: Instance["jumps"];
  declared: Type | undefined;
  // A generator's declared `Generator<T>`, or an async one's `AsyncGenerator<T>`, says what it
  // yields; calling it gives its own type.
  generatorType: GeneratorType | undefined;
  generatorName: string;
  yielded: Type | undefined;
  // What `next(x)` sends, which a `yield` whose value is used gives.
  sends: Type | undefined;
  // An async function's declared `Promise<T>` says what it gives once awaited; its `return`s
  // give that, and calling it gives its own future, which runs nothing until awaited.
  future: FutureType | undefined;
  trait: InterfaceType | undefined;
  // A function returning a generic function type returns the one generic function it gives.
  family: FunctionType | undefined;
  inferred: Type | undefined;
  // The awaits written where the state machine can stop at them.
  awaitable: NodeSet<Expr>;
  // The yields whose value is used where the generator can stop at them.
  yieldable: NodeSet<Expr>;
  // How many statements with a `finally` enclose the code being checked: a generator dropped
  // at a `yield` there would never run the `finally`.
  finalizing: usize;
  scopes: Map<string, LocalId>[];
  targets: Target[];
  // What the conditions guarding the code being checked prove, innermost last. A `let`
  // narrows only when nothing assigns to its name.
  facts: Facts[];
  // The list being checked and the place in it, for a statement that becomes several.
  siblings: { list: Stmt[]; at: usize } | undefined;
  // For each enclosing `try`, the errors its block raises so far, where and of what type.
  handlers: [Expr | Stmt, Type][][];
  // How many comptime blocks or expressions the code being checked is inside, and for each
  // block, how many targets were open when it began, which nothing inside may jump to.
  comptimeDepth: usize;
  floors: usize[];
  // Each narrowed `Mut` given a whole value of another member, in order.
  changed: LocalId[];
  // The expression an expression statement being checked consists of.
  whole: Expr | undefined;
  assigned: Set<string>;
  // How many scopes enclose each binding's declaration.
  depths: Map<LocalId, usize>;
  // Bindings declared directly in a switch case body whose checking has finished.
  caseOnly: Set<LocalId>;
  // A constructor's fields are unset until assigned, so until then `this` may only appear as
  // the target of an assignment to one of them, and the constructor can't return.
  unset: Set<string>;
  exempt: Expr | undefined;
  // A derived constructor's first statement, `super(...)`, fills the embedded base.
  // After its parameters' defaults, which `super(...)` may read.
  superCall: Expr | undefined;
  // Whether the constructor has assigned a field, an initializer's or its base's included. A
  // `new` that fails drops nothing, so from then on nothing in the constructor may throw.
  built: boolean;
  // A closure sees the `this` of the body it is written in, which it only reads.
  enclosing: Body["self"];
  self: Body["self"];
  captures: Map<LocalId, LocalId | "this"> | undefined;
  setters: Instance["setters"];
  // What expression checking reads of the program and of this body.
  tables: Tables;
  byName: Map<string, BodyId>;
  classes: Map<string, ClassId>;
  enums: Map<string, EnumInfo>;
  patterns: Instance["patterns"];
  copiesOut: Instance["copiesOut"];
  borrowsFrom: Instance["borrowsFrom"];
  // Whether this is a closure owning what it captures: async, or `move`.
  owning: boolean;
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  syncMain: boolean;
  closing: boolean;
  generator: boolean;
  runtime: boolean;
  locked: string | undefined;
  sharing: boolean;
  async: boolean;
  unsafe: boolean;
  exprsState: ExpressionsState;
  // What the function may throw: any value's type. An arrow with none written takes it from the
  // function type it is given as, as it does its parameters' types, or else from what its body
  // can throw; a nested function declares its own.
  contextual: FunctionType | undefined;
  inferring: [Expr | Stmt, Type][] | undefined;
  errorType: Type | undefined;
  params: Type[];
  // A field initializer runs before the constructor's body, out of reach of its parameters.
  hidden: boolean;

  constructor(cx: Mut<Checker>, instance: Instance, outer: Outer | undefined, f: Body) {
    this.cx = cx;
    this.instance = instance;
    this.outer = outer;
    this.f = f;
    this.types = this.instance.types;
    this.locals = this.instance.locals;
    this.coercions = this.instance.coercions;
    this.calls = this.instance.calls;
    this.setters = this.instance.setters;
    this.jumps = this.instance.jumps;
    // A closure returns the number type the function type it meets returns, so its literals
    // take that type.
    const given = this.f.closure?.expected && this.cx.typing.rec(this.f.closure.expected).returns;
    this.declared = this.f.closure ? (this.f.returnType ? this.cx.typing.stored(this.cx.resolver().resolveType(this.f.returnType)) : given && isNumeric(given) ? given : undefined) : this.cx.instancing().returnTypeOf(this.f, this.cx.instancing().scopeOf(this.instance));
    this.generatorType = this.f.generator ? (this.instance.generator ??= madeBy(this.cx.typing.generatorType(this.f.name, this.instance.concrete, this.f.async === true), this.instance)) : undefined;
    this.generatorName = this.f.async ? "AsyncGenerator" : "Generator";
    this.yielded = this.generatorType && this.declared ? this.cx.typing.generatorElement(this.declared, this.f.async === true) : undefined;
    // What `next(x)` sends, which a `yield` whose value is used gives.
    this.sends = this.generatorType && this.declared ? this.cx.typing.generatorSends(this.declared) : undefined;
    if (this.generatorType && this.sends !== undefined) this.cx.typing.rec(this.generatorType).sends = this.instance.concrete ? this.cx.typing.lower(this.sends) : this.sends;
    if (this.generatorType && this.declared && !this.yielded) throw new CompileError("E0606", `${this.f.async ? "an async" : "a"} generator function's return type is '${this.generatorName}<T>', the type of what it yields`, this.f.returnType!.start, this.f.returnType!.end);
    if (this.generatorType) this.declared = undefined;
    if (this.yielded && this.cx.typing.holdsRef(this.yielded)) throw unsupported("generators yielding references", this.f.returnType!);
    this.future = this.f.async && !this.f.generator ? (this.instance.future ??= madeBy(this.cx.typing.futureType(this.f.name, this.instance.concrete), this.instance)) : undefined;
    if (this.future && this.declared) {
      const gives = this.cx.typing.promiseElement(this.declared);
      if (gives === undefined) throw new CompileError("E0305", "an async function's return type is 'Promise<T>', the type of what it gives once awaited", this.f.returnType!.start, this.f.returnType!.end);
      this.declared = gives;
    }
    // A function returning an interface returns its one concrete type, which must satisfy it.
    const returned = this.cx.recOf(this.declared);
    this.trait = returned?.kind === "interface" ? (this.declared as InterfaceType) : undefined;
    this.family = returned?.kind === "function" && returned.generic ? (this.declared as FunctionType) : undefined;
    if (this.trait || this.family) this.declared = undefined;
    this.awaitable = new NodeSet<Expr>();
    this.yieldable = new NodeSet<Expr>();
    this.finalizing = 0;
    this.scopes = [new Map()];
    this.cx.resolver().setSight(this);
    this.targets = [];
    this.facts = [];
    this.handlers = [];
    this.comptimeDepth = 0;
    this.floors = [];
    this.changed = [];
    this.assigned = assignedNames(this.f.body);
    this.depths = new Map<LocalId, usize>();
    this.caseOnly = new Set<LocalId>();
    this.unset = new Set(this.f.self?.constructor ? this.cx.registry().classOf(this.f.self.type).required : []);
    this.superCall = this.f.self?.constructor && this.cx.typing.rec(this.f.self.type).base ? (this.f.body.find((s) => !this.cx.prologues.has(s)) as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (this.superCall) this.unset.add(SUPER);
    this.built = false;

    // In a member of a generic class's instance, `this` is the class made from the type
    // parameters as this body sees them, so it reads through their bounds as the definition did.
    const generic = this.f.self && this.cx.typing.rec(this.f.self.type).generic;
    const resolver = this.cx.resolver();
    const viewed = generic && this.cx.genericClasses().classNamed(generic.name, this.cx.registry().classOf(this.f.self!.type).node.typeParams.map((p) => resolver.resolveType({ id: nextId(this.cx.ids), kind: "ref", name: p.name, args: [], start: this.f.start, end: this.f.start })), this.f)!;
    this.enclosing = this.f.closure && selfOf(this.cx.arenas, this.f);
    this.self = this.f.closure ? this.enclosing && { ...this.enclosing, constructor: false, mutable: false, owned: false } : this.f.self && { ...this.f.self, type: viewed ?? this.f.self.type };
    this.captures = this.instance.captures;
    this.tables = this.cx.tables;
    this.byName = this.cx.byName;
    this.classes = this.cx.classes;
    this.enums = this.cx.enums;
    this.patterns = this.instance.patterns;
    this.copiesOut = this.instance.copiesOut;
    this.borrowsFrom = this.instance.borrowsFrom;
    this.owning = this.f.closure !== undefined && (this.f.async === true || this.f.closure.move === true);
    this.owner = this.f.closure ? this.closureOwner(this.f) : this.f.declared ?? (this.f.owner && this.f.owner === this.f.self?.type ? this.self!.type : this.f.owner);
    this.syncMain = this.cx.timerMains.has(this.f as Body & Func);
    this.closing = this.f.closure !== undefined;
    this.generator = this.f.generator === true;
    this.runtime = !this.cx.library && this.cx.funcs.some((g) => g.name === "main" && g.async === true);
    this.locked = this.f.closure?.expected === undefined ? undefined : this.cx.typing.lockCallbacks.get(this.f.closure.expected);
    this.sharing = this.f.closure?.expected !== undefined && this.cx.typing.sharedCallbacks.has(this.f.closure.expected);
    this.async = this.f.async === true;
    this.unsafe = this.f.closure?.unsafe === true;
    this.exprsState = new ExpressionsState(this.unsafe);

    // A call leaves out only the last parameters, so none may be required after an optional one.
    const late = this.f.params.find((p, i) => !p.optional && !p.rest && this.f.params.slice(0, i).some((q) => q.optional));
    if (late) throw new CompileError("E0408", "a required parameter can't follow an optional one; move it before them, or make it optional too", late.start, late.end);
    this.contextual = this.f.closure && !this.f.throws && this.f.closure.self === undefined && !this.f.async && this.f.closure.expected && !this.cx.typing.openThrows.has(this.f.closure.expected) ? this.f.closure.expected : undefined;
    this.inferring = this.f.closure !== undefined && !this.f.throws && this.f.closure.self === undefined && !this.contextual ? [] as [Expr | Stmt, Type][] : undefined;
    this.errorType = this.f.throws ? this.cx.resolver().resolveType(this.f.throws) : this.contextual && this.cx.typing.rec(this.contextual).throws;
    if (this.errorType === "void") throw new CompileError("E0118", "a function can't throw 'void'; throw a value", this.f.throws!.start, this.f.throws!.end);
    if (this.errorType && this.cx.typing.holdsRef(this.errorType)) throw unsupported("errors holding references", this.f.throws!);
    this.instance.throws = this.errorType;
    // Advancing a generator runs its body, so that is what throws, not calling it.
    if (this.generatorType && this.errorType) this.cx.typing.rec(this.generatorType).throws = this.instance.concrete ? this.cx.typing.lower(this.errorType) : this.errorType;
    this.params = this.f.closure ? this.f.params.map((p, i) => this.closureParam(p, i, this.f.closure!.expected)) : this.cx.instancing().paramTypes(this.instance, this.cx.instancing().scopeOf(this.instance));
    this.f.params.forEach((p, i) => this.declare(paramName(p), this.params[i]!, false, true, p));
    this.hidden = false;
  }
  // The expression checker, made over this body where it is used.
  exprs(this: Mut<this>): Expressions {
    return new Expressions(this);
  }

  members(this: Mut<this>): Members {
    return this.cx.members();
  }


  enumInstance(this: Mut<this>, info: EnumInfo, args: Type[], at: Span): EnumInstance {
    return this.cx.resolver().enumInstance(info, args, at);
  }

  construct(this: Mut<this>, name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined {
    return this.cx.genericClasses().construct(name, typeArgs, argTypes, at);
  }

  templateParams(name: string): Param[] | undefined {
    return this.cx.templateParams(name);
  }

  definedClass(this: Mut<this>, name: string): ClassInfo | undefined {
    return this.cx.genericClasses().definedClass(name);
  }

  returnOf(this: Mut<this>, instance: Instance, at: Span): Type {
    return this.cx.returnOf(instance, at);
  }

  resultOf(this: Mut<this>, instance: Instance, at: Span & Id): Type {
    return this.cx.resultOf(instance, at);
  }

  sourcesOf(this: Mut<this>, instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[] {
    return this.cx.sourcesOf(instance, args, receiver, at, lends);
  }

  classOf(t: ClassType): ClassInfo {
    return this.cx.registry().classOf(t);
  }

  instanceOf(this: Mut<this>, f: Body, bindings?: Map<string, Type>): Instance {
    return this.cx.instancing().instanceOf(f, bindings);
  }

  instantiate(this: Mut<this>, f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance {
    return this.cx.instancing().instantiate(f, typeArgs, args, argTypes, at as Span & Id);
  }

  paramTypes(this: Mut<this>, instance: Instance): Type[] {
    return this.cx.instancing().paramTypes(instance);
  }

  names(at: usize): string[] {
    return [...this.inScope(), ...this.cx.reached([...this.cx.byName.keys()].map((n) => n.replace(/^const /, "")), at)];
  }

  classNames(at: usize): string[] {
    return this.cx.reached([...this.cx.classes.keys(), ...this.cx.templates.keys()], at);
  }

  asWritten(this: Mut<this>) {
    this.cx.asWritten(this.instance);
  }

  envOf(this: Mut<this>, e: Expr, of: Instance, env: Local[]) {
    (this.instance.envs ??= new NodeMap()).set(e, { of: of.id, env: env.map((l) => l.localId) });
  }

  dynOf(this: Mut<this>, e: Expr, table: DynTable) {
    (this.instance.dyns ??= new NodeMap()).set(e, table);
  }

  // Runs a match arm in a scope of its own, holding the names its pattern binds.
  arm<T>(this: Mut<this>, run: () => T): T {
    this.scopes.push(new Map());
    try {
      return run();
    } finally {
      this.scopes.pop();
    }
  }

  block(this: Mut<this>, arm: Extract<Stmt, { kind: "block" }>, wanted: boolean): [Expr, Type][] {
    const target: Target = { stmt: arm, kind: "arm", wanted, gives: [] };
    this.within(target, () => this.statement(arm));
    if (wanted && !alwaysReturns(arm.body, this.cx.broken, this.cx.continued)) {
      throw new CompileError("E0601", "this arm can reach its end without giving a value; give one with 'return', as in an arrow's block", arm.end - 1, arm.end);
    }
    return target.gives!;
  }

  bind(this: Mut<this>, name: string, type: Type, node: Expr): Local {
    this.declare(name, type, false, false, node);
    return this.cx.localOf(this.locals.get(node)!);
  }

  captured(l: Local): boolean {
    return this.captures?.has(l.localId) ?? false;
  }

  comptime<T>(this: Mut<this>, check: () => T): T {
    this.comptimeDepth++;
    try {
      return check();
    } finally {
      this.comptimeDepth--;
    }
  }

  errorOf(this: Mut<this>, instance: Instance): Type | undefined {
    return this.cx.errorOf(instance);
  }

  throwsDeclared(): Type | undefined {
    return this.instance.throws;
  }

  reachable(l: Local): boolean {
    return !this.caseOnly.has(l.localId);
  }

  depthOf(l: Local): usize {
    return this.depths.get(l.localId)!;
  }

  resolveWith(this: Mut<this>, t: TypeNode, scope: Map<string, Type>): Type {
    return this.cx.resolver().withScope(scope, () => this.cx.resolver().resolveType(t));
  }

  closureBody(t: ClosureType): Instance {
    return this.cx.arenas.instanceOf(this.cx.closureBodies.get(t)!);
  }

  resolveType(this: Mut<this>, t: TypeNode): Type {
    return this.cx.resolver().resolveType(t);
  }

  implicitOf(this: Mut<this>, f: Body): Map<usize, Bound> {
    return this.cx.instancing().implicitOf(f);
  }

  callbackType(this: Mut<this>, f: Body, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: usize, at: Span): FunctionType | undefined {
    return this.cx.instancing().callbackType(f, typeArgs, argTypes, i, at);
  }

  constructs(this: Mut<this>, f: Body, args: Expr[], argTypes: Type[]) {
    this.cx.instancing().constructs(f, args, argTypes);
  }

  // A candidate meeting another integer type demands it, for the next pass.
  // A closure's capture stands for the variable it captures. The first demand decides,
  // and a different one is the usual mismatch once it applies.
  infer(this: Mut<this>, e: Expr, to: Type): boolean {
    let local = e.kind === "ident" ? this.cx.arenas.localOf(this.locals.get(e)) : undefined;
    for (let at: Instance | undefined = this.instance; local && at?.captures?.has(local.localId); at = this.cx.arenas.instanceOf(bodyOf(at).closure?.parent)) {
      const from = at.captures.get(local.localId)!;
      local = from === "this" ? undefined : this.cx.localOf(from);
    }
    const s = local && this.cx.candidates.get(local.localId);
    if (!s || !isInteger(to) || to === "i64") return false;
    if (this.cx.demands.has(s)) return this.cx.demands.get(s) === to;
    this.cx.demands.set(s, to);
    this.cx.demanded++;
    return true;
  }

  changesLocal(this: Mut<this>, l: Local, path: string, action: string, target: Expr, throughMut: boolean) {
    this.exprs().changesLocal(l, path, action, target, throughMut);
  }

  changesThis(this: Mut<this>, path: string, action: string, target: Expr) {
    this.exprs().changesThis(path, action, target);
  }

  check(this: Mut<this>) {
    this.statements(this.f.body, (s, check) => {
      const assigned = this.unset.size > 0 ? this.fieldAssignment(s) : undefined;
      this.exempt = assigned?.object;
      this.hidden = this.f.self?.constructor === true && this.cx.registry().classOf(this.f.self.type).initializers.has(s);
      const after = check(s);
      this.exempt = undefined;
      this.hidden = false;
      if (assigned) this.unset.delete(assigned.name);
      if (s.kind === "expr" && s.expr === this.superCall) this.unset.delete(SUPER);
      if (assigned || (s.kind === "expr" && s.expr === this.superCall)) this.built = true;
      return after;
    });
    this.exprs().finish();
    // An inferred error is every one the body lets out, widened as a `let` is.
    if (this.inferring && this.inferring.length > 0) {
      this.errorType = this.cx.typing.unionType(this.inferring.map(([, t]) => this.cx.typing.widenLet(t)));
      for (const [at, from] of this.inferring) this.instance.raises.set(at, { from, to: this.errorType });
      this.instance.throws = this.errorType;
    }
    if (this.unset.size > 0) {
      const missing = this.cx.registry().classOf(this.f.self!.type).fields.find((d) => this.unset.has(d.name))!;
      throw new CompileError("E0703", `property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    if (this.generatorType) {
      if (!this.yielded) throw new CompileError("E0606", `this generator never yields, so what it gives can't be told; declare it as '${this.generatorName}<T>'`, (this.f.returnType ?? this.f).start, (this.f.returnType ?? this.f).end);
      const laid = (t: Type) => (this.instance.concrete ? this.cx.typing.lower(t) : t);
      this.cx.typing.rec(this.generatorType).yields = laid(this.yielded);
      this.cx.typing.rec(this.generatorType).params = this.f.params.map((p, i) => ({ name: paramName(p), type: laid(this.params[i]!) }));
      // An async generator method's frame holds its object, as an async method's future does.
      if (this.f.self && !this.f.self.constructor) this.cx.typing.rec(this.generatorType).params.unshift(receiverField(this.cx.typing, this.f.self, laid));
    }
    const gives = this.declared ?? this.inferred ?? "void";
    // A closure's signature and an async result are kept as written, so a pattern in one would
    // reach the binary.
    if (this.cx.typing.holdsPattern(gives) && (this.future || this.f.closure)) throw unsupported(`template literal pattern types in ${this.future ? "async results" : "closure results"}`, this.f.returnType ?? this.f);
    if (this.f.closure && this.params.some((t) => this.cx.typing.holdsPattern(t))) throw unsupported("template literal pattern types in closure parameters", this.f);
    if (this.future) {
      if (this.cx.typing.holdsRef(gives)) throw unsupported("async functions giving references", this.f.returnType ?? this.f);
      const laid = (t: Type) => (this.instance.concrete ? this.cx.typing.lower(t) : t);
      // An inferred result widens as a `let` does: an async `return "x"` gives a string.
      this.cx.typing.rec(this.future).gives = laid(this.f.returnType ? gives : this.cx.typing.widenLet(gives));
      this.cx.typing.rec(this.future).throws = this.errorType && laid(this.errorType);
      this.cx.typing.rec(this.future).params = this.f.params.map((p, i) => ({ name: paramName(p), type: laid(this.params[i]!) }));
      // An async method's future holds its object: borrowed, or owned under `Own<this>`.
      const self = this.f.self && !this.f.self.constructor ? receiverField(this.cx.typing, this.f.self, laid) : undefined;
      if (self) this.cx.typing.rec(this.future).params.unshift(self);
    }
    const type = this.generatorType ?? this.future ?? gives;
    if (this.f.closure && this.cx.typing.holdsRef(type)) throw unsupported("closures returning references", this.f.returnType ?? this.f.closure.value ?? this.f);
    if (!this.f.closure) this.cx.lifetimes(this.f);
    // A returned value holding references may point into any parameter, or `this`.
    const everything: Origin[] = [...this.f.params.map((_, i) => i), ...(this.f.self && !this.f.self.owned ? ["this" as const] : [])];
    const ref = this.cx.isRef(type) ? type : this.cx.typing.optionRef(type);
    const origins = ref ? this.cx.originsOf(this.f, this.params, ref) : this.cx.typing.holdsRef(type) ? this.cx.heldOrigins(this.f) ?? everything : [];
    if (gives !== "void" && !this.generatorType && !alwaysReturns(this.f.body, this.cx.broken, this.cx.continued)) {
      const at = this.f.returnType ?? this.f;
      throw new CompileError("E0601", "not all code paths return a value", at.start, at.end);
    }
    // From here on the body is read as a plain tree, its replacements in place.
    for (let i = 0; i < this.f.params.length; i++) this.f.params[i] = rebuiltParam(this.f.params[i]!, this.cx.rewrites);
    rebuiltStmts(this.f.body, this.cx.rewrites);
    checkMoves(this.f, this.instance, origins);
    // A class's own `clone()` replaces the compiler's copy, so it has to make one.
    if (this.self && this.cx.registry().classOf(this.self.type).methods.get("clone") === this.f.bodyId && (this.f.params.length > 0 || type !== this.self.type)) {
      throw new CompileError("E0213", `a 'clone' method must take no parameters and return '${this.cx.typing.show(this.self.type)}', since it replaces the compiler's copy`, this.f.start, this.f.end);
    }
    this.instance.returns = type;
    if (this.instance.concrete) this.cx.lowerTables(this.instance);
    if (this.generatorType) frameOf(this.instance, this.generatorType);
    if (this.future) frameOf(this.instance, this.future);
    this.cx.done.add(this.instance.id);
    this.cx.inProgress.delete(this.instance.id);
  }

  // Every type written from here on, in annotations, casts and closures, sees these names.
  named(p: Param, name: string) {
    return p.pattern.kind === "ident" && p.pattern.name === name;
  }
  // Only a type written inside the body sees them: one written elsewhere, a class's field or
  // another signature, is resolved here only because the body needed it.
  inSight(this: Mut<this>, name: string, at: Span): boolean {
    return writtenIn(this.f, at) && (this.scopes.some((s) => s.has(name)) || this.f.params.some((p) => this.named(p, name)) || (this.outer?.inSight(name, at) ?? false));
  }
  // A `Mut` variable is never pointed elsewhere, so assigning it doesn't stop it narrowing.
  // A capture narrows as a variable of the closure's would.
  narrowable(this: Mut<this>, l: Local) {
    return (this.captures?.has(l.localId) ? !this.assigned.has(l.name) : l.param || !l.mutable || !this.assigned.has(l.name)) || (this.cx.isRef(l.type) && this.cx.typing.rec(l.type).mutable);
  }
  // A call of a function whose result is `x is T` narrows its argument for x to T.
  predicate(this: Mut<this>, call: Extract<Expr, { kind: "call" }>) {
    const target = this.cx.arenas.instanceOf(this.calls.get(call));
    const p = target && bodyOf(target).returnType;
    if (!target || p?.kind !== "predicate" || !p.type) return undefined;
    const index = bodyOf(target).params.findIndex((x) => x.pattern.kind === "ident" && x.pattern.name === p.name) as usize;
    const type = this.cx.resolver().withScope(target.bindings, () => this.cx.resolver().resolveType(p.type!));
    return { index, type, narrows: (yes: boolean, no: boolean) => void ((yes || no) && (this.instance.predicates ??= new NodeMap()).set(call, { index, type, yes, no })) };
  }
  proves(e: Expr) {
    return guard(this.cx.tables, e, this.types, this.locals as NodeMap<Expr, LocalId>, (l) => this.narrowable(l), (call) => this.predicate(call));
  }

  // Nested functions go right after the declarations of the variables they use, as early as
  // that allows, so a call before a function's own statement still finds it, as JavaScript's
  // hoisting does. A function using another goes after it.
  hoist(list: Stmt[]) {
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
  selfCall(this: Mut<this>, e: Extract<Expr, { kind: "call" }>): { type: Type; what: string } | undefined {
    const name = (e.callee as Extract<Expr, { kind: "ident" }>).name;
    // A name the body declares itself is that, not the function.
    if (this.f.closure?.self !== name || this.scopes.some((scope) => scope.has(name))) return undefined;
    if (!this.f.returnType) throw new CompileError("E0104", `'${name}' calls itself, so its return type has to be written, as TypeScript requires, as in 'function ${name}(...): T'`, e.start, e.end);
    if (this.f.async) throw unsupported("async nested functions that call themselves", e);
    const required = this.f.params.filter((p) => !p.optional && !p.rest).length;
    if (e.args.length < required || e.args.length > this.f.params.length) throw new CompileError("E0501", `expected ${required === this.f.params.length ? required : `${required}-${this.f.params.length}`} arguments, but got ${e.args.length}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const to = this.cx.localOf(this.locals.get(this.f.params[i]!)!).type;
      this.exprs().expect(a, to);
      const t = this.exprs().value(a);
      this.exprs().coerce(a, t, to, `argument of type '${this.cx.typing.show(t)}' is not assignable to parameter of type '${this.cx.typing.show(to)}'`);
    });
    this.cx.selfCalls.add(e);
    this.calls.set(e, this.instance.id);
    if (this.errorType) this.raise(e, this.errorType, `'${name}'`);
    return { type: this.cx.resolver().resolveType(this.f.returnType), what: `'${name}'` };
  }

  // `let x: T` declares a variable that holds nothing until assigned; the moves check refuses
  // every use before that, as TypeScript's definite assignment does.
  unassigned(this: Mut<this>, s: Stmt, d: Declarator, name: string): undefined {
    if (!d.type) throw new CompileError("E0406", `'${name}' needs a type to be declared without a value, like 'let ${name}: string'; Fish doesn't work it out from later assignments`, d.start, d.end);
    const type = this.cx.typing.stored(this.cx.resolver().resolveType(d.type));
    if (this.cx.typing.lower(type) === "void") throw new CompileError("E0118", `'${name}' can't be of type 'void', which no value has`, d.start, d.end);
    if (this.cx.isInterface(type)) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since an interface describes a value of some concrete type`, d.start, d.end);
    const r = this.cx.recOf(type);
    if (r?.kind === "function" && r.generic) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since a generic function type describes the generic function it holds`, d.start, d.end);
    this.declare(name, type, true, false, s);
    return undefined;
  }

  // `[a, b] = [b, a]`, in JavaScript's order: the right side is evaluated whole, into fresh
  // variables, then each target is assigned its part in turn, a default taken at its own
  // target, after the targets before it. An array or object literal on the right is taken
  // part by part, each part typed as its target is, so a swap of values that move needs no
  // array and a literal meets its target's type.
  destructuring(this: Mut<this>, e: Extract<Expr, { kind: "destructure" }>): Stmt[] {
    // Every part is read first, then every target written, so a target can't change what a
    // later part reads, as in '({ a: o.b, b: o.a } = o)'.
    const reads: Stmt[] = [];
    const writes: Stmt[] = [];
    const fresh = () => `destructured ${this.cx.counts.destructures++}`;
    const ident = (name: string, at: Span): Expr => ({ id: nextId(this.cx.ids), kind: "ident", name, start: at.start, end: at.end });
    const declare = (target: Pattern, init: Expr, at: Span, typedAs?: Expr): Stmt => {
      const s: Stmt = { id: nextId(this.cx.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.ids), target, type: undefined, init, start: at.start, end: at.end }], start: at.start, end: at.end };
      if (typedAs) this.cx.destructuredParts.set(s, typedAs);
      return s;
    };
    const targetOf = (p: Pattern): Expr | undefined => (p.kind === "ident" ? ident(p.name, p) : p.kind === "expr" ? p.expr : p.kind === "default" ? targetOf(p.target) : undefined);
    // Writes what `part` reads to a target, its default taken when the part is an empty Option.
    const write = (p: Pattern, part: Expr) => {
      if (p.kind === "default") {
        const or: Expr = { id: nextId(this.cx.ids), kind: "binary", op: "??", left: part, right: p.value, start: p.start, end: p.end };
        this.cx.unusedDefaults.add(or);
        return write(p.target, or);
      }
      if (p.kind === "ident" || p.kind === "expr") return void writes.push({ id: nextId(this.cx.ids), kind: "expr", expr: { id: nextId(this.cx.ids), kind: "assign", op: "=", target: targetOf(p)!, value: part, start: p.start, end: p.end }, start: p.start, end: p.end });
      // A nested pattern takes apart what the part holds, from its fresh variable.
      from(p, part);
    };
    // A place is read where it is, piece by piece, so only the pieces named move out of it,
    // as a declaration's destructuring does; anything else is held in a fresh variable first.
    // A chain reading a getter isn't one: its getter runs once, into a fresh variable.
    const place = (v: Expr): boolean => v.kind === "ident" || v.kind === "this" || (v.kind === "member" && !v.optional && !this.cx.getterNames.has(v.name) && place(v.object));
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
          reads.push(declare({ id: nextId(this.cx.ids), kind: "ident", name, start: x.start, end: x.end }, x, x, q && targetOf(q)));
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
        if (p.rest) write(p.rest, { id: nextId(this.cx.ids), kind: "array", elements: parts.slice(p.elements.length).map((x) => x.read!), start: value.start, end: value.end });
        return;
      }
      if (p.kind === "object" && !p.rest && value.kind === "object" && value.props.every((x) => x.kind === "property" && typeof x.key === "string") && p.props.every((x) => typeof x.key === "string")) {
        const parts = new Map(value.props.map((x) => {
          const prop = x as Extract<ObjectProp, { kind: "property" }>;
          const name = fresh();
          const q = p.props.find((y) => y.key === prop.key)?.value;
          reads.push(declare({ id: nextId(this.cx.ids), kind: "ident", name, start: prop.start, end: prop.end }, prop.value, prop, q && targetOf(q)));
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
        reads.push(declare({ id: nextId(this.cx.ids), kind: "ident", name, start: value.start, end: value.end }, value, value));
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
          return { id: nextId(this.cx.ids), kind: "default", target: { id: nextId(this.cx.ids), kind: "ident", name, ...at }, value: { id: nextId(this.cx.ids), kind: "null", ...at }, ...at };
        }
        if (q.kind === "ident" || q.kind === "expr") {
          const name = fresh();
          leaves.push([q, name]);
          return { id: nextId(this.cx.ids), kind: "ident", name, ...at };
        }
        if (q.kind === "array") return { ...q, id: nextId(this.cx.ids), elements: q.elements.map((x) => x && shape(x)), rest: q.rest && shape(q.rest) };
        if (q.kind === "object") return { ...q, id: nextId(this.cx.ids), props: q.props.map((x) => ({ ...x, id: nextId(this.cx.ids), value: shape(x.value) })), rest: q.rest && shape(q.rest) };
        throw new CompileError("E0003", "this can't be a destructuring target; assign to a variable, a field or an element", q.start, q.end);
      };
      if (p.kind === "array") {
        p.elements.forEach((q, i) => q && reads.push(declare({ id: nextId(this.cx.ids), kind: "array", elements: [...Array<undefined>(i).fill(undefined), shape(q)], rest: undefined, ...span }, whole, q)));
        if (p.rest) reads.push(declare({ id: nextId(this.cx.ids), kind: "array", elements: Array<undefined>(p.elements.length).fill(undefined), rest: shape(p.rest), ...span }, whole, p.rest));
      } else if (p.rest) {
        // An object's rest is read with every property it leaves out, in one declaration.
        reads.push(declare(shape(p), whole, p));
      } else for (const prop of p.props) reads.push(declare({ id: nextId(this.cx.ids), kind: "object", props: [{ ...prop, id: nextId(this.cx.ids), value: shape(prop.value) }], rest: undefined, ...span }, whole, prop.value));
      for (const [q, name] of leaves) write(q, ident(name, q));
    };
    from(e.pattern, e.value);
    return [...reads, ...writes];
  }

  // The type a destructured part's fresh variable takes: its target's, as declared.
  partType(this: Mut<this>, s: Stmt): Type | undefined {
    const target = this.cx.destructuredParts.get(s);
    if (!target) return undefined;
    if (target.kind === "ident") return this.lookup(target.name)?.type;
    // A field of 'this' has its declared type, which a constructor may not read yet.
    if (target.kind === "member" && target.object.kind === "this" && this.f.self) return this.cx.typing.allFields(this.f.self.type as ClassType).find((x) => x.name === target.name)?.type;
    // A target with only a setter can't be read for its type; its part keeps its own.
    try {
      const t = this.exprs().value(renumber("expr", structuredClone(target), () => nextId(this.cx.ids)));
      return this.cx.recOf(t)?.kind === "ref" ? undefined : t;
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // `let a = 1, b = a` is a declaration per name, in order, each seeing those before it. A
  // `for` head's go in a block around the loop, which scopes them as the head does.
  separate(this: Mut<this>, list: Stmt[]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const s = this.cx.rewrites.current(list[i]!);
      if (s.kind === "expr" && s.expr.kind === "destructure") {
        list.splice(i, 1, ...this.destructuring(s.expr));
        continue;
      }
      if (s.kind === "let" && s.declarations.length > 1) {
        list.splice(i, 1, ...s.declarations.map((d, n): Stmt => ({ ...s, id: nextId(this.cx.ids), declarations: [d], start: n === 0 ? s.start : d.start, end: d.end })));
        continue;
      }
      let loop = s;
      while (loop.kind === "labeled") loop = this.cx.rewrites.current(loop.body);
      if (loop.kind === "for" && loop.init?.kind === "let" && loop.init.declarations.length > 1) {
        list[i] = { id: nextId(this.cx.ids), kind: "block", body: [loop.init, s], start: s.start, end: s.end };
        this.cx.rewrites.replace(loop, { ...loop, init: undefined });
      }
    }
  }

  // Checks a list of statements in order. What an `if` that leaves early proves holds for
  // the statements after it.
  statements(this: Mut<this>, list: Stmt[], each: (s: Stmt, check: (s: Stmt) => Facts | undefined) => Facts | undefined = (s: Stmt, check: (s: Stmt) => Facts | undefined) => check(s)) {
    this.separate(list);
    this.hoist(list);
    const before = this.facts.length;
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      this.siblings = { list, at: i };
      const mark = this.changed.length;
      const after = each(s, (x) => this.statement(x));
      if (after) this.facts.push(this.current(after, mark));
    }
    this.facts.length = before;
  }

  // `const { a, b: c = 1, ...rest } = v` and `const [x, , y = 0] = v`: the value goes to a
  // variable named for the pattern, and each name becomes a declaration of its part after it,
  // in the list being checked, so the names own the parts as Rust's `let` does. A nested
  // pattern is a declaration of its own, destructured in turn. A default is taken when its
  // part is null.
  destructured(this: Mut<this>, s: Extract<Stmt, { kind: "let" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>, place: { list: Stmt[]; at: usize } | undefined): undefined {
    if (!place || this.cx.rewrites.current(place.list[place.at]!) !== s) throw unsupported("destructuring patterns here", pattern);
    // A place is read part by part where it is, so only the parts named move out of it, as in
    // Rust; any other value goes to a variable named for the pattern, as messages show it.
    if (!d.init) throw new CompileError("E0406", "a destructuring declaration needs its value where it is declared, as TypeScript requires", d.start, d.end);
    const init = d.init;
    const read = (e: Expr): boolean => e.kind === "ident" || e.kind === "this" || ((e.kind === "member" || e.kind === "index") && !e.optional && read(e.object));
    // A getter along the path runs each time the path is read, so its result is kept once.
    const computed = (e: Expr): boolean => (e.kind === "member" && this.calls.has(e)) || ((e.kind === "member" || e.kind === "index") && computed(e.object));
    let type = read(init) && !d.type ? this.exprs().value(init) : undefined;
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
        const usize: TypeNode = { id: nextId(this.cx.ids), kind: "ref", name: "usize", args: [], ...at };
        hoisted.unshift({ id: nextId(this.cx.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.ids), target: { id: nextId(this.cx.ids), kind: "ident", name, ...at }, type: usize, init: e.index, ...at }], ...at });
      }
      const copy = (e: Expr, at: Span): Expr => {
        if (e.kind === "member") return { ...e, id: nextId(this.cx.ids), object: copy(e.object, at), start: at.start, end: at.end };
        if (e.kind !== "index") return { ...e, id: nextId(this.cx.ids), start: at.start, end: at.end };
        const name = indexes.get(e);
        const index: Expr = name ? { id: nextId(this.cx.ids), kind: "ident", name, start: e.index.start, end: e.index.end } : { ...e.index, id: nextId(this.cx.ids) };
        return { ...e, id: nextId(this.cx.ids), object: copy(e.object, at), index, start: at.start, end: at.end };
      };
      from = (at) => copy(init, at);
      this.cx.rewrites.replace(s, { id: 0, kind: "empty", start: s.start, end: s.end });
    } else {
      const held = patternText(pattern);
      this.cx.rewrites.replace(d, { ...d, target: { id: nextId(this.cx.ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
      this.statement(s);
      type = this.cx.localOf(this.locals.get(s)!).type;
      from = (at) => ({ id: nextId(this.cx.ids), kind: "ident", name: held, start: at.start, end: at.end });
    }
    const destructuring: Type = type!;
    // A top-level const is read where it lives rather than lent.
    let root = init;
    while (root.kind === "member" || root.kind === "index") root = root.object;
    const global = inPlace && root.kind === "ident" && !this.locals.has(root);
    const borrowed = this.cx.isRef(destructuring) && !global;
    const lowered = this.cx.typing.lower(this.cx.isRef(destructuring) ? this.cx.typing.rec(destructuring).to : destructuring);
    const l = this.cx.recOf(lowered);
    // An object-typed parameter stands for any type with its fields, which its bound names.
    const whole = l?.kind === "param" && l.bound && this.cx.typing.rec(l.bound).kind === "object" ? l.bound : lowered;
    const w = this.cx.recOf(whole);
    const parts: [Pattern, Expr, Type][] = [];
    // A part with a default: what the part holds, or the default when it is null.
    const part = (target: Pattern, read: Expr, t: Type) => {
      if (target.kind !== "default") return parts.push([target, read, t]);
      const u = this.cx.recOf(t);
      const empty = t === "null" || (u?.kind === "union" && u.members.includes("null"));
      parts.push([target.target, empty ? { id: nextId(this.cx.ids), kind: "binary", op: "??", left: read, right: target.value, start: target.start, end: target.end } : read, t]);
    };
    if (pattern.kind === "object") {
      if (w?.kind !== "object" && w?.kind !== "class") {
        throw new CompileError("E0003", `'{ ... }' destructures an object or an instance, not '${this.cx.typing.show(destructuring)}'`, pattern.start, pattern.end);
      }
      const taken = new Set<string>();
      for (const p of pattern.props) {
        if (typeof p.key !== "string") throw unsupported("computed keys in destructuring patterns", p);
        const f = this.cx.typing.field(whole as ClassType | ObjectType, p.key);
        if (!f) throw new CompileError("E0502", `property '${p.key}' does not exist on type '${this.cx.typing.show(whole)}'`, p.start, p.end);
        taken.add(p.key);
        part(p.value, { id: nextId(this.cx.ids), kind: "member", object: from(p), name: p.key, optional: false, start: p.start, end: p.end }, f.type);
      }
      // The rest is an object of the fields the pattern didn't name, taken over.
      if (pattern.rest) {
        const fields = w.kind === "class" ? this.cx.typing.allFields(whole as ClassType) : w.fields;
        const props = fields.filter((f) => !taken.has(f.name) && (f.access ?? "public") === "public").map((f): ObjectProp => ({ id: nextId(this.cx.ids), kind: "property", key: f.name, value: { id: nextId(this.cx.ids), kind: "member", object: from(pattern.rest!), name: f.name, optional: false, start: pattern.rest!.start, end: pattern.rest!.end }, start: pattern.rest!.start, end: pattern.rest!.end }));
        parts.push([pattern.rest, { id: nextId(this.cx.ids), kind: "object", props, start: pattern.rest.start, end: pattern.rest.end }, whole]);
      }
    } else if (this.cx.typing.isTuple(whole)) {
      const elements = this.cx.typing.elementsOf(whole as ObjectType);
      const many = this.cx.typing.rec(whole as ObjectType).rest;
      if (pattern.elements.length > elements.length && many === undefined) throw new CompileError("E0117", `tuple type '${this.cx.typing.show(whole)}' of length ${elements.length} has no element at index ${elements.length}`, pattern.start, pattern.end);
      // A rest tuple's `...rest` takes its array where its fixed elements end, or a copy of the
      // part after the names taken from it, as an array pattern's rest is, when they copy.
      const later = pattern.elements.length - elements.length;
      if (pattern.rest && (many === undefined || later < 0 || (later > 0 && !this.cx.typing.isCopy(many)))) throw unsupported(many === undefined ? "rest elements in tuple patterns" : later < 0 ? "rest patterns that don't start where a tuple's rest elements do" : "rest patterns after names taken from rest elements whose type doesn't copy", pattern.rest);
      pattern.elements.forEach((p, i) => {
        if (!p) return;
        const at = { start: p.start, end: p.end };
        // With a default, an element past the fixed ones may be missing, so it is read as
        // `.at(i)` on the rest, which an array pattern's default reads too.
        if (i >= elements.length && p.kind === "default") {
          // Read with `.at(i)`, a value that doesn't copy would be copied where `t[i]` moves it.
          if (!this.cx.typing.isCopy(many!)) throw new CompileError("E0117", `a default past a tuple's fixed elements would take a '${this.cx.typing.show(many!)}' out of the tuple's rest when it is there, leaving a hole; destructure without the default, or index it and clone`, p.start, p.end);
          const array: Expr = { id: nextId(this.cx.ids), kind: "member", object: from(p), name: "...", optional: false, ...at };
          this.cx.restStarts.set(array, elements.length);
          const read: Expr = { id: nextId(this.cx.ids), kind: "call", callee: { id: nextId(this.cx.ids), kind: "member", object: array, name: "at", optional: false, ...at }, args: [{ id: nextId(this.cx.ids), kind: "int", value: BigInt(i - elements.length), ...at }], typeArgs: [], optional: false, ...at };
          return part(p, read, this.cx.typing.unionType([many!, "null"]));
        }
        part(p, { id: nextId(this.cx.ids), kind: "index", object: from(p), index: { id: nextId(this.cx.ids), kind: "int", value: BigInt(i), ...at }, optional: false, ...at }, elements[i] ?? many!);
      });
      if (pattern.rest) {
        const at = { start: pattern.rest.start, end: pattern.rest.end };
        const array: Expr = { id: nextId(this.cx.ids), kind: "member", object: from(pattern.rest), name: "...", optional: false, ...at };
        this.cx.restStarts.set(array, elements.length);
        const taken: Expr = later === 0 ? array : { id: nextId(this.cx.ids), kind: "call", callee: { id: nextId(this.cx.ids), kind: "member", object: array, name: "slice", optional: false, ...at }, args: [{ id: nextId(this.cx.ids), kind: "int", value: BigInt(later), ...at }], typeArgs: [], optional: false, ...at };
        part(pattern.rest, taken, this.cx.typing.arrayType(many!));
      }
    } else if (w?.kind === "array") {
      // An array's elements are read as `xs[i]`, which a value that moves would leave a hole in.
      if (!this.cx.typing.isCopy(w.element)) throw new CompileError("E0202", `an array pattern reads each element as 'xs[i]', and a '${this.cx.typing.show(w.element)}' would be moved out of the array, leaving a hole; index it and clone, or loop over it`, pattern.start, pattern.end);
      pattern.elements.forEach((p, i) => {
        if (!p) return;
        const at = { start: p.start, end: p.end };
        const index: Expr = { id: nextId(this.cx.ids), kind: "int", value: BigInt(i), ...at };
        // With a default, a missing element is the default rather than a panic.
        const read: Expr = p.kind === "default"
          ? { id: nextId(this.cx.ids), kind: "binary", op: "??", left: { id: nextId(this.cx.ids), kind: "call", callee: { id: nextId(this.cx.ids), kind: "member", object: from(p), name: "at", optional: false, ...at }, args: [index], typeArgs: [], optional: false, ...at }, right: p.value, ...at }
          : { id: nextId(this.cx.ids), kind: "index", object: from(p), index, optional: false, ...at };
        parts.push([p.kind === "default" ? p.target : p, read, w.element]);
      });
      if (pattern.rest) {
        const at = { start: pattern.rest.start, end: pattern.rest.end };
        const slice: Expr = { id: nextId(this.cx.ids), kind: "call", callee: { id: nextId(this.cx.ids), kind: "member", object: from(pattern.rest), name: "slice", optional: false, ...at }, args: [{ id: nextId(this.cx.ids), kind: "int", value: BigInt(pattern.elements.length), ...at }], typeArgs: [], optional: false, ...at };
        parts.push([pattern.rest, slice, whole]);
      }
    } else throw new CompileError("E0003", `'[ ... ]' destructures a tuple, like '[i64, string]', or an array, not '${this.cx.typing.show(destructuring)}'`, pattern.start, pattern.end);
    const lets: Stmt[] = parts.map(([target, init]): Stmt => {
      const at = { start: target.start, end: target.end };
      const declarator: Declarator = { id: nextId(this.cx.ids), target, type: undefined, init, ...at };
      // A part of a borrowed value is borrowed too, as a loop's pattern's parts are; an array's
      // parts copy.
      if (borrowed && target.kind === "ident" && (init.kind === "member" || (init.kind === "index" && this.cx.typing.isTuple(whole)))) this.cx.loopParts.add(declarator);
      return { id: nextId(this.cx.ids), kind: "let", keyword: s.keyword, declarations: [declarator], ...at };
    });
    // A parameter's parts come before a derived constructor's `super(...)`, as its whole did.
    if (this.cx.prologues.has(s)) for (const l of [...hoisted, ...lets]) this.cx.prologues.add(l);
    place.list.splice(place.at + 1, 0, ...hoisted, ...lets);
    return undefined;
  }

  // `for (const [k, v] of pairs)` and `for (const { x, y } of points)`: the element goes to a
  // variable named for the pattern, and each name becomes a `const` of its part at the top of
  // the body. A part of a borrowed element is borrowed, or copied when it copies.
  loopPattern(this: Mut<this>, s: Extract<Stmt, { kind: "forIn" | "forOf" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>) {
    if (pattern.rest) throw unsupported("rest patterns", pattern.rest);
    const named = (p: Pattern | undefined): Extract<Pattern, { kind: "ident" }> | undefined => {
      if (p !== undefined && p.kind !== "ident") throw unsupported(p.kind === "default" ? "defaults in destructuring patterns" : "nested destructuring patterns", p);
      return p;
    };
    const parts: [Extract<Pattern, { kind: "ident" }>, (from: Expr) => Expr][] = pattern.kind === "array"
      ? pattern.elements.flatMap((p, i) => {
        const n = named(p);
        return n ? [[n, (from: Expr): Expr => ({ id: nextId(this.cx.ids), kind: "index", object: from, index: { id: nextId(this.cx.ids), kind: "int", value: BigInt(i), start: n.start, end: n.end }, optional: false, start: n.start, end: n.end })]] : [];
      })
      : pattern.props.map((p) => {
        if (typeof p.key !== "string") throw unsupported("computed keys in destructuring patterns", p);
        const key = p.key;
        return [named(p.value)!, (from: Expr): Expr => ({ id: nextId(this.cx.ids), kind: "member", object: from, name: key, optional: false, start: p.start, end: p.end })];
      });
    const held = pattern.kind === "array" ? `[${pattern.elements.map((p) => (p?.kind === "ident" ? p.name : "")).join(", ")}]` : `{ ${parts.map(([n]) => n.name).join(", ")} }`;
    const lets: Stmt[] = parts.map(([n, part]) => {
      const at = { start: n.start, end: n.end };
      const declarator: Declarator = { id: nextId(this.cx.ids), target: n, type: undefined, init: part({ id: nextId(this.cx.ids), kind: "ident", name: held, ...at }), ...at };
      this.cx.loopParts.add(declarator);
      return { id: nextId(this.cx.ids), kind: "let", keyword: (s.left as Extract<Stmt, { kind: "let" }>).keyword, declarations: [declarator], ...at };
    });
    const left = s.left as Extract<Stmt, { kind: "let" }>;
    const target: Declarator = this.cx.rewrites.replace(d, { ...d, target: { id: nextId(this.cx.ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
    // The loop's own body is a block inside the parts' scope, so it may declare their names.
    const body: Stmt = { id: nextId(this.cx.ids), kind: "block", body: s.body, start: s.body[0]?.start ?? s.end, end: s.end };
    return this.cx.rewrites.replace(s, { ...s, left: this.cx.rewrites.replace(left, { ...left, declarations: [target] }), body: [...lets, body] });
  }

  // A name a loop's pattern binds: its part of the element, borrowed when the element is.
  loopPart(this: Mut<this>, s: Extract<Stmt, { kind: "let" }>, d: Declarator): undefined {
    const init = d.init!;
    const object = init.kind === "index" || init.kind === "member" ? init.object : init;
    const whole = this.exprs().value(object);
    const element = this.cx.isRef(whole) ? this.cx.typing.rec(whole).to : whole;
    if (init.kind === "index" && !this.cx.typing.isTuple(element)) throw new CompileError("E0801", `only tuples, like '[i64, string]', can be destructured so far, not '${this.cx.typing.show(element)}'`, d.start, d.end);
    const type = this.exprs().value(init);
    const name = (d.target as Extract<Pattern, { kind: "ident" }>).name;
    // A `let` part may change, or be pointed elsewhere when it is borrowed, as a `let` loop
    // variable may.
    if (this.cx.isRef(whole) && !this.cx.typing.isCopy(type)) {
      const lent = this.cx.typing.refType(type, false);
      this.exprs().coerce(init, type, lent, "");
      this.declare(name, lent, s.keyword === "let", false, s);
    } else this.declare(name, type, s.keyword === "let", false, s);
    return undefined;
  }

  // A whole value written through a narrowed `Mut` may be another member, so from here to the
  // end of each narrowing scope it is read as declared. A loop inside such a scope could come
  // back to reads already checked as narrowed.
  rewritten(this: Mut<this>, l: Local, at: Expr) {
    const outside = this.captures?.get(l.localId);
    if (outside && outside !== "this" && this.outer!.narrowed(this.cx.localOf(outside))) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a closure while a check outside it narrows it; assign its fields instead`, at.start, at.end);
    }
    const from = this.facts.findIndex((f) => f.has(l.localId));
    if (from < 0) return;
    // Inside a larger expression, a condition could still prove the member it had.
    if (at !== this.whole) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a larger expression while a check narrows it; assign it as a statement of its own`, at.start, at.end);
    }
    this.changed.push(l.localId);
    if (this.targets.some((t) => t.kind === "loop" && t.facts! > from)) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a loop here: a check outside the loop narrowed it; assign its fields instead, or check it inside the loop`, at.start, at.end);
    }
    for (let i = from; i < this.facts.length; i++) this.facts[i] = new Map(this.facts[i]).set(l.localId, l.type);
  }

  // Facts proven before a statement that carry past it, less any it gave another member.
  current(proven: Facts, mark: usize): Facts {
    const gone = this.changed.slice(mark);
    return gone.length === 0 ? proven : new Map([...proven].filter(([l]) => !gone.includes(l)));
  }

  assume<T>(this: Mut<this>, proven: Facts, check: () => T): T {
    this.facts.push(proven);
    try {
      return check();
    } finally {
      this.facts.pop();
    }
  }

  // An arrow function: its own type, and its body checked here, where it is written.
  closure(this: Mut<this>, e: Arrow, expected?: FunctionType, unsafe = false, owning = false): ClosureType {
    // An async arrow's future usually outlives the call making it, so it owns its captures.
    owning ||= e.async;
    const value = Array.isArray(e.body) ? undefined : e.body;
    const body = this.cx.arenas.addBody({
      id: nextId(this.cx.ids), name: this.f.name, params: e.params, returnType: e.returnType, ...(e.throws && { throws: e.throws }), start: e.start, end: e.end, async: e.async || undefined, closure: { value, parent: this.instance.id, expected, move: e.move || owning, unsafe, self: this.cx.nestedFunctions.get(e), made: this.cx.madeArrows.has(e) || undefined },
      body: value ? [{ id: nextId(this.cx.ids), kind: "return", value, start: value.start, end: value.end }] : (e.body as Stmt[]),
    });
    const inner = this.cx.arenas.addInstance({
      tables: this.cx.tables, body: body.bodyId, symbol: `${this.instance.symbol}.closure${this.cx.closures.filter((c) => bodyOf(this.cx.arenas.instanceOf(c)).closure!.parent === this.instance.id).length}`,
      bindings: this.instance.bindings, concrete: this.instance.concrete, depth: this.instance.depth, returns: "void",
      types: new NodeMap(), locals: new NodeMap(), calls: new NodeMap(), setters: new NodeMap(), coercions: new NodeMap(), jumps: new NodeMap(), borrowsFrom: new NodeMap(), raises: new NodeMap(), caught: new NodeMap(), consumes: new NodeSet(), patterns: new NodeMap(), copiesOut: new NodeSet(),
    });
    inner.captures = new Map();
    inner.captureUses = new Map();
    inner.changed = new Set();
    inner.moved = new Set();
    this.cx.closures.push(inner.id);
    this.cx.resolver().withSight(this, () => this.cx.checkInstance(inner, this));
    const sup = [...inner.types.keys()].find((u) => u.kind === "super");
    if (sup) throw unsupported("'super' in closures", sup);
    const captured = [...inner.captures].map(([alias, from]): [Local, Local | "this"] => [this.cx.localOf(alias), from === "this" ? from : this.cx.localOf(from)]);
    const moved = [...inner.moved].map((id) => this.cx.localOf(id));
    // A closure owning what it captures holds a nested function it uses as made here, so it
    // borrows what that function uses, as this body has it.
    if (e.async || bodyOf(inner).closure!.move) {
      for (const [, from] of captured) {
        if (from === "this" || !this.nestedLocal(from)) continue;
        const of = this.cx.closureBodies.get(this.cx.typing.lower(from.type) as ClosureType)!;
        const nested = this.cx.arenas.instanceOf(of);
        const env = [...nested.captures!].map(([alias, x]) => {
          const mine = this.reach(this.cx.localOf(x as LocalId), e);
          if (nested.changed?.has(alias)) this.exprs().changesLocal(mine, "", "change", e, false);
          return mine.localId;
        });
        (this.instance.made ??= new NodeMap()).set(e, [...(this.instance.made.get(e) ?? []), { of, env }]);
      }
    }
    // A nested function runs whenever it is called, so it can't take over what it uses.
    const nested = this.cx.nestedFunctions.get(e);
    if (nested !== undefined) {
      const self = captured.find(([, from]) => from === "this");
      if (self) throw new CompileError("E0708", `'this' inside the nested function '${nested}' isn't the enclosing method's; pass what it needs as a parameter`, (inner.captureUses.get(self[0].localId) ?? e).start, (inner.captureUses.get(self[0].localId) ?? e).end);
      // An async one takes its own copy of what it uses when it is made, which a later change
      // to a `let` wouldn't reach, as it would in JavaScript.
      const changing = e.async ? captured.find(([, from]) => from !== "this" && from.mutable) : undefined;
      if (changing) throw new CompileError("E0210", `the async nested function '${nested}' takes its own copy of '${changing[0].name}' when it is made, so a later change to it wouldn't reach the function; pass '${changing[0].name}' as a parameter, or make it a 'const'`, (inner.captureUses.get(changing[0].localId) ?? e).start, (inner.captureUses.get(changing[0].localId) ?? e).end);
      const first = moved[0];
      if (first) throw new CompileError("E0202", `the nested function '${nested}' moves '${first.name}' out of the variables it uses, which a second call couldn't do again; take it as a parameter instead`, (inner.captureUses.get(first.localId) ?? e).start, (inner.captureUses.get(first.localId) ?? e).end);
    }
    // A shared value's `update` callback lends its parameter only through its fields.
    if (this.f.closure?.expected && this.cx.typing.sharedCallbacks.has(this.f.closure.expected)) {
      for (const [alias, from] of captured) {
        const ref = from === "this" ? undefined : this.cx.recOf(from.type);
        const held = from === "this" ? undefined : ref?.kind === "ref" ? ref.to : from.type;
        if (from !== "this" && from.param && held !== undefined && this.cx.typing.interiorMutable(held)) {
          const at = inner.captureUses.get(alias.localId) ?? e;
          throw new CompileError("E0304", `a closure inside a shared value's 'update' can't capture '${alias.name}': other tasks borrow its interior-mutable parts without the lock`, at.start, at.end);
        }
      }
    }
    // A closure holds what it moves, or everything under `move`, and borrows the rest; `this`
    // is a reference either way.
    // In an instance, what a type parameter stands for is laid out.
    const laid = (t: Type) => (inner.concrete ? this.cx.typing.lower(t) : t);
    const fields = captured.map(([alias, from]) => ({
      name: alias.name,
      type: laid(from === "this" ? this.cx.typing.refType(this.self!.type, inner.changed!.has(alias.localId)) : e.move || owning || inner.moved!.has(alias.localId) ? from.type : this.cx.typing.refType(from.type, inner.changed!.has(alias.localId))),
    }));
    // Calling an async arrow gives its future, whose frame holds a copy of what it captured.
    // An async arrow's call only makes its future, which carries what it throws.
    const throws = inner.future ? undefined : inner.throws && laid(inner.throws);
    const type = madeBy(this.cx.typing.closureType(e.params.map((p) => writtenName(this.cx.tables, p)), e.params.map((p) => this.cx.localOf(inner.locals.get(p)!).type), inner.future ?? inner.returns, fields, moved[0]?.name, inner.concrete, throws), inner);
    // One throwing what the function type it is given as doesn't take can't be given as it.
    const given = expected && this.cx.typing.rec(expected);
    if (expected && given && throws && e.throws && !this.cx.typing.openThrows.has(expected) && !(given.throws && this.cx.typing.fits(throws, given.throws))) {
      const takes = given.throws ? `which throws '${this.cx.typing.show(given.throws)}'` : "which throws nothing";
      throw new CompileError("E0602", `this closure throws '${this.cx.typing.show(throws)}', but it is given as '${this.cx.typing.show(expected)}', ${takes}; catch it inside the closure with try/catch`, e.throws.start, e.throws.end);
    }
    // An async one's future throws, which a function type giving a Promise can't say yet.
    const failing = inner.future && this.cx.typing.rec(inner.future).throws;
    if (expected && given && failing && !this.cx.typing.openThrows.has(expected) && this.cx.typing.promiseElement(given.returns) !== undefined) {
      const at = e.throws ?? [...inner.raises.keys()][0] ?? e;
      throw new CompileError("E0602", `this async closure throws '${this.cx.typing.show(failing)}', but it is given as '${this.cx.typing.show(expected)}', whose Promise throws nothing; catch it inside the closure with try/catch`, at.start, at.end);
    }
    // Each call's future works on its own copy of the captures, so a change would be lost.
    const changed = e.async && inner.changed.size > 0 ? this.cx.localOf([...inner.changed][0]!) : undefined;
    if (changed) {
      const at = inner.captureUses.get(changed.localId) ?? e;
      if (this.cx.timerWrappers.has(e)) throw new CompileError("E0210", `a timer's function owns what it captures, so changing '${changed.name}' would change only its own copy; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
      throw new CompileError("E0210", `this async arrow changes '${changed.name}', which it captured, but each call's future works on its own copy, so the change would be lost; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
    }
    // Its future holds the captures as it holds parameters, for what crosses threads.
    if (inner.future) {
      this.cx.typing.rec(inner.future).frame[1] = { name: "env", type };
      this.cx.typing.rec(inner.future).params = [{ name: "env", type }, ...this.cx.typing.rec(inner.future).params];
    }
    inner.closure = type;
    this.calls.set(e, inner.id);
    this.cx.closureBodies.set(type, inner.id);
    return type;
  }

  // A parameter's type is written, or else the one the function type the closure meets gives.
  closureParam(this: Mut<this>, p: Param, i: usize, expected: FunctionType | undefined): Type {
    const takes = expected && this.cx.typing.rec(expected).params;
    const given = takes?.[i];
    if (expected && takes && !given && !p.type) {
      const n = takes.length;
      throw new CompileError("E0506", `'${this.cx.typing.show(expected)}' passes ${n} argument${n === 1 ? "" : "s"}, so this closure can't take '${paramName(p)}'`, p.start, p.end);
    }
    if (p.comptime) throw unsupported("comptime parameters on closures", p);
    if (p.rest) throw unsupported("rest parameters on arrow functions", p);
    const plain = !p.rest && !p.optional && !p.default && p.modifiers.length === 0 && p.decorators.length === 0 && paramName(p) !== "this";
    // A declared function's parameter, named as a value, is typed where the function is declared.
    // A closure is one compiled function, so a function it takes is a stored callable.
    const written = this.cx.presetParams.get(p) ?? (!p.type && given && plain ? given : this.cx.resolver().paramType(p));
    const w = this.cx.recOf(written);
    const type = w?.kind === "function" && !w.generic ? this.cx.typing.stored(written) : written;
    const to = this.cx.isRef(type) ? this.cx.typing.rec(type).to : type;
    if (this.cx.recOf(to)?.kind === "interface") throw unsupported("closure parameters of interface types", p);
    return type;
  }

  statement(this: Mut<this>, written: Stmt): Facts | undefined {
    const s = this.cx.rewrites.current(written);
    const declaration = unsupportedDeclaration(s);
    if (declaration) throw declaration;
    switch (s.kind) {
      case "expr":
        this.whole = s.expr;
        // `yield* g` gives each value `g` gives, as `for (const % of g) yield %;` does.
        if (s.expr.kind === "yield" && s.expr.delegate && this.generatorType && s.expr.value) {
          const { value, start, end } = s.expr;
          const topic = { id: nextId(this.cx.ids), kind: "ident" as const, name: "%", start, end };
          const each: Stmt = { id: nextId(this.cx.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.ids), target: topic, type: undefined, init: undefined, start, end }], start, end };
          const body: Stmt[] = [{ id: nextId(this.cx.ids), kind: "expr", expr: { id: nextId(this.cx.ids), kind: "yield", value: { ...topic, id: nextId(this.cx.ids) }, delegate: false, start, end }, start, end }];
          return this.statement(this.cx.rewrites.replace(s, { id: 0, kind: "forOf", await: false, left: each, right: value, body, start: s.start, end: s.end }));
        }
        if (s.expr.kind === "yield") {
          this.yielding(s.expr);
          return;
        }
        if (isAwait(s.expr)) this.awaiting(s.expr);
        if (s.expr.kind === "assign" && s.expr.value.kind === "yield") {
          // The target is found after the generator resumes, so it must be one that can be.
          let root: Expr = s.expr.target;
          while (root.kind === "member") root = root.object;
          if (s.expr.op !== "=" || (root.kind !== "ident" && root.kind !== "this")) {
            throw new CompileError("E0801", "'yield' can only be assigned with '=' to a variable or a field for now; yield into a 'const' first, then use it", s.expr.start, s.expr.end);
          }
          this.yieldable.add(s.expr.value);
        }
        if (s.expr.kind === "assign" && isAwait(s.expr.value)) {
          // The target is found after the await resumes, so it must be one that can be.
          let root: Expr = s.expr.target;
          while (root.kind === "member") root = root.object;
          if (s.expr.op !== "=" || (root.kind !== "ident" && root.kind !== "this")) {
            throw new CompileError("E0801", "'await' can only be assigned with '=' to a variable or a field for now; await into a 'const' first, then use it", s.expr.start, s.expr.end);
          }
          this.awaiting(s.expr.value);
        }
        this.exprs().effect(s.expr);
        // A promise runs only when awaited, so one made and dropped would silently do nothing.
        const pausing = s.expr.kind === "call" && s.expr.callee.kind === "ident" && ["yieldNow", "sleep"].includes(s.expr.callee.name) && !this.cx.byName.has(s.expr.callee.name);
        const made = pausing ? YIELD_NOW : this.types.get(s.expr) ?? this.cx.arenas.instanceOf(this.calls.get(s.expr))?.returns;
        const r = this.cx.recOf(made);
        const boxed = r?.kind === "dyn" && this.cx.typing.promiseElement(r.of) !== undefined;
        if (s.expr.kind !== "assign" && s.expr.kind !== "destructure" && (r?.kind === "future" || boxed)) {
          // The prelude's call of a promise's executor: the executor written gives a Promise.
          const callee = s.start >= STD_BASE && s.expr.kind === "call" ? this.types.get(s.expr.callee) : undefined;
          const executor = callee === undefined ? undefined : this.cx.typing.lower(callee);
          const closure = this.cx.recOf(executor);
          if (closure?.kind === "closure") {
            const written = bodyOf(this.cx.arenas.instanceOf(this.cx.closureBodies.get(executor as ClosureType)!));
            throw new CompileError("E0305", "an executor runs at once and what it gives is dropped, so the Promise it gives would never run; keep 'resolve' and await that call beside this Promise, as in 'Promise.all([promise, later(resolve)])'", written.start, written.end);
          }
          // `spawn` runs only an async function's call, and only inside an async function.
          const spawnable = this.f.async === true && !pausing && !boxed && r?.kind === "future" && !this.cx.typing.leafOf.has(made as FutureType);
          throw new CompileError("E0302", `this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'${spawnable ? ", or wrap the call in 'spawn(...)' for fire-and-forget" : ""}`, s.expr.start, s.expr.end);
        }
        // Past an assertion its condition holds, as TypeScript's `asserts cond` says.
        if (s.expr.kind === "call" && this.cx.asserts.has(s.expr)) return this.proves(s.expr.args[0]!).yes;
        return;
      case "let": {
        if (s.keyword === "var") throw new CompileError("E0802", "'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
        const d = this.cx.rewrites.current(s.declarations[0]!);
        if (d.init?.kind === "arrow" && d.target.kind === "ident" && s.keyword === "const" && d.init.typeParams.some((p) => !isLifetime(p))) return this.lift(s, d.target.name, arrowFunction(this.cx.ids, d.target.name, d.init, d));
        if (d.target.kind === "array" || d.target.kind === "object") return this.destructured(s, d, d.target, this.siblings);
        if (this.cx.loopParts.has(d)) return this.loopPart(s, d);
        if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
        if (!d.init && s.keyword === "const") throw new CompileError("E0406", "a 'const' needs its value where it is declared, as TypeScript requires; use 'let' to assign it later", d.start, d.end);
        if (!d.init) return this.unassigned(s, d, d.target.name);
        if (isAwait(d.init)) this.awaiting(d.init);
        if (d.init.kind === "yield") this.yieldable.add(d.init);
        // A function type there makes the variable a stored callable.
        const declared = (d.type && this.cx.typing.stored(this.cx.resolver().resolveType(d.type))) || this.cx.demands.get(s) || this.partType(s);
        // A generic function type describes the value, which keeps its own type, as an
        // interface's does.
        const named = this.cx.recOf(declared);
        const family = named?.kind === "function" && named.generic ? declared : undefined;
        const annotated = family ? undefined : declared;
        if (annotated) this.exprs().expect(d.init, annotated);
        const type = this.exprs().value(d.init);
        if (annotated) this.exprs().coerce(d.init, type, annotated, `type '${this.cx.typing.show(type)}' is not assignable to type '${this.cx.typing.show(annotated)}'`);
        const closure = this.cx.recOf(type);
        if (family && !(closure?.kind === "closure" && closure.generic)) throw new CompileError("E0101", `type '${this.cx.typing.show(type)}' is not assignable to type '${this.cx.typing.show(family)}': it takes a generic function, one that works for every type`, d.init.start, d.init.end);
        // An interface describes the value, which keeps its own concrete type.
        // A `let` may later hold another member of an enum, so it holds the enum.
        const widened = s.keyword === "let" && !annotated ? this.cx.typing.widenLet(type) : type;
        if (widened !== type) this.exprs().coerce(d.init, type, widened, "");
        const array = this.cx.recOf(widened);
        if (!annotated && array?.kind === "array" && array.element === "never") {
          throw new CompileError("E0104", `an empty array needs a type to say what it will hold, like 'let ${d.target.name}: string[] = []'`, d.init.start, d.init.end);
        }
        // So does a regex given as a 'RegExp', which keeps its pattern's captures.
        const describes = annotated && (this.cx.isInterface(annotated) || (annotated === ANY_REGEX && s.keyword === "const"));
        this.declare(d.target.name, annotated && !describes ? annotated : widened, s.keyword === "let", false, s);
        if (s.keyword === "let" && !annotated && type === "i64" && this.exprs().literalOnly(d.init, false)) this.cx.candidates.set(this.locals.get(s)!, s);
        // A nested function's declaration, met as this `const` again when a body is checked anew.
        if (this.cx.nestedFunctions.has(d.init)) this.cx.nestedBindings.add(this.locals.get(s)!);
        return;
      }
      case "if": {
        this.exprs().condition(s.cond);
        const proven = this.proves(s.cond);
        this.assume(proven.yes, () => this.scoped(s.then));
        if (s.else) this.assume(proven.no, () => this.scoped(s.else!));
        // A branch that never reaches its end leaves the other's facts for what follows.
        const [thenLeaves, elseLeaves] = [this.leaves(s.then), s.else ? this.leaves(s.else) : false];
        if (thenLeaves && !elseLeaves) return proven.no;
        if (elseLeaves && !thenLeaves) return proven.yes;
        return undefined;
      }
      case "while":
        this.exprs().condition(s.cond);
        this.within({ stmt: s, kind: "loop" }, () => this.assume(this.proves(s.cond).yes, () => this.scoped(s.body)));
        return;
      // A nested function is a closure under its name, lending what it uses per call.
      case "function": {
        if (!s.body) throw unsupported("nested functions without a body", s);
        if (s.typeParams.some((p) => !isLifetime(p)) && !s.generator && !s.macro) return this.lift(s, s.name, s as Func);
        if (s.typeParams.length > 0) throw unsupported("generic nested functions", s);
        if (s.generator) throw unsupported("nested generator functions", s);
        if (s.macro) throw unsupported("nested macros", s);
        const at = { start: s.start, end: s.end };
        const arrow: Expr = { id: nextId(this.cx.ids), kind: "arrow", move: false, async: s.async, typeParams: [], params: s.params, returnType: s.returnType, ...(s.throws && { throws: s.throws }), body: s.body, ...at };
        this.cx.nestedFunctions.set(arrow, s.name);
        // The body is the arrow's now; the statement holds nothing else, or walks over it would find
        // the body twice, as an async function's frame did, taking the function's loops and awaits
        // for its own.
        return this.statement(this.cx.rewrites.replace(s, { id: 0, kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.ids), target: { id: nextId(this.cx.ids), kind: "ident", name: s.name, start: s.start, end: s.end }, type: undefined, init: arrow, ...at }], ...at }));
      }
      // Checked as the code it is; it runs while compiling, where its locals are its own.
      case "comptime":
        this.comptimeDepth++;
        this.floors.push(this.targets.length);
        this.scoped(s.body);
        this.floors.pop();
        this.comptimeDepth--;
        return;
      case "block":
        this.scoped(s.body);
        return;
      case "unsafe":
        this.exprs().unsafely(() => this.scoped(s.body));
        return;
      case "debugger":
        throw unsupported("'debugger' statements", s);
      case "empty": {
        // A generic function lifted from here in an earlier check of this body.
        const lifted = this.cx.liftedFunctions.get(s);
        if (lifted) {
          this.declare(lifted.name, "void", false, false, s);
          this.cx.localOf(this.locals.get(s)!).generic = lifted.fn;
        }
        return;
      }
      case "for":
        // A name declared in the head is scoped to the loop.
        this.scopes.push(new Map());
        if (s.init) this.statement(s.init);
        if (s.test) this.exprs().condition(s.test);
        if (s.update) this.exprs().effect(s.update);
        this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
        this.scopes.pop();
        return;
      case "forIn":
        throw unsupported("'for...in' loops", s);
      // `for (const x of arr)` borrows each element, shared, or copies a Copy one.
      case "forOf": {
        if (s.await) {
          if (!this.f.async || this.cx.timerMains.has(this.f as Body & Func)) throw new CompileError("E0301", "'for await' can only be used inside an 'async' function", s.start, s.end);
          if (this.targets.some((t) => t.kind === "arm")) throw unsupported("'for await' loops inside match arms", s);
          if (this.finalizing > 0) throw unsupported("'for await' loops in a 'try' with a 'finally'", s);
        }
        const left = s.left;
        if (left.kind !== "let" || left.keyword === "var") throw unsupported("'for...of' loops over a variable declared outside them", left);
        const d = left.declarations[0]!;
        if (left.declarations.length === 1 && (d.target.kind === "array" || d.target.kind === "object")) return this.statement(this.loopPattern(s, d, d.target));
        if (left.declarations.length > 1 || d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
        if (d.type) throw new CompileError("E0004", "a 'for...of' variable can't have a type annotation; its type comes from what it loops over", d.type.start, d.type.end);
        const through = this.exprs().value(s.right);
        const object = this.cx.isRef(through) ? this.cx.typing.rec(through).to : through;
        const o = this.cx.recOf(object);
        if (s.await) {
          this.awaitLoop(s, d.target.name, left.keyword === "let", through, object);
          return;
        }
        // A loop borrows what it reads from as long as it runs, so it can't read a part of a
        // value made for the statement, which is gone before the first pass.
        // A reference reaches a value living elsewhere, wherever it came from.
        const lent = (x: Expr) => this.cx.isRef(this.types.get(x)!);
        let root = s.right;
        // A getter's result is made for the read, so the walk ends at it.
        while (!lent(root) && ((root.kind === "member" && !this.calls.has(root)) || root.kind === "index" || root.kind === "nonNull")) root = root.kind === "nonNull" ? root.expr : root.object;
        if (root !== s.right && !lent(root) && root.kind !== "ident" && root.kind !== "this" && !stringLike(this.cx.typing, object)) {
          throw new CompileError("E0212", "this loop would read from a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'", s.right.start, s.right.end);
        }
        // A string gives each of its code points, as a string of its own.
        if (stringLike(this.cx.typing, object)) {
          if (through !== "string") this.coercions.set(s.right, "string");
          this.scopes.push(new Map());
          this.declare(d.target.name, "string", left.keyword === "let", false, left);
          this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
          this.scopes.pop();
          return;
        }
        // A generator gives each value it yields, owned. Like JavaScript closing it when the
        // loop ends, the loop takes an owned generator over; one behind a `Mut` is lent.
        const yields = this.cx.typing.yieldsOf(object);
        if (yields !== undefined) {
          if (this.cx.isRef(through) && !this.cx.typing.rec(through).mutable) throw new CompileError("E0206", "a 'for...of' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
          const error = this.cx.typing.generatorThrows(object);
          if (error) this.raise(s.right, error, "this generator");
          this.scopes.push(new Map());
          this.declare(d.target.name, yields, left.keyword === "let", false, left);
          this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
          this.scopes.pop();
          return;
        }
        // A fixed array's elements, as an array's: borrowed, or copies when they copy.
        if (o?.kind === "fixed") {
          this.scopes.push(new Map());
          this.declare(d.target.name, this.cx.typing.isCopy(o.element) ? o.element : this.cx.typing.refType(o.element, false), left.keyword === "let", false, left);
          this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
          this.scopes.pop();
          return;
        }
        // A Map gives each entry as a `[key, value]` pair, and a Set each member, in insertion
        // order: each part borrowed, or a copy when it copies.
        if (o?.kind === "map") {
          if (object !== through) this.coercions.set(s.right, object);
          const lend = (u: Type) => (this.cx.typing.isCopy(u) ? u : this.cx.typing.refType(u, false));
          this.scopes.push(new Map());
          this.declare(d.target.name, o.set ? lend(o.key) : this.cx.typing.tupleType([lend(o.key), lend(o.value)]), left.keyword === "let", false, left);
          this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
          this.scopes.pop();
          return;
        }
        if (this.cx.typing.yieldsOf(object, true) !== undefined) throw new CompileError("E0119", "an async generator's values are awaited, so loop over it with 'for await'", s.right.start, s.right.end);
        if (o?.kind !== "array") throw new CompileError("E0119", `'for...of' needs an array, a Map, a Set, a string or a generator, not '${this.cx.typing.show(object)}'`, s.right.start, s.right.end);
        if (object !== through) this.coercions.set(s.right, object);
        this.scopes.push(new Map());
        this.declare(d.target.name, this.cx.typing.isCopy(o.element) ? o.element : this.cx.typing.refType(o.element, false), left.keyword === "let", false, left);
        this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
        this.scopes.pop();
        return;
      }
      case "doWhile":
        this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
        this.exprs().condition(s.cond);
        return;
      case "switch": {
        const type = this.exprs().read(s.discriminant);
        const r = this.cx.recOf(type);
        const union = r?.kind === "union" ? (type as UnionType) : undefined;
        if (r && !union && r.kind !== "literal") throw unsupported("comparisons of objects", s.discriminant);
        const defaults = s.cases.filter((c) => !c.test);
        if (defaults.length > 1) throw new CompileError("E0608", "a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
        // The case bodies share one scope, as in JavaScript, but any case may be entered
        // directly, skipping the bodies before it, so a binding one case declares is usable
        // only in that case.
        const shared = new Map<string, LocalId>();
        this.scopes.push(shared);
        this.within({ stmt: s, kind: "switch" }, () => {
          // A case narrows a union for its body, and so do the cases that fall through into it.
          // `falling` is what holds for a body the previous one falls into, or null when it leaves.
          let falling: Facts | null = null;
          for (const c of s.cases) {
            const before = new Set(shared.values());
            let test = c.test && this.exprs().value(c.test);
            // A literal case takes the discriminant's type, or its union's one number type.
            const numbers = union ? numberMembers(this.cx.tables.typing, union) : [type];
            if (test && test !== type && numbers.length === 1 && this.exprs().adapt(c.test!, numbers[0]!)) test = numbers[0]!;
            // A discriminant whose type is still open takes an integer case's.
            if (test && test !== type && isInteger(test) && !this.exprs().literalOnly(s.discriminant, false) && this.exprs().adapt(s.discriminant, test)) test = type;
            if (test && objectsMeet(this.cx.tables.typing, type, test)) throw unsupported("comparisons of objects", c.test!);
            if (test && test !== type && !comparable(this.cx.tables.typing, this.cx.tables.typing.lower(type), test)) {
              throw new CompileError("E0112", `type '${this.cx.typing.show(test)}' is not comparable to type '${this.cx.typing.show(type)}'`, c.test!.start, c.test!.end);
            }
            const tested: Facts = c.test ? this.proves({ id: nextId(this.cx.ids), kind: "binary", op: "===", left: s.discriminant, right: c.test, start: c.start, end: c.end }).yes : new Map();
            const reaching: Facts = falling ? either(this.cx.tables.typing, falling, tested) : tested;
            const mark = this.changed.length;
            this.assume(reaching, () => this.statements(c.body));
            for (const local of shared.values()) if (!before.has(local)) this.caseOnly.add(local);
            falling = this.leaves(c.body) ? null : this.current(reaching, mark);
          }
        });
        this.scopes.pop();
        return;
      }
      case "labeled": {
        if (this.targets.some((t) => t.label === s.label)) {
          throw new CompileError("E0402", `duplicate label '${s.label}'`, s.start, s.start + s.label.length);
        }
        let body = s.body;
        while (body.kind === "labeled") body = body.body;
        const loop = ["while", "doWhile", "for", "forIn", "forOf"].includes(body.kind) ? body : undefined;
        this.within({ stmt: s, kind: "label", label: s.label, loop }, () => this.statement(s.body));
        return;
      }
      case "break":
      case "continue": {
        const target = this.jumpTarget(s);
        if (this.floors.length > 0 && this.targets.findIndex((t) => t.stmt === target) < this.floors.at(-1)!) {
          throw new CompileError("E1102", `'${s.kind}' can't leave a comptime block, which runs while compiling, before the program does`, s.start, s.end);
        }
        this.jumps.set(s, target);
        (s.kind === "break" ? this.cx.broken : this.cx.continued).add(target);
        return;
      }
      case "throw":
        this.thrown(s, s.value);
        return;
      case "try": {
        // Without a catch, what the block raises goes on out, after the `finally`.
        if (!s.handler) {
          this.finalizing++;
          this.scoped(s.block);
          this.scoped(s.finalizer!);
          this.finalizing--;
          return;
        }
        if (s.finalizer) this.finalizing++;
        if (s.paramType) throw new CompileError("E0004", "a catch parameter takes no type annotation: its type is what the 'try' can throw", s.paramType.start, s.paramType.end);
        // What the block raises goes to the catch, which takes the union of it.
        this.handlers.push([]);
        this.scoped(s.block);
        const sites = this.handlers.pop()!;
        if (sites.length === 0) {
          const never = new CompileError("E0603", "nothing in this 'try' can throw, so its 'catch' never runs; remove the try/catch", s.start, s.start + 3);
          this.cx.tryCallees.push([never, [...this.instance.calls].filter(([x]) => x.start >= s.start && x.end <= s.end).map(([, i]) => this.cx.arenas.instanceOf(i).body)]);
          throw never;
        }
        const caught = this.cx.typing.unionType(sites.map(([, t]) => t));
        for (const [at, from] of sites) this.instance.raises.set(at, { from, to: caught });
        this.instance.caught.set(s, caught);
        this.scopes.push(new Map());
        if (s.param) {
          if (s.param.kind !== "ident") throw unsupported("destructuring patterns", s.param);
          this.declare(s.param.name, caught, true, false, s);
        }
        this.statements(s.handler!);
        this.scopes.pop();
        if (s.finalizer) {
          this.scoped(s.finalizer);
          this.finalizing--;
        }
        return;
      }
      case "return": {
        // A `return` in a match arm gives the arm its value, and never leaves the function.
        const arm = this.targets.findLast((t) => t.kind === "arm");
        if (this.floors.length > 0 && (!arm || this.targets.indexOf(arm) < this.floors.at(-1)!)) {
          throw new CompileError("E1102", "'return' can't leave a comptime block, which runs while compiling; give a value with a 'comptime' expression instead", s.start, s.end);
        }
        if (arm) {
          this.jumps.set(s, arm.stmt);
          if (arm.wanted && !s.value) throw new CompileError("E0605", "this match gives a value, so a 'return' in its arm needs one", s.start, s.end);
          // In TypeScript this would leave the function, which a return in an arm never does.
          if (!arm.wanted && s.value) {
            throw new CompileError("E0605", "this match's value isn't used, so a 'return' in its arm can't give one, and it never leaves the function; return after the match instead", s.start, s.end);
          }
          if (s.value) arm.gives!.push([s.value, arm.wanted ? this.exprs().value(s.value) : this.exprs().result(s.value)]);
          return;
        }
        if (this.generatorType) {
          if (s.value) throw new CompileError("E0801", "a generator can't return a value yet; 'return;' ends it", s.value.start, s.value.end);
          return;
        }
        if (s.value && isAwait(s.value)) this.awaiting(s.value);
        if (this.f.self?.constructor && s.value) throw new CompileError("E0605", "a constructor can't return a value", s.start, s.end);
        if (this.unset.size > 0) throw new CompileError("E0605", "a constructor can't return before every field is assigned", s.start, s.end);
        if (this.declared && s.value) this.exprs().expect(s.value, this.declared);
        // An arrow's expression body may be a call returning nothing.
        const type = !s.value ? "void" : s.value === this.f.closure?.value && (s.value.kind === "call" || s.value.kind === "tagged") ? this.exprs().result(s.value) : this.exprs().value(s.value);
        // A closure returned is boxed into the callable the function declares.
        // A generic function value is returned as it is, capturing nothing.
        const r = this.cx.recOf(type);
        if (r?.kind === "closure" && !r.generic && this.cx.recOf(this.declared)?.kind !== "dyn") throw unsupported("functions returned without a function return type", s.value!);
        // Returns of different regexes give any regex, as TypeScript infers 'RegExp'.
        if (!this.declared && this.cx.recOf(this.inferred)?.kind === "regex" && r?.kind === "regex" && this.inferred !== type) this.inferred = ANY_REGEX;
        const expected = this.declared ?? this.inferred;
        const message = `type '${this.cx.typing.show(type)}' is not assignable to return type '${this.cx.typing.show(expected ?? type)}'`;
        if (expected && s.value) this.exprs().coerce(s.value, type, expected, message);
        else if (expected && type !== expected) throw new CompileError("E0101", message, s.start, s.end);
        const bound = r?.kind === "param" ? this.cx.recOf(r.bound) : undefined;
        const passedOn = bound?.kind === "function" && bound.generic !== undefined;
        if (this.family && !passedOn && !(r?.kind === "closure" && r.generic)) throw new CompileError("E0101", `type '${this.cx.typing.show(type)}' is not assignable to return type '${this.cx.typing.show(this.family)}': it takes a generic function, one that works for every type`, (s.value ?? s).start, (s.value ?? s).end);
        const reason = this.trait && unsatisfied(type, this.trait, this.cx.members(), s.value ?? s);
        if (reason) throw new CompileError("E0101", `type '${this.cx.typing.show(type)}' is not assignable to return type '${this.cx.typing.rec(this.trait!).name}': ${reason}`, (s.value ?? s).start, (s.value ?? s).end);
        this.inferred = expected ?? type;
        return;
      }
    }
  }

  // `for await`: an async generator gives each value it yields, as a generator's loop does, and
  // a Channel each value it receives until it is closed and drained.
  awaitLoop(this: Mut<this>, s: Extract<Stmt, { kind: "forIn" | "forOf" }>, name: string, mutable: boolean, through: Type, object: Type) {
    const yields = this.cx.typing.yieldsOf(object, true);
    const o = this.cx.recOf(object);
    const channel = o?.kind === "block" && o.which === "Channel" ? this.cx.typing.lower(o.of) : undefined;
    if (yields === undefined && channel === undefined) {
      throw new CompileError("E0119", `'for await' loops over an async generator or a Channel, not '${this.cx.typing.show(through)}'`, s.right.start, s.right.end);
    }
    if (yields !== undefined && this.cx.isRef(through) && !this.cx.typing.rec(through).mutable) throw new CompileError("E0206", "a 'for await' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
    const error = this.cx.typing.generatorThrows(object);
    if (error) this.raise(s.right, error, "this generator");
    this.scopes.push(new Map());
    this.declare(name, yields ?? channel!, mutable, false, s.left as Stmt);
    this.within({ stmt: s, kind: "loop" }, () => this.scoped(s.body));
    this.scopes.pop();
  }

  // The `this.x` a statement assigns, when it is a plain assignment to one of the class's
  // own fields. A setter is a method, which can't run until every field is set.
  // `yield v;`: the generator gives `v` and stops until `next()` is called again. It runs as
  // a statement of its own, or as all of a declaration's initializer or an assignment's value,
  // so nothing the statement made is pending across it. Its value is what `next(x)` sends.
  yielding(this: Mut<this>, e: Extract<Expr, { kind: "yield" }>): Type {
    if (!this.generatorType) throw new CompileError("E0606", "'yield' can only be used inside a 'function*'", e.start, e.end);
    if (this.yieldable.has(e) && this.f.async) throw unsupported("values sent into an async generator's 'next'", e);
    if (this.yieldable.has(e) && this.sends === undefined) {
      throw new CompileError("E0606", `this 'yield' gives what 'next(x)' sends, so declare what that is, as in 'Generator<${this.yielded ? this.cx.typing.show(this.yielded) : "T"}, void, string>'`, e.start, e.end);
    }
    if (this.targets.some((t) => t.kind === "arm")) throw unsupported("'yield' inside match arms", e);
    if (this.finalizing > 0) throw unsupported("'yield' statements in a 'try' with a 'finally'", e);
    if (e.delegate) throw unsupported("'yield*'", e);
    if (!e.value) throw new CompileError("E0606", "a generator's 'yield' gives a value, like 'yield x;'", e.start, e.end);
    if (this.yielded) this.exprs().expect(e.value, this.yielded);
    const t = this.exprs().value(e.value);
    if (!this.yielded) this.yielded = this.cx.typing.widenLet(t);
    if (this.cx.typing.holdsRef(this.yielded)) throw unsupported("generators yielding references", e.value);
    this.exprs().coerce(e.value, t, this.yielded, `type '${this.cx.typing.show(t)}' is not assignable to the generator's '${this.generatorName}<${this.cx.typing.show(this.yielded)}>'`);
    return this.sends ?? "void";
  }

  // An `await` written as a statement of its own, or as all of a declaration's initializer,
  // an assignment's value or a return's: one the state machine can stop at with nothing else
  // of the statement pending.
  awaiting(this: Mut<this>, e: Expr) {
    if (!this.f.async) return;
    if (this.targets.some((t) => t.kind === "arm")) throw unsupported("'await' inside match arms", e);
    if (this.finalizing > 0) throw unsupported("'await' statements in a 'try' with a 'finally'", e);
    this.awaitable.add(e);
  }

  fieldAssignment(this: Mut<this>, s: Stmt): Extract<Expr, { kind: "member" }> | undefined {
    if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
    // This runs before the statement is checked; a `!` here that can unwrap is refused there.
    let target = s.expr.target;
    while (target.kind === "nonNull") target = target.expr;
    if (target.kind !== "member" || target.object.kind !== "this") return undefined;
    // Once `super(...)` has run, the base's fields are set, and may be set again before the
    // class's own are.
    const { base } = this.cx.typing.rec(this.f.self!.type);
    const inherited = !this.unset.has(SUPER) && base !== undefined && this.cx.typing.field(base, target.name) !== undefined;
    return this.cx.registry().classOf(this.f.self!.type).fields.some((d) => d.name === target.name) || inherited ? target : undefined;
  }

  within(this: Mut<this>, target: Target, check: () => void) {
    target.facts = this.facts.length;
    this.targets.push(target);
    check();
    this.targets.pop();
  }

  jumpTarget(s: Jump): Stmt {
    const fits = (t: Target) => (s.label === undefined ? t.kind === "loop" || (s.kind === "break" && t.kind === "switch") : t.label === s.label);
    const found = this.targets.findLast((t) => t.kind === "arm" || fits(t));
    // A match arm is a body of its own, as an arrow's is.
    if (found?.kind === "arm" && this.targets.some(fits)) {
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
  leaves(stmts: Stmt[]): boolean {
    const last = stmts.at(-1);
    return alwaysReturns(stmts, this.cx.broken, this.cx.continued) || last?.kind === "break" || last?.kind === "continue";
  }

  scoped(this: Mut<this>, stmts: Stmt[]) {
    this.scopes.push(new Map());
    this.statements(stmts);
    this.scopes.pop();
  }

  declare(this: Mut<this>, name: string, type: Type, mutable: boolean, param: boolean, node: Stmt | Param | Expr) {
    const scope = this.scopes[this.scopes.length - 1]!;
    // A destructuring's own variable, named for its pattern, may repeat; nothing names it.
    if (scope.has(name) && !name.startsWith("[") && !name.startsWith("{")) throw new CompileError("E0402", `cannot redeclare '${name}' in the same scope`, node.start, node.end);
    const local = this.cx.arenas.addLocal({ name, type, mutable, param, id: this.cx.nextLocal++ });
    this.depths.set(local.localId, this.scopes.length);
    scope.set(name, local.localId);
    this.locals.set(node, local.localId);
    this.cx.declarations.add(node);
  }

  lookup(this: Mut<this>, name: string, at?: Expr | ObjectProp): Local | undefined {
    for (let i = this.scopes.length - 1; i >= (this.hidden ? 1 : 0); i--) {
      const local = this.scopes[i]!.get(name);
      if (local) return this.cx.localOf(local);
    }
    const outside = this.outer?.lookup(name, at);
    // A local generic function holds nothing to capture.
    return outside && (outside.generic ? outside : this.capture(outside, at));
  }

  // Whether a binding is the one a sync nested function's declaration makes, or a closure's
  // capture of it.
  nestedLocal(this: Mut<this>, l: Local): boolean {
    const type = this.cx.typing.lower(l.type);
    const closure = this.cx.recOf(type);
    if (!this.cx.nestedBindings.has(l.localId) || closure?.kind !== "closure") return false;
    const nested = this.cx.arenas.instanceOf(this.cx.closureBodies.get(type as ClosureType));
    return nested === undefined || bodyOf(nested).async !== true;
  }

  peek(this: Mut<this>, name: string): Local | undefined {
    for (let i = this.scopes.length - 1; i >= (this.hidden ? 1 : 0); i--) {
      const local = this.scopes[i]!.get(name);
      if (local) return this.cx.localOf(local);
    }
    return this.outer?.peek(name);
  }

  inScope(this: Mut<this>): string[] {
    return [...this.scopes.slice(this.hidden ? 1 : 0).flatMap((scope) => [...scope.keys()]), ...(this.outer?.inScope() ?? [])];
  }

  // By the binding itself, not its name, which a body in between may have taken for another.
  reach(this: Mut<this>, l: Local, at?: Expr | ObjectProp): Local {
    if (this.captures?.has(l.localId) || this.scopes.some((scope) => [...scope.values()].includes(l.localId))) return l;
    return this.capture(this.outer!.reach(l, at), at);
  }

  // A generic function written in a body, or a generic arrow a const holds, is a generic
  // function of its own, instantiated per call, so it can use nothing of the body around it.
  lift(this: Mut<this>, s: Stmt, name: string, fn: Func): undefined {
    this.lifted(s, name, fn, `'${name}'`);
    return this.statement(this.cx.rewrites.replace(s, { id: 0, kind: "empty", start: s.start, end: s.end })) as undefined;
  }

  // A generic arrow written as a value is a generic function of its own, as one a const holds
  // is, and the arrow becomes its name.
  liftArrow(this: Mut<this>, e: Extract<Expr, { kind: "arrow" }>): Expr {
    const fn = this.lifted(e, "", arrowFunction(this.cx.ids, "", e, e), "this arrow");
    return this.cx.rewrites.replace(e, { id: 0, kind: "ident", name: fn.name, start: e.start, end: e.end });
  }

  // Lifts a generic function out of the body around it, once per place it is written. `who`
  // names it in messages.
  lifted(this: Mut<this>, key: Stmt | Expr, name: string, fn: Func, who: string): Func {
    const own = fn as Extract<Stmt, { kind: "function" }>;
    if (holdsNode("stmt", fn.body, (n) => n.kind === "this")) {
      throw new CompileError("E0409", `${who} is generic, so it is made anew for each call and can't use 'this'; pass what it needs as a parameter`, fn.start, fn.end);
    }
    // It is checked apart from the body around it, so a name that body declares anywhere,
    // before or after, a sibling generic function or a type parameter included, would mean
    // something else inside it.
    const around = new Set([...declaredIn(this.f), ...(this.f.scope?.keys() ?? []), ...this.scopes.flatMap((s) => [...s.keys()])]);
    for (const n of freeNames(own)) {
      if (n !== name && (around.has(n) || this.lookup(n))) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use '${n}' from there; pass it as a parameter, or declare it at the top level`, fn.start, fn.end);
    }
    const outer = (n: { kind?: unknown; name?: unknown }) => n.kind === "ref" && typeof n.name === "string" && around.has(n.name) && !(fn.typeParams ?? []).some((p) => p.name === n.name);
    const typed = holdsNode("param", fn.params, outer) || holdsNode("typeNode", fn.returnType, outer) || holdsNode("stmt", fn.body, outer);
    if (typed) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use its types; declare it at the top level`, fn.start, fn.end);
    let lifted = this.cx.liftedFunctions.get(key);
    if (!lifted) {
      lifted = { name, fn: { ...fn, id: nextId(this.cx.ids), name: `${this.f.name}.${name || "arrow"}#${this.cx.counts.lifts++}` } };
      // Its calls of itself call what it was lifted to.
      const symbol = lifted.fn.name;
      holdsNode("stmt", fn.body, (n) => {
        const c = n as Expr;
        if (c.kind === "call" && c.callee.kind === "ident" && c.callee.name === name) this.cx.rewrites.replace(c.callee, { ...c.callee, name: symbol });
        return false;
      });
      this.cx.liftedFunctions.set(key, lifted);
      this.cx.byName.set(lifted.fn.name, this.cx.addBody(lifted.fn).bodyId);
      this.cx.funcs.push(this.cx.addBody(lifted.fn));
    }
    return lifted.fn;
  }

  // Whether `this` may be used: a constructor's can't until every field is assigned, nor can
  // a closure's made before then.
  thisReady(this: Mut<this>, e: Expr): boolean {
    return this.outer ? this.outer.thisReady(e) : this.unset.size === 0 || e === this.exempt;
  }

  // A closure changing what it captures captures it mutably, if it may change where the
  // closure is made.
  changesCapture(this: Mut<this>, l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean) {
    const alias = l?.localId ?? [...this.captures!].find(([, from]) => from === "this")![0];
    const held = this.captures!.get(alias)!;
    this.instance.changed!.add(alias);
    const from = held === "this" ? held : this.cx.localOf(held);
    if (from === "this") this.outer!.changesThis(path, action, target);
    // What a `move` closure holds is its own to change, unless the change goes through a
    // mutable reference it holds a copy of; as in Rust, only a copy of a `let` may change.
    else if (this.f.closure!.move && !(this.cx.isRef(from.type) && (path || throughMut))) {
      if (this.outer!.constant(from)) {
        throw new CompileError("E0207", `cannot ${action} '${from.name}${path}' in this closure because '${from.name}' is a constant; declare it with 'let'`, target.start, target.end);
      }
      return;
    }
    else {
      if (!path && action === "assign to" && this.cx.isRef(from.type) && !this.cx.typing.rec(from.type).mutable) throw unsupported("closures that point captured references elsewhere", target);
      this.outer!.changesLocal(from, path, action, target, throughMut);
    }
  }

  constant(this: Mut<this>, l: Local): boolean {
    const from = this.captures?.get(l.localId);
    if (from && from !== "this") return this.outer!.constant(this.cx.localOf(from));
    return !l.mutable || l.param;
  }

  // `throw` returns an error of the type the function declares, or goes to a catch. A value
  // the error type takes is converted to it; another may be wrapped.
  thrown(this: Mut<this>, at: Expr | Stmt, thrownValue: Expr) {
    const type = this.exprs().value(thrownValue);
    const into = this.errorType && this.handlers.length === 0 && (this.cx.typing.fits(type, this.errorType) || this.exprs().adapt(thrownValue, this.errorType));
    if (into) this.exprs().coerce(thrownValue, type, this.errorType!, `type '${this.cx.typing.show(type)}' can't be thrown here: ${this.who()} throws '${this.cx.typing.show(this.errorType!)}'`);
    this.raise(at, into ? this.errorType! : this.types.get(thrownValue)!, "'throw'");
  }

  // An error raised by a call or a `throw` goes to the function's caller, which needs a
  // `throws` clause it fits.
  raise(this: Mut<this>, at: Expr | Stmt, type: Type, what: string) {
    if (this.cx.typing.holdsRef(type)) throw unsupported("errors holding references", at);
    const handler = this.handlers.at(-1);
    if (handler) return void handler.push([at, type]);
    // An error comptime code doesn't catch is a compile error where it runs, so it may throw any.
    if (this.f.comptime || this.comptimeDepth > 0) return;
    if (this.built) throw new CompileError("E0602", "a constructor can only throw before it assigns its first field, so a failed 'new' leaves nothing half built; field initializers count as assigned first, so check and throw before assigning, then assign the fields", at.start, at.end);
    if (this.inferring) return void this.inferring.push([at, type]);
    if (!this.errorType && this.contextual) {
      const does = "kind" in at && at.kind === "throw" ? `this closure throws '${this.cx.typing.show(this.cx.typing.widenLet(type))}'` : `${what} can throw '${this.cx.typing.show(this.cx.typing.widenLet(type))}'`;
      throw new CompileError("E0602", `${does}, but the closure is given as '${this.cx.typing.show(this.contextual)}', which throws nothing; catch it inside the closure with try/catch`, at.start, at.end);
    }
    if (!this.errorType) {
      const does = "kind" in at && at.kind === "throw" ? "to throw here" : `since ${what} can throw '${this.cx.typing.show(type)}'`;
      throw new CompileError("E0602", `${this.who()} must declare 'throws ${this.cx.typing.show(type)}' after its return type ${does}, or catch it with try/catch`, at.start, at.end);
    }
    if (this.cx.typing.fits(type, this.errorType)) return void this.instance.raises.set(at, { from: type, to: this.errorType });
    // An error the declared type doesn't take may be wrapped by a class of it that
    // implements `From` for it.
    const union = this.cx.recOf(this.errorType);
    const classes = (union?.kind === "union" ? union.members : [this.errorType])
      .filter((m): m is ClassType => typeof m !== "string" && this.cx.typing.rec(m).kind === "class");
    const wrappers = classes.flatMap((c) => this.cx.registry().wrapsOf(this.cx.registry().classOf(c)).filter(([x]) => this.cx.typing.fits(type, x)).map(([, body, param]) => ({ wrapper: c, param, via: this.cx.instancing().instanceOf(this.cx.arenas.bodyOf(body)).id })));
    const does = "kind" in at && at.kind === "throw" ? `this 'throw' throws '${this.cx.typing.show(type)}'` : `${what} can throw '${this.cx.typing.show(type)}'`;
    if (wrappers.length === 0) {
      const hint = classes.length > 0 ? `convert it, or have '${this.cx.typing.rec(classes[0]!).name}' implement 'From<${this.cx.typing.show(type)}>'` : `convert it to '${this.cx.typing.show(this.errorType)}'`;
      throw new CompileError("E0602", `${does}, which isn't the '${this.cx.typing.show(this.errorType)}' that ${this.who()} throws; ${hint}`, at.start, at.end);
    }
    if (wrappers.length > 1) {
      throw new CompileError("E0602", `${does}, which ${wrappers.map((w) => `'${this.cx.typing.rec(w.wrapper).name}'`).join(" and ")} both wrap; throw one of them yourself`, at.start, at.end);
    }
    this.instance.raises.set(at, { from: type, to: this.errorType, ...wrappers[0]! });
  }

  // Who throws, in messages: the function, or the closure or nested function it is in.
  who(): string {
    return this.f.closure?.self !== undefined ? `'${this.f.closure.self}'` : this.f.closure ? "this closure" : `'${this.f.name}'`;
  }

  noteThis(this: Mut<this>, e: Expr) {
    if (!this.captures || [...this.captures.values()].includes("this")) return;
    const alias = this.cx.arenas.addLocal({ name: "this", type: this.self!.type, mutable: false, param: false, id: this.cx.nextLocal++ });
    this.captures.set(alias.localId, "this");
    this.instance.captureUses!.set(alias.localId, e);
    this.outer!.noteThis(e);
  }

  // Who a closure's body counts as for access to private members: its function's class.
  closureOwner(this: Mut<this>, b: Body): Body["owner"] {
    let outerBody = b;
    while (outerBody.closure) outerBody = bodyOf(this.cx.arenas.instanceOf(outerBody.closure.parent));
    return outerBody.declared ?? (outerBody.owner && outerBody.owner === this.enclosing?.type ? this.self!.type : outerBody.owner);
  }

  // A variable's type where something narrowed it: a captured one as it was where the closure
  // was made.
  narrowed(this: Mut<this>, l: Local): Type | undefined {
    const outside = this.captures?.get(l.localId);
    return this.facts.findLast((f) => f.has(l.localId))?.get(l.localId) ?? (outside && outside !== "this" ? this.outer!.narrowed(this.cx.localOf(outside)) : undefined);
  }

  // A closure's body reads a variable it captures through a binding of its own, standing
  // for it.
  capture(this: Mut<this>, from: Local, at?: Expr | ObjectProp): Local {
    const found = [...this.captures!].find(([, l]) => l === from.localId)?.[0];
    let alias = found === undefined ? undefined : this.cx.localOf(found);
    if (!alias) {
      alias = this.cx.arenas.addLocal({ name: from.name, type: from.type, mutable: false, param: false, id: this.cx.nextLocal++ });
      this.depths.set(alias.localId, 0);
      this.captures!.set(alias.localId, from.localId);
      if (this.cx.nestedBindings.has(from.localId)) this.cx.nestedBindings.add(alias.localId);
    }
    if (at && !this.instance.captureUses!.has(alias.localId)) this.instance.captureUses!.set(alias.localId, at);
    return alias;
  }
}

// The `this` a body sees: a closure's is that of the function it is written in.
export function selfOf(arenas: Arenas, f: Body): Body["self"] {
  return f.closure ? selfOf(arenas, bodyOf(arenas.instanceOf(f.closure.parent))) : f.self;
}

// Stands for the base in a derived constructor's unset fields until `super(...)` runs.
const SUPER = "super()";

// What a returned reference borrows from: a parameter, by index, or `this`.
export type Origin = usize | "this";

const hasBody = (f: Declared): f is Func => f.body !== undefined;

// An abstract class a type holds as a value, not one embedded as a concrete class's base.
function abstractPart(typing: Typing, t: Type): ClassType | undefined {
  const bases = new TypeSet<Type>();
  let found: ClassType | undefined;
  typing.holdsPart(t, (u) => {
    if (typeof u === "string") return false;
    const r = typing.rec(u);
    if (r.kind !== "class") return false;
    if (r.base) bases.add(r.base);
    if (r.abstract && !bases.has(u)) found = u as ClassType;
    return found !== undefined;
  }, true);
  return found;
}

// A net under the rules that decide what is compiled: no compiled function calls, and no
// compiled Dyn's table holds, an instance that isn't compiled. Only a value of an abstract
// class's own type, which escaped where no rule saw it, could reach one.
export function unreached(typing: Typing, equalities: Tables["equalities"], arenas: Arenas, compiled: InstanceId[], dropped: (i: Instance) => boolean) {
  for (const i of compiled.map((id) => arenas.instanceOf(id))) {
    const reached: [Expr, InstanceId, string][] = [
      ...[...i.calls, ...i.setters].map(([at, target]): [Expr, InstanceId, string] => [at, target, ""]),
      ...[...(i.dyns ?? [])].flatMap(([at, table]) => [...table.methods, ...table.fields, table.clone].flatMap((target): [Expr, InstanceId, string][] => (target && target !== "copy" ? [[at, target, " through a 'Dyn'"]] : []))),
    ];
    // A comparison of values runs each class's `equals` it reaches, through objects and unions.
    for (const [e] of i.types) {
      if (e.kind !== "binary" || !["===", "!==", "==", "!="].includes(e.op)) continue;
      for (const target of [...comparedBy(typing, equalities, i.types.get(e.left)), ...comparedBy(typing, equalities, i.types.get(e.right))]) reached.push([e, target, " to compare them"]);
    }
    const found = reached.find(([, target]) => dropped(arenas.instanceOf(target)));
    if (!found) continue;
    const [at, id, through] = found;
    const target = arenas.instanceOf(id);
    const abstract = (bodyOf(target).abstract ? bodyOf(target).owner : undefined) ?? [...target.bindings.values()].map((t) => abstractPart(typing, t)).find((t) => t) ?? bodyOf(target).declared ?? bodyOf(target).owner;
    const root = bodyOf(bodyOf(i).closure ? closureRoot(i) : i);
    const member = (root.owner ? root.name.slice(typing.rec(root.owner).name.length + 1) : root.name).replace(/#.*$/, "");
    // The name the call wrote, rather than the prelude function it may run.
    const callee = at.kind === "call" || at.kind === "new" ? at.callee : undefined;
    const named = callee?.kind === "ident" || callee?.kind === "member" ? callee.name : bodyOf(target).name.replace(/#.*$/, "");
    throw new CompileError("E0701", `a value of the abstract class '${abstract && typing.rec(abstract).name}' can't reach '${named}'${through} here yet; pass a subclass's value instead, or give '${member}' to each subclass`, at.start, at.end);
  }
}

// Each `equals` a comparison of two values runs, as codegen finds them: a class's own stops the
// search, and otherwise its base and fields, an object's fields and a union's members compare.
function comparedBy(typing: Typing, equalities: Tables["equalities"], t: Type | undefined, seen: TypeSet<Type> = new TypeSet<Type>()): InstanceId[] {
  if (t === undefined || typeof t === "string" || seen.has(t)) return [];
  seen.add(t);
  const r = typing.rec(t);
  const parts = (u: Type | undefined) => comparedBy(typing, equalities, u, seen);
  if (r.kind === "ref") return parts(r.to);
  if (r.kind === "class") {
    const own = equalities.get(t as ClassType);
    return own ? [own] : [r.base, ...r.fields.map((f) => f.type)].flatMap((u) => parts(u));
  }
  if (r.kind === "union") return r.members.flatMap((u) => parts(u));
  if (r.kind === "object") return r.fields.flatMap((f) => parts(f.type));
  return [];
}

function closureRoot(i: Instance): Instance {
  const parent = bodyOf(i).closure?.parent;
  return parent ? closureRoot(i.tables.arenas.instanceOf(parent)) : i;
}
