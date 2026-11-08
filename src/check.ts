import { cloneSignature, declareClass, extend, inherited, isLifetime, selfTyped, separatePrivateNames, shownName, type Body, type ClassInfo } from "./classes.ts";
import { crossingOf, rustClassOf } from "./rust.ts";
import { newDeclarations, newTables, timed, type Compilation, type Declarations, type Tables } from "./compilation.ts";
import { copyNames, CompileError, compileErrors, named } from "./diag.ts";
import { warnings } from "./warnings.ts";
import { STD_BASE, STD_INTERNAL, stdFor } from "./std.ts";
import { FILE_SPAN, stdModuleAt } from "./program.ts";
import { comptimeArgument, comptimeBody, stringsType, untagged, type Value } from "./comptime.ts";
import type { ClassNode, Declarator, Expr, Func as Declared, Id, Interface, ObjectProp, Param, Pattern, PatternProp, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { lowerPattern, type PatternInfo } from "./match.ts";
import { nextId, nodeIdOf, NodeMap, NodeSet, renumberExpr, Rewrites, walk, walkWhile, type AnyNode, type Ids } from "./nodes.ts";
import { cloneExpr, cloneInterface, cloneObjectProp, cloneParam, clonePattern, clonePatternProp, cloneStmt, cloneTypeAlias, cloneTypeNode, cloneTypeParam, rebuiltExpr, rebuiltParam, rebuiltStmts } from "./rebuild.ts";

type Arrow = Extract<Expr, { kind: "arrow" }>;
import { alwaysReturns, assignedNames, assignsOwn, closureAssigned, fieldRoots, patternNames } from "./flow.ts";
import { declareEnum, enumMemberNames, enumMemberOf, enumType, settleEnum, type EnumHost, type EnumInfo, type EnumInstance } from "./enums.ts";
import { bindingKey, covers, either, guard, isPath, presentKey, type Facts, type Guard, type GuardHost } from "./narrow.ts";
import { comparable, numberMembers, objectsMeet } from "./unions.ts";
import { comptimeName, infer, GenericClasses, GenericClassesState, Instancing, InstancingState, typeParamsOf, type GenericClassesHost, type InstancingHost } from "./generics.ts";
import { unsatisfied, type Members, type Refused } from "./interfaces.ts";
import { Registry, RegistryState, type RegistryHost } from "./registry.ts";
import { addAlias, traitAlias, paramName, Resolver, ResolverState, tagStrings, typeName, type InScope, type ResolverHost } from "./resolve.ts";
import { openParam } from "./typefns.ts";
import { lowerDefaults, writtenName } from "./defaults.ts";
import { TypeSet, TypeMap, ANY_REGEX, type InterfaceType, type UnionType, type ObjectType, YIELD_NOW, type FutureType, type Field, type GeneratorType, isInteger, isNumeric, type ClassType, type ClosureType, type FunctionType, type Integer, type RefType, type Type, type Typing, type VariantType, type Bound, type LiteralType } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { hoistLocals } from "./locals.ts";
import { localKeys, lowerKeys, numberKey, topKeys } from "./keys.ts";
import { lowerOverloads } from "./overloads.ts";
import { checkMoves } from "./moves.ts";
import { Expressions, ExpressionsState, stringLike, type Context, type DynTable } from "./values.ts";
import { bodyOf, type Arenas, type BodyId, type ClassId, type InstanceId, type LocalId } from "./arenas.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };


// A local generic function's name stands for the function it was lifted to, `generic`. `id`
// numbers it in its check, naming its slot in the IR; `localId` names it in the compilation's arena.
export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: usize; localId: LocalId; generic?: BodyId };

// Every function to compile: the top-level ones, then each class's constructor and methods.
// A checked program: the functions to compile, the tables its check filled in, and the
// compilation it was checked in.
// `warnings`: what the build reports without failing, in source order.
export type Checked = { instances: InstanceId[]; tables: Tables; warnings: CompileError[] };

// The instances a checked program compiles, read from its arena.
// The tables a new instance starts with, each empty.
export function emptyTables(): Pick<Instance, "types" | "locals" | "calls" | "setters" | "coercions" | "jumps" | "borrowsFrom" | "raises" | "caught" | "consumes" | "patterns" | "copiesOut"> {
  return {
    types: new NodeMap<Expr, Type>(), locals: new NodeMap<Expr | Stmt | Param | ObjectProp, LocalId>(), calls: new NodeMap<Expr, InstanceId>(), setters: new NodeMap<Expr, InstanceId>(),
    coercions: new NodeMap<Expr, Type>(), jumps: new NodeMap<Stmt, Stmt>(), borrowsFrom: new NodeMap<Expr, Expr[]>(),
    raises: new NodeMap<Expr | Stmt, { from: Type; to: Type; wrapper?: ClassType; param?: Type; via?: InstanceId }>(), caught: new NodeMap<Stmt, Type>(),
    consumes: new Set<usize>(), patterns: new NodeMap<Pattern, PatternInfo>(), copiesOut: new NodeSet<Expr>(),
  };
}

// One compiled function: a body checked with concrete types, and the tables codegen reads
// to lower it. `symbol` names it in the IR.
export type Instance = {
  // Its place in the compilation's arena, which tables of instances key on.
  id: InstanceId;
  body: BodyId;
  symbol: string;
  // What a generic body's type parameters stand for in this instance. An instance holding a
  // type parameter is the definition check, which is never compiled.
  bindings: Map<string, Type>;
  concrete: boolean;
  // How many generic instantiations led to this one, which bounds instantiations that never end.
  depth: usize;
  // Its return type, written or inferred.
  returns: Type;
  // Its parameters' and return types with their brands kept, which lowering forgets, for the
  // type of a closure made from it.
  branded?: { params: Map<LocalId, Type>; returns: Type };
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
  // Each place whose value is handed over rather than copied, which leaves it empty, by node id.
  consumes: Set<usize>;
  // Whether the body stores a value holding references into `this`, set by its move check; a
  // call of a method that doesn't can't keep what it lends, so its arguments may be anything.
  keeps?: boolean;
  // The bodies whose calls of this one, made while it was being checked, took it to keep nothing.
  keepsAssumedBy?: Set<InstanceId>;
  // What each match pattern tests, and the type of the value it meets.
  patterns: NodeMap<Pattern, PatternInfo>;
  // Each read of a shared value's plain field: a copy made under its lock, not a place.
  copiesOut: NodeSet<Expr>;
  // Statements this instance never reaches, as a check its type argument rules out guards:
  // checked, but not compiled.
  unreached?: NodeSet<Stmt>;
  // Calls of an interface's optional method, and tests for one, whose method this instance's
  // concrete type leaves out.
  absent?: NodeSet<Expr>;
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
  // Each field read a check narrowed, and the type it reads as declared. Narrowed to one member,
  // its place is inside its union's payload; to several, its value is a copy.
  narrowedFields?: NodeMap<Expr, Type>;
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
  // Each `for...of` over an `Iterable<T>` parameter standing for a class here, and the
  // `[Symbol.iterator]()` call it loops over instead. It isn't written into the body, which every
  // instance shares.
  iterators?: NodeMap<Stmt, Expr>;
};

type Jump = Extract<Stmt, { kind: "break" | "continue" }>;

// What a `break` or `continue` can name: a loop, a switch, or a labeled statement, whose
// `loop` is the loop it labels, if any. A match arm's block is where its `return`s go, with
// whether the match gives a value and what they gave.
// `stmt` and `loop` are stand-ins carrying the statement's id and span, which is all a jump
// records of where it goes.
type Target = { stmt: Stmt; kind: "loop" | "switch" | "label" | "arm"; label?: string; loop?: Stmt; facts?: usize; wanted?: boolean; gives?: [Expr, Type][] };

// The statements a destructuring assignment becomes: every part read, then every target written.
type Destructured = { reads: Stmt[]; writes: Stmt[] };

// A statement's stand-in as a jump's target: its id and span.
function standIn(s: Ref<Stmt>): Stmt {
  return { id: s.id, kind: "empty", start: s.start, end: s.end };
}

// What a closure's local captures, when it captures something.
function capturedFrom(arenas: Ref<Arenas>, at: InstanceId, local: LocalId): LocalId | "this" | undefined {
  const captures = arenas.instanceOf(at).captures;
  return captures !== undefined ? captures.get(local) : undefined;
}

// The instance a closure is written in.
function parentOf(arenas: Ref<Arenas>, at: InstanceId): InstanceId | undefined {
  const closure = bodyOf(arenas, arenas.instanceOf(at)).closure;
  return closure !== undefined ? closure.parent : undefined;
}

// The function declarations of a list, with bodies, that aren't async, by id.
function nestedFunctions(list: Ref<Stmt[]>): usize[] {
  let out: usize[] = [];
  for (const s of list) if (s.kind === "function" && s.body !== undefined && !s.async) out.push(s.id);
  return out;
}

// The names a statement of a list declares.
function declaredNames(s: Ref<Stmt>): string[] {
  return s.kind === "let" ? s.declarations.flatMap((d) => patternNames(d.target)) : s.kind === "function" ? [s.name] : [];
}

// The binding a fact's key names, which is its id as text.
function keyId(key: string): LocalId {
  const n = parseInt(key);
  return (n !== undefined ? n : 0) as LocalId;
}

function copyOptionalScope(scope: Ref<Map<string, Type> | undefined>): Map<string, Type> | undefined {
  return scope === undefined ? undefined : copyScope(scope);
}

// A package's declaration Fish can't type, refused where it is declared, noting the call that reached it.
function refusedJs(message: string, where: Ref<Span>, name: string, at: Span | undefined): CompileError {
  return new CompileError("E1005", message, where.start, where.end, at === undefined ? undefined : { message: `'${name}' is called here`, start: at.start, end: at.end });
}

// Whether a body has type parameters of its own other than lifetimes.
function hasOwnTypeParams(f: Ref<Body>): boolean {
  if (f.typeParams !== undefined) for (const p of f.typeParams) if (!isLifetime(p)) return true;
  return false;
}

// Whether two errors are the same one: a build reports an error once for its place and message.
function sameError(a: Ref<CompileError>, b: Ref<CompileError>): boolean {
  return a.code === b.code && a.start === b.start && a.end === b.end && a.message === b.message;
}

// A class's own methods, getters or setters, by name.
function membersOf(c: Ref<ClassInfo>, table: string): Ref<Map<string, BodyId>> {
  return table === "methods" ? c.methods : table === "getters" ? c.getters : c.setters;
}

// A copy of a scope of type parameters, to put in scope while the original stays the caller's.
function copyScope(scope: Ref<Map<string, Type>>): Map<string, Type> {
  let out = new Map<string, Type>();
  for (const [name, t] of scope) out.set(name, t);
  return out;
}

// The names a function's body uses that its parameters and its body's own top-level declarations
// don't give. A name declared only in an inner block may still mean an outer variable elsewhere,
// so it stays a use.
function freeNames(fn: Ref<Extract<Stmt, { kind: "function" }>>): Set<string> {
  let own = new Set<string>();
  for (const p of fn.params) for (const n of patternNames(p.pattern)) own.add(n);
  if (fn.body !== undefined) {
    for (const s of fn.body) {
      if (s.kind === "let") {
        for (const d of s.declarations) for (const n of patternNames(d.target)) own.add(n);
      } else if (s.kind === "function") own.add(s.name);
    }
  }
  let free = new Set<string>();
  if (fn.body !== undefined) for (const n of identifiers(fn.body)) if (!own.has(n)) free.add(n);
  return free;
}

// Every name written in a piece of syntax.
function identifiers(body: Ref<Stmt[]> | undefined): Set<string> {
  let found = new Set<string>();
  if (body === undefined) return found;
  walk({ of: "stmts", node: body }, (n) => {
    if (n.of === "expr" && n.node.kind === "ident") found.add(n.node.name);
    if (n.of === "pattern" && n.node.kind === "ident") found.add(n.node.name);
    // A shorthand property `{ x }` reads `x` too.
    if (n.of === "objectProp" && n.node.kind === "shorthand") found.add(n.node.name);
  });
  return found;
}

// A pattern as written, roughly, naming the variable that holds the value it destructures.
function patternText(p: Ref<Pattern>): string {
  if (p.kind === "ident") return p.name;
  if (p.kind === "default") return patternText(p.target);
  let parts: string[] = [];
  if (p.kind === "object") {
    for (const q of p.props) parts.push(q.value.kind === "ident" && q.value.name === q.key ? q.value.name : `${typeof q.key === "string" ? q.key : "[]"}: ${patternText(q.value)}`);
    if (p.rest !== undefined) parts.push(`...${patternText(p.rest)}`);
    return `{ ${parts.join(", ")} }`;
  }
  if (p.kind === "array") {
    for (const e of p.elements) parts.push(e !== undefined ? patternText(e) : "");
    if (p.rest !== undefined) parts.push(`...${patternText(p.rest)}`);
    return `[${parts.join(", ")}]`;
  }
  return "_";
}

// What a loop keeps of what it iterates over. An array it borrows is kept as a view with the
// array's layout that owns nothing, so dropping the frame leaves the array to its owner, and
// moving the generator doesn't leave a pointer to the frame behind.
function iterated(typing: Mut<Typing>, instance: Ref<Instance>, e: Ref<Expr>): Type {
  const type = instance.coercions.get(e) ?? instance.types.get(e)!;
  if (typeof type === "string") return type;
  const r = typing.rec(type);
  // A fixed array it borrows is kept as a pointer to where it lives.
  if (r.kind === "fixed" && plainPlace(typing, instance, e)) return typing.refType(type, false);
  // A Map or a Set it borrows is kept as its table's pointer, owning nothing.
  if (r.kind === "map") return borrowed(instance, e) || type !== instance.types.get(e) ? typing.refType(type, false) : type;
  if (r.kind !== "array" || !borrowed(instance, e)) return type;
  const element = typing.refType(r.element, false);
  return typing.objectType([{ name: "a", type: element }, { name: "b", type: "i64" }, { name: "c", type: "i64" }]);
}

// Whether a value lives where codegen can point at it for as long as a loop runs: a variable,
// `this`, a reference, or a field of an object or instance, or an element, of one. A field read
// through a shared value or a Dyn, or out of an Option, is a copy of its own.
function plainPlace(typing: Ref<Typing>, instance: Ref<Instance>, e: Ref<Expr>): boolean {
  if (typing.recOf(instance.types.get(e))?.kind === "ref") return true;
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind !== "member" && e.kind !== "index") return false;
  if (e.kind === "member" && instance.calls.has(e)) return false;
  const outer = typing.recOf(instance.types.get(e.object));
  const object = outer?.kind === "ref" ? typing.recOf(outer.to) : outer;
  const holds = e.kind === "member" ? object?.kind === "object" || object?.kind === "class" : object?.kind === "array" || object?.kind === "fixed";
  return holds && plainPlace(typing, instance, e.object);
}

// Whether an expression reads a value where it lives rather than making one.
function borrowed(instance: Ref<Instance>, e: Ref<Expr>): boolean {
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind === "member") return !instance.calls.has(e) && borrowed(instance, e.object);
  if (e.kind === "index" || e.kind === "nonNull") return borrowed(instance, e.kind === "index" ? e.object : e.expr);
  return false;
}

// `await e`, which the parser reads as a unary operator.
export function isAwait(e: Ref<Expr>): e is Extract<Expr, { kind: "unary" }> {
  return e.kind === "unary" && e.op === "await";
}

// A generator's frame, everything it keeps between `next()` calls: its state, its parameters
// in order, every other variable, then each `for...of` loop's array or generator and its
// position. A closure's loops are its own.
// An async method's object as its future holds it.
function receiverField(typing: Mut<Typing>, self: Ref<NonNullable<Body["self"]>>, lower: boolean): Field {
  const type = self.owned === true ? self.type : typing.refType(self.type, self.mutable);
  return { name: "this", type: lower ? typing.lower(type) : type };
}

// A closure, future or generator type, marked as made for `instance`.
function madeBy<T extends ClosureType | FutureType | GeneratorType>(typing: Mut<Typing>, t: T, symbol: string): T {
  const kind = typing.rec(t).kind;
  typing.madeFor.set(t, `${kind} of ${symbol}`);
  return t;
}

// Gives a local a slot in a frame, once.
function addSlot(l: Ref<Local>, fields: Mut<Field[]>, locals: Mut<Map<LocalId, usize>>): void {
  if (locals.has(l.localId)) return;
  locals.set(l.localId, fields.length);
  fields.push({ name: `${l.name}.${l.id}`, type: l.type });
}

function frameOf(tables: Mut<Tables>, instance: Mut<Instance>, generator: GeneratorType | FutureType) {
  let fields: Field[] = [{ name: "state", type: "i32" }];
  let locals = new Map<LocalId, usize>();
  let loops = new NodeMap<Stmt, usize>();
  // Each `await` keeps the future it awaits in the frame while it is pending.
  let awaits = new NodeMap<Expr, usize>();
  // An async arrow's frame holds what it captured, first, and an async method's its object.
  if (bodyOf(tables.arenas, instance).closure !== undefined) fields.push({ name: "env", type: "void" });
  const self = bodyOf(tables.arenas, instance).self;
  if (self !== undefined && !self.constructor) fields.push(receiverField(tables.typing, self, instance.concrete));
  for (const p of bodyOf(tables.arenas, instance).params) addSlot(tables.arenas.localOf(instance.locals.get(p)!), fields, locals);
  // A local generic function's name holds nothing.
  let named = new Set<LocalId>();
  let kept: LocalId[] = [];
  for (const l of instance.locals.values()) {
    if (named.has(l)) continue;
    named.add(l);
    if (tables.arenas.localOf(l).generic === undefined) kept.push(l);
  }
  kept.sort((a, b) => {
    const x = tables.arenas.localOf(a).id;
    const y = tables.arenas.localOf(b).id;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const l of kept) addSlot(tables.arenas.localOf(l), fields, locals);
  // What the walk meets, in order: each `for...of` loop and each await. They are laid out after
  // it, since laying one out changes the types the walked body is lent from.
  let loopsMet: Stmt[] = [];
  let awaitsMet: Expr[] = [];
  let isLoop: boolean[] = [];
  walkWhile({ of: "stmts", node: bodyOf(tables.arenas, instance).body }, (n) => {
    if (n.of === "expr" && n.node.kind === "arrow") return false;
    if (n.of === "stmt" && n.node.kind === "forOf") {
      loopsMet.push({ ...n.node });
      isLoop.push(true);
    }
    if (n.of === "expr" && isAwait(n.node)) {
      awaitsMet.push({ ...n.node });
      isLoop.push(false);
    }
    return true;
  });
  for (const loop of isLoop) {
    if (!loop) {
      const e = awaitsMet.shift()!;
      const awaited = e.kind === "unary" ? instance.types.get(e.operand)! : "void";
      awaits.set(e, fields.length);
      fields.push({ name: "await", type: awaited });
      continue;
    }
    const s = loopsMet.shift()!;
    const at = fields.length;
    if (s.kind === "forOf") {
      const viaIterator = instance.iterators === undefined ? undefined : instance.iterators.get(s);
      const kept = viaIterator !== undefined ? iterated(tables.typing, instance, viaIterator) : iterated(tables.typing, instance, s.right);
      const ref = typeof kept === "string" ? undefined : tables.typing.rec(kept);
      const held = ref?.kind === "ref" ? ref.to : kept;
      const h = typeof held === "string" ? undefined : tables.typing.rec(held);
      // A `for await` loop holds its generator, or a count on its channel, and the future it awaits.
      if (s.await && h?.kind === "block") {
        fields.push({ name: "loop", type: held });
        fields.push({ name: "at", type: "i64" });
        const received = tables.typing.lower(h.of);
        fields.push({ name: "await", type: tables.typing.leafFuture("receive", received) });
      }
      else if (s.await) {
        // In a generic body, a parameter standing for the generator awaits what its bound's `next()` gives.
        let generator = held;
        if (h !== undefined && h.kind === "param" && h.concrete !== undefined) generator = h.concrete!;
        const g = typeof generator === "string" ? undefined : tables.typing.rec(generator);
        // A boxed one awaits the boxed future its vtable's `next()` gives.
        const next = g?.kind === "generator" ? tables.typing.leafFuture("next", generator)
          : g?.kind === "dyn" ? lentNext(tables.typing, held) : promisedNext(tables.typing, held);
        fields.push({ name: "loop", type: kept });
        fields.push({ name: "at", type: "i64" });
        fields.push({ name: "await", type: next });
      } else {
        fields.push({ name: "loop", type: kept });
        fields.push({ name: "at", type: "i64" });
      }
    }
    loops.set(s, at);
  }
  tables.typing.setFrame(generator, fields);
  instance.frame = { locals, loops, awaits };
}

// Resolves every name and gives every value expression a type. Codegen trusts the result.
// A function body is checked when first needed, so return types can be inferred in any order.
// Names an export can't take in C: its and C++'s keywords and the standard type names a header
// uses. The C functions the runtime and its IR call come in as `check`'s `exportsToC`.
export const C_KEYWORDS = new Set(["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "bool", "true", "false", "size_t", "ptrdiff_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "class", "namespace", "template", "this", "new", "delete", "public", "private", "protected", "virtual", "operator", "friend", "using", "try", "catch", "throw", "typename", "explicit", "mutable", "nullptr", "decltype", "constexpr", "noexcept", "export", "and", "or", "not", "xor"]);

// The name of the function a statement declares, its own or an `export default`'s.
function functionNamed(s: Ref<Stmt>): string | undefined {
  if (s.kind === "function") return s.name;
  if (s.kind === "exportDefault" && s.declaration !== undefined) return functionNamed(s.declaration!);
  return undefined;
}

// A copy of the function a statement declares.
function functionCopy(s: Ref<Stmt>): Declared | undefined {
  if (s.kind === "function") {
    const copy = cloneStmt(s);
    return copy.kind === "function" ? copy : undefined;
  }
  if (s.kind === "exportDefault" && s.declaration !== undefined) return functionCopy(s.declaration!);
  return undefined;
}

// A program setting timers runs on the async runtime, as Node's does, so a sync `main` runs as
// an async one, its timers firing once it returns.
function timersRunAsync(ids: Mut<Ids>, written: Mut<Stmt[]>, timerMains: Mut<Tables["timerMains"]>) {
  let main: Declared | undefined = undefined;
  let declared = new Set<string>();
  for (const s of written) {
    const name = functionNamed(s);
    if (name === undefined) continue;
    declared.add(name);
    if (main === undefined && name === "main") main = functionCopy(s);
  }
  if (main === undefined || main.async) return;
  const timers = holdsNode({ of: "stmts", node: written }, (n) => n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && TIMER_GLOBALS.has(n.node.callee.name) && !declared.has(n.node.callee.name));
  if (!timers) return;
  let returnType: TypeNode | undefined = undefined;
  if (main.returnType !== undefined) {
    const returns = cloneTypeNode(main.returnType!);
    if (returns.kind === "ref" && returns.name === "void") {
      const start = returns.start;
      const end = returns.end;
      returnType = { id: nextId(ids), kind: "ref", name: "Promise", args: [returns], start, end };
    } else returnType = returns;
  }
  let rewrites = new Rewrites();
  timerMains.add(rewrites.replaceFunc(main, { ...main, async: true, returnType }));
  rebuiltStmts(written, rewrites);
}
const TIMER_GLOBALS = new Set(["setTimeout", "setInterval"]);

// Whether a piece of syntax holds a node `found` picks out.
// A node shared by several parents is tried once.
export function holdsNode(root: AnyNode | undefined, found: (n: AnyNode) => boolean): boolean {
  if (root === undefined) return false;
  let seen = new Set<usize>();
  let hit = false;
  walkWhile(root, (n) => {
    if (hit) return false;
    const rawId = nodeIdOf(n);
    if (rawId >= 0) {
      const id = rawId as usize;
      if (seen.has(id)) return false;
      seen.add(id);
    }
    hit = found(n);
    return !hit;
  });
  return hit;
}

// Every name the body of a function declares anywhere, as a variable, a function, a class or a
// parameter, and the type parameters it is generic over.
function declaredIn(f: Ref<{ params: Param[]; body?: Stmt[]; typeParams?: TypeParam[] }>): Set<string> {
  let names = new Set<string>();
  for (const p of f.params) for (const x of patternNames(p.pattern)) names.add(x);
  if (f.typeParams !== undefined) for (const p of f.typeParams) names.add(p.name);
  if (f.body !== undefined) holdsNode({ of: "stmts", node: f.body }, (n) => {
    if (n.of === "stmt") {
      const s = n.node;
      if (s.kind === "let") for (const d of s.declarations) for (const x of patternNames(d.target)) names.add(x);
      if (s.kind === "function") names.add(s.name);
      if (s.kind === "class" && s.name !== undefined) names.add(s.name);
      if (s.kind === "function") {
        for (const p of s.params) for (const x of patternNames(p.pattern)) names.add(x);
        for (const p of s.typeParams) names.add(p.name);
      }
    } else if (n.of === "expr") {
      const e = n.node;
      if (e.kind === "function" && e.name !== undefined) names.add(e.name);
      if (e.kind === "class" && e.name !== undefined) names.add(e.name);
      if (e.kind === "arrow" || e.kind === "function") {
        for (const p of e.params) for (const x of patternNames(p.pattern)) names.add(x);
        for (const p of e.typeParams) names.add(p.name);
      }
    }
    return false;
  });
  return names;
}

// An arrow held by a const, as the function declaration it amounts to.
function arrowFunction(ids: Mut<Ids>, name: string, arrow: Extract<Expr, { kind: "arrow" }>, at: Ref<Span>): Func {
  let body: Stmt[] = [];
  if (Array.isArray(arrow.body)) body = arrow.body;
  else {
    const start = arrow.body.start;
    const end = arrow.body.end;
    body = [{ id: nextId(ids), kind: "return", value: arrow.body, start, end }];
  }
  const f: Func = { id: nextId(ids), kind: "function", name, async: arrow.async, generator: false, macro: false, typeParams: arrow.typeParams, params: arrow.params, returnType: arrow.returnType, throws: arrow.throws, body, start: at.start, end: at.end };
  return f;
}

// A const's function type gives the arrow it holds the parameter, result and error types the
// arrow leaves unwritten, as TypeScript's contextual typing does.
/** @throws {CompileError} */
function typedBy(arrow: Extract<Expr, { kind: "arrow" }>, fn: Signature | undefined): Extract<Expr, { kind: "arrow" }> {
  if (fn === undefined) return arrow;
  if (arrow.params.length > fn.params.length && !fn.params.some((p) => p.rest)) {
    const extra: Ref<Param> = arrow.params[fn.params.length]!;
    const name = extra.pattern.kind === "ident" ? `'${extra.pattern.name}'` : "this parameter";
    throw new CompileError("E0506", `the const's type passes ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, so this arrow can't take ${name}`, extra.start, extra.end);
  }
  let params: Param[] = [];
  for (let i: usize = 0; i < arrow.params.length; i++) {
    const p: Ref<Param> = arrow.params[i]!;
    if (p.type !== undefined || i >= fn.params.length) params.push({ ...p });
    else params.push({ ...p, type: fn.params[i]!.type === undefined ? undefined : cloneTypeNode(fn.params[i]!.type!), optional: p.optional || fn.params[i]!.optional });
  }
  return { ...arrow, params, returnType: arrow.returnType ?? fn.returns, throws: arrow.throws ?? fn.throws };
}

const MEMBERS = new Set(["field", "method", "constructor", "get", "set", "index", "staticBlock"]);

// A macro takes the declaration it is applied to, and no type parameters.
/** @throws {CompileError} */
function macroShape(f: Ref<Declared>) {
  const shape = `as in 'macro function ${f.name.replace(/-fsh\d+$/, "")}(input: Ast): Ast'`;
  if (f.typeParams.length > 0) throw new CompileError("E1103", `a macro takes no type parameters, ${shape}`, f.typeParams[0]!.start, f.typeParams[0]!.end);
  if (f.params.length === 0 || f.params.some((p) => p.rest)) throw new CompileError("E1103", `a macro takes the declaration it is applied to, then any arguments, ${shape}`, f.start, f.end);
  const t = cloneParam(f.params[0]!).type;
  if (t?.kind !== "ref" || (t.name !== "Ast" && t.name !== "AstStmt") || t.args.length > 0) {
    throw new CompileError("E1103", "a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'", f.params[0]!.start, f.params[0]!.end);
  }
  if (f.returnType === undefined) throw new CompileError("E1103", `a macro gives the declarations it makes, so it says so, ${shape}`, f.start, f.end);
}

// A library is checked with `exportsToC` holding the names C and the Fish runtime already use,
// which its exports can't take: it needs no `main`, and its exports cross to C.
// With `macros`, the program is the macros and what they use, checked to run them, with no `main`.
// With `module`, it may be a file another imports, checked on its own, so `main` is optional.
// An error it throws names local declarations as they were written.
/** @throws {CompileError} */
export function check(compilation: Compilation, written: Stmt[], exportsToC: Set<string> | false = false, macros = false, module = false): Checked {
  let checked = checkAll(compilation, written, exportsToC, macros, module);
  let renamed: CompileError[] = [];
  while (checked.warnings.length > 0) renamed.push(named(checked.warnings.shift()!, copyNames(checked.tables.names)));
  while (renamed.length > 0) checked.warnings.push(renamed.shift()!);
  return checked;
}

// The program as checking reads it: the written statements lowered, after std's.
/** @throws {CompileError} */
function lowered(tables: Mut<Tables>, given: Stmt[], library: boolean): Stmt[] {
  let written = given;
  // A macro applies only to a top-level declaration; the top-level ones are expanded already.
  // The first decorator found where no macro reaches, with why.
  let misplaced: { start: usize; end: usize; message: string }[] = [];
  walk({ of: "stmts", node: written }, (n) => {
    if (misplaced.length > 0) return;
    if (n.of === "stmt") {
      const s = n.node;
      if ((s.kind === "function" || s.kind === "typeAlias" || s.kind === "interface" || s.kind === "enum")) {
        const at = firstSpan(s.decorators);
        if (at !== undefined) misplaced.push({ start: at.start, end: at.end, message: "a macro applies to a top-level declaration" });
      }
    } else if (n.of === "classMember") {
      const m = n.node;
      // A member's decorator a top-level class's expansion didn't reach is on a class no macro runs on.
      if (m.kind !== "index" && m.kind !== "staticBlock" && m.decorators.length > 0) misplaced.push({ start: m.decorators[0]!.start, end: m.decorators[0]!.end, message: "a macro on a member applies in a top-level class" });
    }
  });
  if (misplaced.length > 0) throw new CompileError("E1103", misplaced[0]!.message, misplaced[0]!.start, misplaced[0]!.end);
  written = lowerOverloads(tables.ids, written);
  localKeys(written);
  written = [...written, ...hoistLocals(tables, written)];
  lowerKeys(written);
  tables.topKeys = topKeys(written);
  holdsNode({ of: "stmts", node: written }, (n) => {
    if (n.of === "classMember" && n.node.kind === "get" && typeof n.node.name === "string") tables.getterNames.add(n.node.name);
    if (n.of === "objectProp" && n.node.kind === "get" && typeof n.node.key === "string") tables.getterNames.add(n.node.key);
    return false;
  });
  lowerDefaults(tables, written);
  if (!library) timersRunAsync(tables.ids, written, tables.timerMains);
  let std = stdFor(tables, written);
  let program = [...lowerOverloads(tables.ids, std), ...written];
  separatePrivateNames(program);
  return program;
}

// What declaring a program's top-level statements makes, before any body is checked: its
// classes, generic classes and enums, the bodies of its functions and consts, the arrows held by
// typed consts, and the errors declaring them gave.
type TopLevel = { classes: Map<string, ClassId>; templates: Map<string, ClassNode & { name: string }>; enums: Map<string, EnumInfo>; funcs: BodyId[]; macroBodies: Set<BodyId>; typedArrows: { body: BodyId; type: TypeNode; arrow: Span & { throws?: TypeNode }; name: string }[]; errors: CompileError[]; unending: boolean };

// Declares each top-level statement in order, so a name is checked against those before it.
/** @throws {CompileError} */
function declareTop(tables: Mut<Tables>, program: Ref<Stmt[]>, decls: Mut<Declarations>): TopLevel {
  let top: TopLevel = { classes: new Map<string, ClassId>(), templates: new Map<string, ClassNode & { name: string }>(), enums: new Map<string, EnumInfo>(), funcs: [], macroBodies: new Set<BodyId>(), typedArrows: [], errors: [], unending: false };
  for (const s of program) {
    try {
      // A `declare const enum` writes its values, so it is an enum like any other.
      if (s.kind === "declare" && s.body.kind === "enum" && s.body.const) {
        declareEnumIn(tables, top, decls, s.body);
        continue;
      }
      if (s.kind === "enum") {
        declareEnumIn(tables, top, decls, s);
        continue;
      }
      const trait = s.kind === "typeAlias" ? traitAlias(tables.ids, s) : undefined;
      if (s.kind === "typeAlias" && trait === undefined) {
        // An alias's lifetimes, like a class's, are checked and erased.
        if (s.typeParams.some(isLifetime)) decls.slots.set(s.name, s.typeParams.map(isLifetime));
        let alias = cloneTypeAlias(s);
        if (s.typeParams.some(isLifetime)) alias.typeParams = alias.typeParams.filter((p) => !isLifetime(p));
        const named = namedIn(top, decls, s.name);
        addAlias(decls.aliases, alias, named);
        continue;
      }
      if (trait !== undefined) {
        typeName(trait.name, { start: s.start, end: s.end }, decls.aliases.has(trait.name) || namedIn(top, decls, trait.name));
        decls.interfaces.set(trait.name, trait);
        continue;
      }
      if (s.kind === "interface") {
        typeName(s.name, s, decls.aliases.has(s.name) || namedIn(top, decls, s.name));
        decls.interfaces.set(s.name, cloneInterface(s));
        if (s.jsClass !== undefined) tables.jsClasses.set(s.name, cloneInterface(s));
        continue;
      }
      if (s.kind === "class" && s.name !== undefined) {
        typeName(s.name, s, decls.aliases.has(s.name) || namedIn(top, decls, s.name));
        // A class's lifetimes are checked and erased, never instanced, so they are set aside.
        const node = { ...s, id: nextId(tables.ids), name: s.name, typeParams: s.typeParams.filter((p) => !isLifetime(p)) };
        if (s.typeParams.some(isLifetime)) decls.slots.set(s.name, s.typeParams.map(isLifetime));
        if (node.typeParams.length > 0) top.templates.set(s.name, node);
        else {
          const declaredClass = declareClass(tables, node);
          top.classes.set(s.name, declaredClass);
        }
        const declared = top.classes.get(s.name);
        if (declared === undefined) continue;
        const type = tables.arenas.classOf(declared).type;
        const rust = tables.rust.classNodes.get(s);
        if (rust !== undefined) tables.typing.setRust(type, { ...rust });
        // A Rust type declaring no constructor is never made with `new`, so its handle needs no
        // assigning in the empty one it is given.
        if (rust !== undefined && tables.arenas.bodyOf(tables.arenas.classOf(declared).constructor).rust === undefined) {
          clearRequired(tables, declared);
        }
        // A `static readonly` field is a top-level const named `C.x`, which no source name can be.
        let statics: { name: string; init: Expr; type: TypeNode | undefined; start: usize; end: usize }[] = [];
        for (const f of tables.arenas.classOf(declared).staticFields.values()) statics.push({ name: f.name, init: cloneExpr(f.init!), type: f.type === undefined ? undefined : cloneTypeNode(f.type!), start: f.start, end: f.end });
        while (statics.length > 0) {
          const f = statics.shift()!;
          const start = f.init.start;
          const end = f.init.end;
          const giving: Stmt = { id: nextId(tables.ids), kind: "return", value: f.init, start, end };
          const made: Func & { comptime: "const"; owner: ClassType } = { id: nextId(tables.ids), kind: "function", async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${s.name}.${f.name}`, returnType: f.type, body: [giving], start: f.start, end: f.end, comptime: "const", owner: type };
          top.funcs.push(addBodyTo(tables, made));
        }
        continue;
      }
      // `declare function f(...): T;` names a C function, called inside `unsafe`.
      if (s.kind === "declare" && s.body.kind === "function" && !hasBody(s.body)) {
        const rest = s.body.params.find((p) => p.rest);
        if (rest !== undefined) throw unsupported("variadic C functions", rest);
        const madeId = nextId(tables.ids);
        const declared = addBodyTo(tables, { ...s.body, id: madeId, body: [] });
        markForeign(tables, declared, undefined);
        top.funcs.push(declared);
        continue;
      }
      // `export function f() {}` is an ordinary function, and in a library a C function too; an
      // exported macro is for other files.
      if (s.kind === "export" && s.body.kind === "function" && hasBody(s.body)) {
        if (s.body.macro) macroShape(s.body);
        let exported: BodyId;
        if (s.body.macro) exported = addBodyTo(tables, withBody({ ...s.body }));
        else {
          const madeId = nextId(tables.ids);
          exported = addBodyTo(tables, withBody({ ...s.body, id: madeId }));
          markExported(tables, exported);
        }
        if (s.body.macro) top.macroBodies.add(exported);
        top.funcs.push(exported);
        continue;
      }
      const declaration = unsupportedDeclaration(s);
      if (declaration !== undefined) throw declaration;
      if (s.kind === "empty") continue;
      // A top-level `const` is computed while compiling: comptime runs a function of no parameters
      // giving its value. A `comptime { }` block is a function giving nothing, run the same way.
      const none: TypeParam[] = [];
      const noParams: Param[] = [];
      const made = { kind: "function" as const, async: false, generator: false, macro: false, typeParams: none, params: noParams, start: s.start, end: s.end };
      if (s.kind === "let" && s.keyword === "const") {
        for (const d of s.declarations) {
          if (d.target.kind !== "ident") throw unsupported("destructuring top-level consts", d.target);
          if (["undefined", "console", "print"].includes(d.target.name)) throw new CompileError("E0407", `'${d.target.name}' already names something every program has; call the const something else`, d.target.start, d.target.end);
          if (d.init === undefined) throw new CompileError("E0404", "a top-level 'const' needs its value", d.start, d.end);
          // An arrow held by a const is the function declaration it amounts to; the const's
          // written type is checked against it once its body is.
          if (d.init.kind === "arrow") {
            const generic = d.init.typeParams.some((p) => !isLifetime(p));
            const signature = signatureIn(program, d.type);
            const genericType = signature !== undefined && signature.typeParams.some((p) => !isLifetime(p));
            if (d.type !== undefined && (generic || genericType)) throw new CompileError("E0801", "a const holding a generic arrow takes its type from the arrow; drop the const's written type", d.type.start, d.type.end);
            const typed = typedBy({ ...d.init }, signature);
            const lifted = arrowFunction(tables.ids, d.target.name, typed, { start: d.start, end: d.end });
            const body = addBodyTo(tables, lifted);
            top.funcs.push(body);
            if (d.type !== undefined) top.typedArrows.push({ body, type: cloneTypeNode(d.type!), arrow: { start: d.init.start, end: d.init.end, throws: d.init.throws === undefined ? undefined : cloneTypeNode(d.init.throws!) }, name: d.target.name });
            continue;
          }
          const giving: Stmt = { id: nextId(tables.ids), kind: "return", value: cloneExpr(d.init), start: d.init.start, end: d.init.end };
          const constant: Func & { comptime: "const" } = { ...made, id: nextId(tables.ids), name: `const ${d.target.name}`, returnType: d.type === undefined ? undefined : cloneTypeNode(d.type!), body: [giving], start: d.start, end: d.end, comptime: "const" as const };
          top.funcs.push(addBodyTo(tables, constant));
        }
        continue;
      }
      if (s.kind === "comptime") {
        const block: Func & { comptime: "block" } = { ...made, id: nextId(tables.ids), name: `comptime ${s.start}`, returnType: undefined, body: [...s.body], comptime: "block" as const };
        top.funcs.push(addBodyTo(tables, block));
        continue;
      }
      if (s.kind === "let") throw new CompileError("E0404", "a top-level 'let' would be a global that changes; use 'const', whose value is computed while compiling, or a const holding an Atomic or a Lock", s.start, s.end);
      // Top-level code with side effects belongs in main(); the migration lint moves it there.
      if (s.kind !== "function") throw new CompileError("E0404", "only declarations are allowed at the top level; move this into main()", s.start, s.end);
      const rust = tables.rust.names.get(s);
      if (rust !== undefined) {
        const madeId = nextId(tables.ids);
        const foreign = addBodyTo(tables, { ...s, id: madeId, body: [] });
        const symbol = { ...rust };
        markForeign(tables, foreign, symbol);
        top.funcs.push(foreign);
        continue;
      }
      if (s.js !== undefined) {
        const madeId = nextId(tables.ids);
        const body = addBodyTo(tables, { ...s, id: madeId, body: [] });
        tables.jsBodies.set({ ...s }, body);
        top.funcs.push(body);
        continue;
      }
      if (!hasBody(s)) throw new CompileError("E0410", `'${s.name}' has no implementation; follow its overload signatures with a 'function ${s.name}' that has a body`, s.start, s.end);
      if (s.macro) macroShape(s);
      const declared = addBodyTo(tables, withBody({ ...s }));
      if (s.macro) top.macroBodies.add(declared);
      top.funcs.push(declared);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      recoverInto(top, e);
    }
  }
  return top;
}

// A declaration given its statements: one checked as having a body has them.
function withBody(d: Declared): Func {
  const body: Stmt[] = d.body !== undefined ? [...d.body!] : [];
  return { ...d, body };
}

/** @throws {CompileError} */
function declareEnumIn(tables: Mut<Tables>, top: Mut<TopLevel>, decls: Ref<Declarations>, e: Ref<Extract<Stmt, { kind: "enum" }>>): void {
  typeName(e.name, { start: e.start, end: e.end }, decls.aliases.has(e.name) || namedIn(top, decls, e.name));
  const declared = declareEnum(tables, e);
  top.enums.set(e.name, declared);
}

// A C or Rust function's body, which the program declares and doesn't write.
function markForeign(tables: Mut<Tables>, id: BodyId, rust: Body["rust"]): void {
  let record = tables.arenas.bodyMut(id);
  record.foreign = true;
  if (rust !== undefined) record.rust = rust;
}

function markExported(tables: Mut<Tables>, id: BodyId): void {
  let record = tables.arenas.bodyMut(id);
  record.exported = true;
}

// A Rust type's handle, which no constructor of its own assigns.
function clearRequired(tables: Mut<Tables>, id: ClassId): void {
  let info = tables.arenas.classMut(id);
  info.required.clear();
}

function addBodyTo(tables: Mut<Tables>, f: Func): BodyId {
  return tables.arenas.addBody(f).bodyId;
}

// Whether a type of this name is declared so far.
function namedIn(top: Ref<TopLevel>, decls: Ref<Declarations>, name: string): boolean {
  return top.classes.has(name) || top.templates.has(name) || decls.interfaces.has(name) || top.enums.has(name);
}

/** @throws {CompileError} */
function recoverInto(top: Mut<TopLevel>, e: CompileError): void {
  if (e.code === "E0113") top.unending = true;
  for (const x of top.errors) if (x.start === e.start && x.end === e.end && x.message === e.message) return;
  top.errors.push(e);
}

// The parts of a function type a const's written type gives an arrow; a declared function's
// result type may be left unwritten.
type Signature = { typeParams: TypeParam[]; params: Param[]; returns: TypeNode | undefined; throws: TypeNode | undefined };

// The function type a const's written type is, through an alias taking no type parameters, or
// through `typeof` a top-level function or arrow const.
function signatureIn(program: Ref<Stmt[]>, type: Ref<TypeNode | undefined>): Signature | undefined {
  if (type === undefined) return undefined;
  if (type.kind === "query") {
    const target = identTypeName(type.target);
    return target !== undefined ? declaredSignatureIn(program, target) : undefined;
  }
  if (type.kind === "function") return signatureFrom(type.typeParams, type.params, type.returns, type.throws);
  if (type.kind !== "ref" || type.args.length > 0) return undefined;
  for (const s of program) {
    if (s.kind !== "typeAlias" || s.name !== type.name || s.typeParams.length > 0) continue;
    return functionSignature(s.type);
  }
  return undefined;
}

function identTypeName(t: Ref<TypeNode>): string | undefined {
  return t.kind === "ref" ? t.name : undefined;
}

function functionSignature(t: Ref<TypeNode>): Signature | undefined {
  return t.kind === "function" ? signatureFrom(t.typeParams, t.params, t.returns, t.throws) : undefined;
}

// The parameter, result and error types a top-level function or arrow const writes, for `typeof`.
function declaredSignatureIn(program: Ref<Stmt[]>, name: string): Signature | undefined {
  for (const s of program) {
    const found = s.kind === "export" ? signatureNamed(s.body, name) : signatureNamed(s, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

// What `typeof name` reads in one statement: a function of that name, or a const of that name
// holding a function or an arrow.
function signatureNamed(d: Ref<Stmt>, name: string): Signature | undefined {
  if (d.kind === "function") return d.name === name ? signatureFrom(d.typeParams, d.params, d.returnType, d.throws) : undefined;
  if (d.kind !== "let" || d.keyword !== "const") return undefined;
  for (const x of d.declarations) {
    if (boundName(x.target) !== name) continue;
    return x.init === undefined ? undefined : valueSignature(x.init!);
  }
  return undefined;
}

function valueSignature(e: Ref<Expr>): Signature | undefined {
  if (e.kind === "arrow") return signatureFrom(e.typeParams, e.params, e.returnType, e.throws);
  if (e.kind === "function") return signatureFrom(e.typeParams, e.params, e.returnType, undefined);
  return undefined;
}

function boundName(p: Ref<Pattern>): string | undefined {
  return p.kind === "ident" ? p.name : undefined;
}

// A signature made of copies of a function type's or a declaration's parts.
function signatureFrom(typeParams: Ref<TypeParam[]>, params: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>): Signature {
  let copied: TypeParam[] = [];
  for (const p of typeParams) copied.push(cloneTypeParam(p));
  return { typeParams: copied, params: cloneParams(params), returns: returns !== undefined ? cloneTypeNode(returns) : undefined, throws: throws !== undefined ? cloneTypeNode(throws) : undefined };
}

/** @throws {CompileError} */
function checkAll(compilation: Compilation, written: Stmt[], exportsToC: Set<string> | false, macros: boolean, module: boolean): Checked {
  let tables = newTables(compilation);
  let decls = newDeclarations();
  let program: Stmt[] = [];
  let top: TopLevel | undefined = undefined;
  try {
    program = lowered(tables, written, exportsToC !== false);
    top = declareTop(tables, program, decls);
  } catch (e) {
    throw e instanceof CompileError ? named(e, copyNames(tables.names)) : e;
  }
  let checker = new Checker(tables, program, top!, decls, exportsToC, macros, module);
  let outcome: { instances: InstanceId[]; warnings: CompileError[] } | undefined = undefined;
  try {
    checker.prepare();
    outcome = checker.run();
  } catch (e) {
    throw e instanceof CompileError ? named(e, copyNames(checker.tables.names)) : e;
  }
  return { instances: outcome!.instances, tables: checker.tables, warnings: outcome!.warnings };
}

class Checker implements RegistryHost, GenericClassesHost, InstancingHost, ResolverHost, EnumHost {
  library: boolean;
  // The C names a library's exports can't take.
  takenInC: Set<string>;
  macros: boolean;
  module: boolean;
  tables: Tables;
  program: Stmt[];
  funcs: BodyId[];
  // The functions that are macros, compiled only where macros are checked to run.
  macroBodies: Set<BodyId>;
  // Arrows held by consts with a written type, checked against it.
  typedArrows: { body: BodyId; type: TypeNode; arrow: Span & { throws?: TypeNode }; name: string }[];
  classes: Map<string, ClassId>;
  // Generic classes, declared again for each set of type arguments they are used with.
  templates: Map<string, ClassNode & { name: string }>;
  // The program's aliases, interfaces and lifetimes, which nothing changes once declared.
  decls: Declarations;
  enums: Map<string, EnumInfo>;
  byName: Map<string, BodyId>;
  main: BodyId | undefined;
  // The pairs of a type and an interface being checked, each taken as satisfied while it is.
  assuming: Set<string>;
  registryState: RegistryState;
  genericClassesState: GenericClassesState;
  resolverState: ResolverState;
  // The instance being checked, which new instantiations count their depth from.
  beingChecked: InstanceId | undefined;
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
  placeholders: NodeMap<Expr, Type>;
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
  refused: Refused[] = [];
  // Each such `try`'s error, with the bodies its block calls.
  tryCallees: [CompileError, BodyId[]][] = [];
  // The error each failed body's check gave, which a call of it gives again rather than another.
  failed = new Map<BodyId, CompileError>();

  constructor(tables: Tables, program: Stmt[], top: TopLevel, decls: Declarations, exportsToC: Set<string> | false, macros: boolean, module: boolean) {
    this.tables = tables;
    this.decls = decls;
    this.library = exportsToC !== false;
    this.takenInC = exportsToC !== false ? exportsToC : new Set<string>();
    this.macros = macros;
    this.module = module;
    this.program = program;
    this.funcs = top.funcs;
    this.macroBodies = top.macroBodies;
    this.typedArrows = top.typedArrows;
    this.classes = top.classes;
    this.templates = top.templates;
    this.enums = top.enums;
    this.errors = top.errors;
    this.unending = top.unending;
    this.byName = new Map<string, BodyId>();
    this.main = undefined;
    this.beingChecked = undefined;
    this.assuming = new Set<string>();
    this.registryState = new RegistryState();
    this.genericClassesState = new GenericClassesState();
    this.resolverState = new ResolverState();
    this.done = new Set<InstanceId>();
    this.rustTypes = new Map<string, string>();
    this.views = new Map<InstanceId, Type>();
    this.demands = new NodeMap<Stmt, Integer>();
    this.candidates = new Map<LocalId, Stmt>();
    this.demanded = 0;
    this.instancingState = new InstancingState();
    this.querying = new Set<string>();
    this.placeholders = new NodeMap<Expr, Type>();
    this.broken = new NodeSet<Stmt>();
    this.continued = new NodeSet<Stmt>();
    this.inProgress = new Set<InstanceId>();
    this.nextLocal = 0;
    this.closures = [];
    this.closureBodies = new TypeMap<ClosureType, InstanceId>();
  }

  // Names the program's functions and finds `main`, before any body is checked.
  /** @throws {CompileError} */
  prepare(this: Mut<this>): void {
    for (const id of [...this.funcs]) {
      const f = this.tables.arenas.bodyOf(id);
      try {
        // A tag takes its strings, then its values as a rest parameter.
        const tag = f.params.length === 2 && tagStrings(f.params[0]) && f.params[1]!.rest;
        if (!tag && f.params.length === 2 && f.params[1]!.rest && (f.params[0]!.comptime || refNamed(f.params[0]!.type, "TemplateStringsArray"))) {
          const strings: Ref<Param> = f.params[0]!;
          throw new CompileError("E1107", `'${f.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, strings.start, strings.end);
        } else if (!tag && f.params.length > 0 && f.params[0]!.comptime && f.params[f.params.length - 1]!.rest) {
          const rest: Ref<Param> = f.params[f.params.length - 1]!;
          throw new CompileError("E1102", "a function with comptime parameters can't take a rest parameter yet, unless it is a tag, whose values follow its strings, as in 'comptime strings: TemplateStringsArray, ...values: T[]'", rest.start, rest.end);
        }
        const named = f.name.startsWith("const ") ? f.name.slice("const ".length as i64) : f.name;
        if (this.byName.has(f.name) || this.byName.has(named) || this.byName.has(`const ${named}`) || this.classes.has(named) || this.templates.has(named) || this.enums.has(named)) throw new CompileError("E0402", `'${named}' is already defined`, f.start, f.end);
        this.byName.set(f.name, f.bodyId);
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        this.recover(e);
      }
    }
    // Overloads are lowered on the tree, where an implementation lists its signatures' names;
    // as a body it names them by id.
    for (const id of [...this.funcs]) {
      const names = this.tables.arenas.bodyOf(id).overloadNames;
      if (names === undefined) continue;
      let ids: BodyId[] = [];
      for (const w of names) ids.push(this.byName.get(w)!);
      let body = this.tables.arenas.bodyMut(id);
      body.overloads = ids;
    }
    // A body using a declaration that failed would only say it can't find it.
    this.stopOnErrors();
    this.main = this.byName.get("main");
    if (this.main === undefined && !this.library && !this.macros && !this.module) throw new CompileError("E0405", "no main() function; execution starts there", 0, 0);
    for (const c of [...this.classes.values()]) this.registry().register(c);
  }

  // Checks a method changing an object that holds references, unless it is being checked or
  // its check failed, so whether its body keeps what it is lent is known; a failed check is
  // reported where the method itself is checked.
  /** @throws {CompileError} */
  keepsKnown(this: Mut<this>, target: InstanceId, caller: InstanceId) {
    const callee = this.tables.arenas.instanceOf(target);
    if (callee.keeps !== undefined || this.done.has(target)) return;
    const f = bodyOf(this.tables.arenas, callee);
    const bodyId = f.bodyId;
    if (f.self === undefined || !f.self.mutable || f.self.constructor === true || !this.tables.typing.holdsRef(f.self.type)) return;
    if (this.failed.has(bodyId)) return;
    // One still being checked, as a body calling itself is, is taken to keep nothing, which its
    // own move check then holds it to.
    if (this.inProgress.has(target)) {
      let held = this.tables.arenas.instanceMut(target);
      held.keeps = false;
      if (held.keepsAssumedBy !== undefined) held.keepsAssumedBy.add(caller);
      else {
        let assumed = new Set<InstanceId>();
        assumed.add(caller);
        held.keepsAssumedBy = assumed;
      }
      return;
    }
    try {
      this.checkBody(target);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      // Checked early here, out of its turn, it is checked again in its turn, which reports why.
      this.failed.delete(bodyId);
    }
  }

  // Whether a class, class template, interface or enum has a name.
  typeNamed(name: string): boolean {
    return this.classes.has(name) || this.templates.has(name) || this.decls.interfaces.has(name) || this.enums.has(name);
  }

  /** @throws {CompileError} */
  recover(this: Mut<this>, e: CompileError): void {
    if (e.code === "E0113") this.unending = true;
    for (const x of this.errors) if (x.start === e.start && x.end === e.end && x.message === e.message) return;
    this.errors.push(e);
  }

  // A callee only accounts for a `try` when its failure is reported itself: a recursive function's
  // failure may be that very `try`'s.
  private followsOn(e: Ref<CompileError>): boolean {
    let claimed = false;
    for (const x of this.claimErrors) if (sameError(x, e)) claimed = true;
    if (!claimed) {
      for (const r of this.refused) if (e.message.includes(`'${r.type}'`) && e.message.includes(`'${r.trait}'`) && e.message.includes(r.reason)) return true;
    }
    for (const [x, callees] of this.tryCallees) {
      if (!sameError(x, e)) continue;
      for (const b of callees) {
        const failure = this.failed.get(b);
        if (failure === undefined || this.tables.arenas.bodyOf(b).throws !== undefined) continue;
        let tried = false;
        for (const [y] of this.tryCallees) if (sameError(y, failure)) tried = true;
        if (!tried) return true;
      }
      return false;
    }
    return false;
  }

  /** @throws {CompileError} */
  stopOnErrors(this: Mut<this>): void {
    let held: CompileError[] = [];
    let rest: CompileError[] = [];
    while (this.errors.length > 0) {
      const e = this.errors.shift()!;
      if (this.followsOn(e)) rest.push(e);
      else held.push(e);
    }
    // Errors are never all held back, or a program that failed would build.
    let reported = held.length > 0 ? held : rest;
    if (reported.length === 1) throw reported.shift()!;
    if (reported.length > 1) {
      reported.sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
      throw compileErrors(reported);
    }
  }

  // The error a body's check failed with, when it did.
  failure(f: Ref<Body>): CompileError | undefined {
    return this.failed.get(f.bodyId);
  }

  // The modules that call back into the checker, each made over it where it is used; what
  // they keep between uses is the checker's.
  registry(this: Mut<this>): Registry<Checker> {
    return new Registry(this);
  }

  genericClasses(this: Mut<this>): GenericClasses<Checker> {
    return new GenericClasses(this);
  }

  resolver(this: Mut<this>): Resolver<Checker> {
    return new Resolver(this);
  }

  instancing(this: Mut<this>): Instancing<Checker> {
    return new Instancing(this);
  }

  // A class's members, for interface satisfaction.
  members(this: Mut<this>): Members {
    return new ClassMembers(this);
  }

  /** @throws {CompileError} */
  resolveType(this: Mut<this>, t: TypeNode): Type {
    return this.resolver().resolveType(t);
  }

  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type {
    return this.resolver().resolveIn(scope, t);
  }

  /** @throws {CompileError} */
  resolveSigned(this: Mut<this>, f: BodyId, scope: Ref<Map<string, Type>>, t: Ref<TypeNode>): Type {
    const sight = this.resolver().signatureSight(f);
    const outer = this.resolver().enterSight(sight);
    try {
      return this.resolveIn(scope, t);
    } finally {
      this.resolverState.sight = outer;
    }
  }

  /** @throws {CompileError} */
  paramTypeIn(this: Mut<this>, f: BodyId, scope: Ref<Map<string, Type>>, i: usize): Type {
    const sig = cloneSignature(this.tables.arenas.bodyOf(f));
    const sight = this.resolver().signatureSight(f);
    const outerSight = this.resolver().enterSight(sight);
    const outerScope = this.resolver().enterScope(copyScope(scope));
    try {
      return this.paramType(sig.params[i]!, sig.self !== undefined && sig.self.constructor);
    } finally {
      this.resolverState.scope = outerScope;
      this.resolverState.sight = outerSight;
    }
  }

  /** @throws {CompileError} */
  initializerType(this: Mut<this>, body: BodyId): Type {
    const id = this.instanceOf(body);
    this.checkBody(id);
    const instance = this.tables.arenas.instanceOf(id);
    return this.tables.typing.widenEnum(instance.branded?.returns ?? instance.returns);
  }

  /** @throws {CompileError} */
  paramType(this: Mut<this>, p: Ref<Param>, property: boolean): Type {
    return this.resolver().paramType(p, property);
  }

  // A body's instance with no type arguments given, and the instance its definition is checked as.
  /** @throws {CompileError} */
  instanceOf(this: Mut<this>, f: BodyId): InstanceId {
    const sig = cloneSignature(this.tables.arenas.bodyOf(f));
    return this.instancing().instanceOf(sig).id;
  }

  /** @throws {CompileError} */
  definition(this: Mut<this>, f: BodyId): InstanceId {
    const sig = cloneSignature(this.tables.arenas.bodyOf(f));
    return this.instancing().definition(sig).id;
  }

  classNames(at: usize): string[] {
    return this.reached([...this.classes.keys(), ...this.templates.keys()], at);
  }

  register(this: Mut<this>, c: ClassId): void {
    this.registry().register(c);
  }

  /** @throws {CompileError} */
  layout(this: Mut<this>, c: ClassId): void {
    this.registry().layout(c);
  }

  /** @throws {CompileError} */
  classNamed(this: Mut<this>, name: string, args: Type[], at: Span): ClassType | undefined {
    return this.genericClasses().classNamed(name, args, at);
  }

  /** @throws {CompileError} */
  fieldsLaid(this: Mut<this>, c: ClassType): boolean {
    const id = this.registry().classOf(c).classId;
    return this.registry().layout(id);
  }

  /** @throws {CompileError} */
  valueType(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type {
    return this.valueTypeOf(name, at, shadowed);
  }

  // An interface is met by shape, as a conditional type's `extends` asks of it.
  /** @throws {CompileError} */
  conforms(this: Mut<this>, from: Type, to: Type, at: Span): boolean {
    const trait = this.recOf(to);
    return trait?.kind === "interface" ? unsatisfied(from, to as InterfaceType, this.members(), at) === undefined : this.tables.typing.fits(from, to);
  }

  typeNames(at: usize): string[] {
    return this.reached([...this.decls.aliases.keys(), ...this.classes.keys(), ...this.templates.keys(), ...this.decls.interfaces.keys(), ...this.enums.keys()], at);
  }

  // A generic enum's variant made with other type arguments, while lowering.
  /** @throws {CompileError} */
  variantInstance(this: Mut<this>, v: VariantType, args: Type[]): VariantType {
    const r = this.tables.typing.rec(v);
    const at = this.checkingAt();
    return this.resolver().enumInstance(r.enum, args, at).variants.get(r.member)!;
  }

  /** @throws {CompileError} */
  interfaceInstance(this: Mut<this>, t: InterfaceType, args: Type[]): InterfaceType {
    return this.resolver().interfaceInstance(t, args);
  }

  // A class first made while lowering is reported at the function being checked.
  /** @throws {CompileError} */
  classInstance(this: Mut<this>, c: ClassType, args: Type[]): ClassType {
    const at = this.checkingAt();
    const name = this.tables.typing.rec(c).generic!.name;
    return this.genericClasses().classNamed(name, args, at, true)!;
  }

  /** @throws {CompileError} */
  makeNeededInstances(this: Mut<this>) {
    while (this.tables.typing.needed.length > 0) {
      const n = this.tables.typing.needed.shift()!;
      if (n.kind === "class") this.classInstance(n.c, n.args);
      else if (n.kind === "interface") this.interfaceInstance(n.t, n.args);
      else if (n.kind === "variant") this.variantInstance(n.v, n.args);
      else this.resolver().remakeRecursive(n.t, n.args);
    }
  }

  /** @throws {CompileError} */
  replaced(this: Mut<this>, t: Type, swap: Ref<TypeMap<Type, Type>>): Type {
    const out = this.tables.typing.replaced(t, swap);
    if (this.tables.typing.needed.length === 0) return out;
    this.makeNeededInstances();
    return this.replaced(t, swap);
  }

  checking(): InstanceId | undefined {
    return this.beingChecked;
  }

  // Where the function being checked is written, which an error made while lowering points at.
  private checkingAt(): Span {
    if (this.beingChecked === undefined) return { start: 0, end: 0 };
    const f = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(this.beingChecked));
    return { start: f.start, end: f.end };
  }

  /** @throws {CompileError} */
  classParams(f: Ref<Body>): TypeParam[] {
    let out: TypeParam[] = [];
    if (f.scope === undefined || f.scope.size === 0 || f.owner === undefined) return out;
    // The class's node is there before it is laid out, which reading its type parameters doesn't need.
    for (const p of this.tables.arenas.classOf(this.registryState.infoOf.get(f.owner)!).node.typeParams) out.push(cloneTypeParam(p));
    return out;
  }

  // Comptime runs a function only once the checker has been through it.
  /** @throws {CompileError} */
  ensureChecked(this: Mut<this>, id: InstanceId): boolean {
    if (this.inProgress.has(id)) return false;
    this.checkBody(id);
    return true;
  }

  /** @throws {CompileError} */
  comptimeArgument(this: Mut<this>, arg: Ref<Expr>): Type {
    return this.comptimeLiteral(arg);
  }

  /** @throws {CompileError} */
  run(this: Mut<this>): { instances: InstanceId[]; warnings: CompileError[] } {

    for (const c of [...this.classes.values()]) this.registry().link(c, new TypeSet<ClassType>());
    this.tables.typing.setJsError(this.tables.arenas.classOf(this.classes.get("JsError"))?.type);
    // Classes are laid out before any body is checked, since checking one may need another's
    // fields. Until the resolver exists, a generic class's instance waits for `start`.
    // Laying out a class may register another, which is laid out in turn, as the map's order has it.
    let laid: usize = 0;
    while (true) {
      let infos: ClassId[] = [];
      for (const c of this.registryState.infoOf.values()) infos.push(c);
      if (laid >= infos.length) break;
      for (let i = laid; i < infos.length; i++) this.registry().layout(infos[i]!);
      laid = infos.length;
    }
    this.genericClasses().start();
    this.genericClasses().define();
    // Aliases are checked once classes are laid out, since one may read a class's fields or a
    // function's inferred result, and so is an enum with no type parameters, made now so a
    // payload naming no type is caught unused.
    this.resolver().validate();
    let plain: string[] = [];
    for (const [name, e] of this.enums) if (e.data !== undefined && e.data!.params.length === 0) plain.push(name);
    for (const name of plain) {
      const e = { ...this.enums.get(name)! };
      const at = { start: e.data!.at.start, end: e.data!.at.end };
      const type = this.resolver().enumInstance(name, [], at).type;
      this.enums.set(name, { ...e, type });
    }
    for (const c of [...this.classes.values()]) this.implementsSignatures(c);
    // An enum with computed members is settled when first read; one nothing reads still reports
    // a bad initializer.
    for (const name of [...this.enums.keys()]) settleEnum(this, name);
    // The classes as declared, and generic classes' definitions; any other is an instance a call made.
    const declaredClasses = new Set<ClassId>([...this.registryState.unsettled]);
    // A class's `implements` claims are checked before any body uses the class, so a refused one is
    // reported at the class rather than at each use.
    for (const c of declaredClasses) {
      try {
        this.registry().claims(c);
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        this.claimErrors.push(e.clone());
        this.recover(e);
      }
    }
    for (const id of [...this.funcs]) {
      try {
        const definition = this.definition(id);
        this.checkBody(definition);
      } catch (e) {
        // A package's function Fish can't type is refused where a program calls it.
        if (this.tables.arenas.bodyOf(id).js === undefined || !(e instanceof CompileError)) {
          // A bad signature fails before the body's check does, and fails each call of it as well.
          if (!(e instanceof CompileError)) throw e;
          if (!this.failed.has(id)) this.failed.set(id, e.clone());
          this.recover(e);
          continue;
        }
        this.tables.typing.jsUncalled.set(cloneSignature(this.tables.arenas.bodyOf(id)), e);
      }
    }
    while (this.typedArrows.length > 0) {
      const { body, type, arrow, name } = this.typedArrows.shift()!;
      try {
        const want = this.resolveType(type);
        const got = this.functionTypeOf(cloneSignature(this.tables.arenas.bodyOf(body)), arrow);
        if (!this.tables.typing.fits(got, want)) throw new CompileError("E0101", `type '${this.tables.typing.show(got)}' is not assignable to type '${this.tables.typing.show(want)}'`, arrow.start, arrow.end);
        // The function type `typeof` gives carries no error type, so the arrow's is checked here.
        const throwsAt = arrow.throws !== undefined ? { start: arrow.throws!.start, end: arrow.throws!.end } : undefined;
        const thrown = arrow.throws !== undefined ? this.resolveType(arrow.throws!) : undefined;
        const wanted = this.recOf(want);
        const allowed = wanted?.kind === "function" ? wanted.throws : undefined;
        if (thrown !== undefined && (allowed === undefined || !this.tables.typing.fits(thrown, allowed))) {
          throw new CompileError("E0602", `'${name}' can throw '${this.tables.typing.show(thrown)}', which its type '${this.tables.typing.show(want)}' doesn't declare; add 'throws ${this.tables.typing.show(thrown)}' to the const's type`, throwsAt!.start, throwsAt!.end);
        }
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        this.recover(e);
      }
    }
    // Once a body has failed, a generic body's or class's instances aren't checked: their
    // definitions were, and an instance's error then is most often one a refused call already
    // reported.
    while (!this.unending && (this.registryState.unsettled.length > 0 || this.instancingState.pending.length > 0)) {
      if (this.errors.length > 0) {
        while (this.instancingState.pending.length > 0) this.instancingState.pending.pop();
        const kept = this.registryState.unsettled.filter((c) => declaredClasses.has(c));
        while (this.registryState.unsettled.length > 0) this.registryState.unsettled.pop();
        for (const c of kept) this.registryState.unsettled.push(c);
        if (this.registryState.unsettled.length === 0 && this.instancingState.pending.length === 0) break;
      }
      try {
        if (this.registryState.unsettled.length > 0) {
          const next = this.registryState.unsettled.shift()!;
          for (const f of this.registry().settle(next)) {
            try {
              const definition = this.definition(f);
            this.checkBody(definition);
            } catch (e) {
              if (!(e instanceof CompileError)) throw e;
              this.recover(e);
            }
          }
        } else {
          const pending = this.instancingState.pending.shift()!;
          this.checkBody(pending);
        }
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        this.recover(e);
      }
    }
    // What follows reads every body's results.
    this.stopOnErrors();
    const mainId = this.main;
    if (mainId !== undefined) {
      const main = cloneSignature(this.tables.arenas.bodyOf(mainId));
      if (main.params.length > 0) throw new CompileError("E0405", "main() takes no parameters", main.start, main.end);
      const mainInstance = this.instanceOf(mainId);
      const started = this.tables.arenas.instanceOf(mainInstance).returns;
      const future = this.recOf(started);
      if ((future !== undefined && future.kind === "future" ? future.gives : started) !== "void") throw new CompileError("E0405", "main() can't return a value yet", main.start, main.end);
    }
    if (this.library) {
      let exported: BodyId[] = [];
      for (const id of this.funcs) if (this.tables.arenas.bodyOf(id).exported === true) exported.push(id);
      for (const f of exported) {
        const definition = this.definition(f);
        this.exportable(definition);
      }
    }
    if (this.library && !this.funcs.some((id) => this.tables.arenas.bodyOf(id).exported === true)) throw new CompileError("E1003", "a library has nothing for C to call; mark functions with 'export'", 0, 0);
    // An abstract member and a template are checked but never compiled; each concrete class's copy is.
    // By node id, as a body's copies share one.
    let compiled = new Set<usize>();
    for (const id of this.funcs) if (!this.macroBodies.has(id) || this.macros) compiled.add(this.tables.arenas.bodyOf(id).id);
    for (const c of [...this.registryState.infoOf.values()]) {
      for (const b of this.registry().bodiesOf(c)) {
        const f = this.tables.arenas.bodyOf(b);
        if (f.abstract !== true && f.template !== true) compiled.add(f.id);
      }
    }
    // So is an instance made for an abstract class, which only a template's check makes.
    let compiledIds: InstanceId[] = [];
    for (const id of this.instancing().all()) {
      const i = this.tables.arenas.instanceOf(id);
      const b = bodyOf(this.tables.arenas, i);
      if (i.concrete && compiled.has(b.id) && b.js === undefined && !checkedOnly(this.tables, i)) compiledIds.push(id);
    }
    for (const c of this.closures) {
      const i = this.tables.arenas.instanceOf(c);
      if (i.concrete && !checkedOnly(this.tables, i)) compiledIds.push(c);
    }
    const tables: Ref<Tables> = this.tables;
    unreached(this.tables.typing, this.tables.equalities, this.tables.arenas, compiledIds, (i) => bodyOf(tables.arenas, i).abstract === true || checkedOnly(tables, i));
    // A package's const whose value has no JS form yet stops the program where it is read.
    const used = earliestOf(this.tables.jsUses);
    if (used !== undefined) throw new CompileError("E1005", "reading this package's const isn't supported yet, as its value has no JS form", used.start, used.end);
    // A package's function called with a value, or giving one, that has no JS form.
    let unconverted: { start: usize; end: usize } | undefined = undefined;
    for (const id of compiledIds) {
      const i = this.tables.arenas.instanceOf(id);
      for (const [k] of i.calls) {
        const x: Ref<Expr> = k;
        if (x.kind !== "call" || !this.tables.jsCalls.has(x)) continue;
        const target = i.calls.get(x);
        const gives = target !== undefined ? this.tables.arenas.instanceOf(target).returns : "void";
        let refused = false;
        for (const a of x.args) if (!refused && !this.tables.typing.jsConverts(crossingType(this.tables.typing, i, a))) refused = true;
        if (!refused && gives !== "void" && !this.tables.typing.jsConverts(gives)) refused = true;
        if (refused && (unconverted === undefined || x.start < unconverted.start)) unconverted = { start: x.start, end: x.end };
      }
    }
    if (unconverted !== undefined) throw new CompileError("E1005", "this call gives a package's function a value with no JS form yet", unconverted.start, unconverted.end);
    // A value given to JS becomes a JS value as the call or write converts it.
    let given: { start: usize; end: usize; from: Type; to: Type }[] = [];
    for (const id of compiledIds) {
      const i = this.tables.arenas.instanceOf(id);
      for (const [k, t] of i.coercions) {
        const x: Ref<Expr> = k;
        if (!this.tables.jsGiven.has(x)) given.push({ start: x.start, end: x.end, from: i.types.get(x) ?? "void", to: t });
      }
    }
    let crossing: { start: usize; end: usize } | undefined = undefined;
    for (const g of given) if (this.intoJs(g.from, g.to) && (crossing === undefined || g.start < crossing.start)) crossing = { start: g.start, end: g.end };
    if (crossing !== undefined) throw new CompileError("E1005", "turning a Fish value into a JS value isn't supported yet, outside a call or a write that gives it to JS; a 'JsValue' or a package's object comes only from JS", crossing.start, crossing.end);
    // A package's declarations have no body to compile.
    // An interface's method may be any class's, as interfaces are met by shape.
    let signed = new Set<string>();
    for (const x of this.decls.interfaces.values()) for (const m of x.members) if (m.kind === "method" && typeof m.name === "string") signed.add(m.name);
    let required = new Set<BodyId>();
    for (const id of compiledIds) {
      const b = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
      if (this.requiredBody(b, signed)) required.add(b.bodyId);
    }
    this.tables.typing.closeUnknown();
    this.unknownJson();
    this.tables.typing.layOutForCodegen();
    const found = warnings(this.tables, compiledIds, (b) => required.has(b.bodyId));
    return { instances: compiledIds, warnings: found };
  }

  // A value given to `JSON.stringify` holding an `unknown` needs each type stored in one to have a
  // JSON form, which is known only now.
  /** @throws {CompileError} */
  private unknownJson(this: Mut<this>) {
    if (this.tables.unknownJson.length === 0) return;
    const at = { start: this.tables.unknownJson[0]!.start, end: this.tables.unknownJson[0]!.end };
    // Whether a class or a data enum derives Json is asked outside the walk, which can't lend the
    // checker: the walk stops at the first not yet known, which is asked and the walk run again.
    const unknown = this.tables.typing.unknownType();
    let known = new TypeMap<ClassType | VariantType, boolean>();
    let part: Type | undefined = undefined;
    for (;;) {
      part = this.tables.typing.unjson(unknown, (c) => known.get(c) === true);
      const kind = this.recOf(part)?.kind;
      if (part === undefined || (kind !== "class" && kind !== "variant") || known.has(part as ClassType)) break;
      known.set(part as ClassType, this.derivesJson(part as ClassType));
    }
    if (part !== undefined) throw new CompileError("E0509", `this 'unknown' can't be written as JSON, since the program puts a '${this.tables.typing.show(part)}' in one, which has no JSON form`, at.start, at.end);
  }

  // A body whose parameters are kept even when unused: an export, an accessor, a signature, or a
  // method an interface or a base class names.
  /** @throws {CompileError} */
  private requiredBody(this: Mut<this>, b: Ref<Body>, signed: Ref<Set<string>>): boolean {
    if (b.exported === true || b.accessor === true || b.signature === true) return true;
    if (b.owner === undefined) return false;
    // A method's body is named for its class, as in `C.m`.
    const name = b.name.slice(b.name.lastIndexOf(".") + 1);
    if (signed.has(name)) return true;
    const baseId = this.registry().classOf(b.owner!).base;
    const base = this.tables.arenas.classOf(baseId);
    return base !== undefined && inherited(this.tables.arenas, base, "methods", name) !== undefined;
  }

  /** @throws {CompileError} */
  private derivesJson(this: Mut<this>, t: ClassType | VariantType): boolean {
    const r = this.tables.typing.rec(t);
    if (r.kind === "variant") {
      const name = r.enum;
      for (const info of this.enums.values()) if (info.data !== undefined && info.data!.name === name && info.data!.json) return true;
      return false;
    }
    const derives = this.registry().classOf(t as ClassType).node.derives;
    return derives !== undefined && derives.includes("Json");
  }

  localOf(id: LocalId): Ref<Local> {
    return this.tables.arenas.localOf(id);
  }
  recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.tables.typing.rec(t as Exclude<T, string>);
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
  addBody(this: Mut<this>, f: Func): BodyId {
    return this.tables.arenas.addBody(f).bodyId;
  }
  bodyNamed(this: Mut<this>, name: string) {
    return this.tables.arenas.bodyOf(this.byName.get(name));
  }
  // The name the file holding `at` writes for a top-level name, or nothing when that file can't
  // reach it. Std's prelude is in no file's table and reaches every file, but for its internals.
  reachedAs(name: string, at: usize): string | undefined {
    if (!this.macros && this.tables.fileNames !== undefined) {
      const files: Ref<Map<usize, Map<string, string>>> = this.tables.fileNames!;
      const file = files.get(at - (at % (FILE_SPAN as usize)));
      const written = file !== undefined ? file.get(name) : undefined;
      if (written !== undefined) return written;
      for (const f of files.values()) if (f.has(name)) return undefined;
    }
    return STD_INTERNAL.has(name) || name.startsWith("__") ? undefined : name;
  }
  reached(names: Ref<string[]>, at: usize): string[] {
    let out: string[] = [];
    for (const n of names) {
      const written = this.reachedAs(n, at);
      if (written !== undefined) out.push(written);
    }
    return out;
  }
  // What `typeof name` names in a type: a top-level const's type, or a non-generic function's,
  // whose result is checked from its body when it isn't written.
  /** @throws {CompileError} */
  valueTypeOf(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type {
    if (shadowed) throw new CompileError("E0801", `'typeof' of the local '${name}' isn't supported yet; 'typeof' in a type names a top-level function or const`, at.start, at.end);
    if (this.classes.has(name)) throw new CompileError("E0801", `'typeof' of the class '${name}' isn't supported yet, since classes aren't values in Fish; name the class itself as the type`, at.start, at.end);
    const constant = this.byName.get(`const ${name}`);
    const f = constant !== undefined ? constant : this.byName.get(name);
    if (f === undefined) throw new CompileError("E0114", `'typeof' in a type names a top-level function or const, and there is none named '${name}'`, at.start, at.end);
    if (this.querying.has(name)) throw new CompileError("E0113", `'typeof ${name}' is used in working out ${name}'s own type, so that type would depend on itself; write it out`, at.start, at.end);
    this.querying.add(name);
    try {
      if (constant === undefined) return this.functionTypeOf(cloneSignature(this.tables.arenas.bodyOf(f)), at);
      const declared = this.instancing().returnTypeOf(cloneSignature(this.tables.arenas.bodyOf(constant)), new Map<string, Type>());
      if (declared === undefined || this.isInterface(declared)) this.unlaid(name, at);
      const id = this.instanceOf(constant);
      const returned = this.returnOf(id, at);
      return this.tables.typing.widenLet(returned);
    } finally {
      this.querying.delete(name);
    }
  }

  // A computed enum member's value: its initializer, run while compiling as a top-level const is.
  /** @throws {CompileError} */
  enumType(this: Mut<this>, name: string): Type {
    return enumType(this, name);
  }

  /** @throws {CompileError} */
  enumMember(this: Mut<this>, name: string, member: string): LiteralType | undefined {
    return enumMemberOf(this, name, member);
  }

  /** @throws {CompileError} */
  enumMemberNames(this: Mut<this>, name: string): string[] {
    return enumMemberNames(this, name);
  }

  /** @throws {CompileError} */
  enumMemberValue(this: Mut<this>, owner: string, member: string, init: Expr): Value {
    const start = init.start;
    const end = init.end;
    const giving: Stmt = { id: nextId(this.tables.ids), kind: "return", value: init, start, end };
    const made: Func & { comptime: "const" } = { id: nextId(this.tables.ids), kind: "function", async: false, generator: false, macro: false, typeParams: [], params: [], name: `const ${owner}.${member}`, returnType: undefined, body: [giving], start, end, comptime: "const" as const };
    const f = this.addBody(made);
    const instance = this.definition(f);
    this.checkBody(instance);
    return untagged(comptimeBody(this, instance));
  }

  // A result worked out from a body may need the class being laid out, whose fields aren't known.
  /** @throws {CompileError} */
  unlaid(this: Mut<this>, name: string, at: Ref<Span>): void {
    let mid: ClassId | undefined = undefined;
    for (const c of this.registryState.laying.values()) {
      mid = c;
      break;
    }
    if (mid !== undefined) throw new CompileError("E0114", `'typeof ${name}' needs ${name}'s result, worked out from its body, while the field types of '${this.tables.typing.rec(this.tables.arenas.classOf(mid).type).name}' are being worked out; write ${name}'s return type`, at.start, at.end);
  }

  // A function's type for `typeof`: a parameter typed with an object type, an interface or a
  // function type makes it generic in Fish, but its declared type is what `typeof` names.
  /** @throws {CompileError} */
  functionTypeOf(this: Mut<this>, f: Ref<Body>, at: Ref<Span>): Type {
    let explicit: usize = 0;
    if (f.typeParams !== undefined) for (const p of f.typeParams) if (!isLifetime(p)) explicit++;
    if (explicit > 0 || f.params.some((p) => p.comptime)) {
      throw new CompileError("E0801", `'typeof' of the generic function '${f.name}' isn't supported yet: it has a type per instance, and none is chosen here`, at.start, at.end);
    }
    if (f.generator === true) throw unsupported("generator functions in 'typeof' types", at);
    const def = this.instancing().definition(f);
    const defId = def.id;
    const bindings = copyScope(def.bindings);
    // An async function's written `Promise<T>` is its type; any other interface result, or one
    // left to inference, is worked out from the body.
    const declared = this.instancing().returnTypeOf(f, copyScope(bindings));
    let result: Type;
    if (declared !== undefined && (f.async === true || !this.isInterface(declared))) result = declared;
    else {
      this.unlaid(f.name, at);
      const returns = this.returnOf(defId, at);
      const future = this.recOf(returns);
      result = f.async === true && future !== undefined && future.kind === "future" ? this.tables.typing.promiseInterface(future.gives) : returns;
    }
    const open = openParam(this.tables.typing, result, true);
    if (open !== undefined) {
      let given: string | undefined = undefined;
      for (let i: usize = 0; i < f.params.length; i++) if (given === undefined && bindings.get(`#${i}`) === open) given = boundName(f.params[i]!.pattern) ?? this.tables.typing.rec(open).name;
      if (given === undefined) given = this.tables.typing.rec(open).name;
      throw new CompileError("E0114", `'typeof ${f.name}' can't name its result, which depends on the type of the argument given for '${given}'; write the return type`, at.start, at.end);
    }
    let names: string[] = [];
    for (const p of f.params) names.push(p.pattern.kind === "ident" ? writtenName(this.tables, p) : "_");
    const params = this.instancing().declaredParams(f);
    return this.tables.typing.functionType(names, params, result);
  }

  // A comptime parameter's argument: its value, computed in the calling instance, as a literal
  // type. Inside a generic definition the caller's own values aren't known, so it stays open.
  /** @throws {CompileError} */
  comptimeLiteral(this: Mut<this>, arg: Ref<Expr>): Type {
    // The caller's own comptime parameter passed on: the same value, or in a definition the same
    // placeholder, so a call passing it on shares the caller's instance.
    const checking = this.tables.arenas.instanceOf(this.beingChecked);
    const local = arg.kind === "ident" && checking !== undefined ? checking.locals.get(arg) : undefined;
    if (local !== undefined && checking !== undefined) {
      for (const p of bodyOf(this.tables.arenas, checking).params) {
        if (p.comptime && checking.locals.get(p) === local) return checking.bindings.get(comptimeName(p))!;
      }
    }
    if (checking === undefined || !checking.concrete) {
      const known = this.placeholders.get(arg);
      if (known !== undefined) return known;
      const open = this.tables.typing.typeParameter("comptime argument", undefined);
      this.placeholders.set(cloneExpr(arg), open);
      return open;
    }
    // The argument was checked in the innermost body being checked, a closure's perhaps.
    let site = this.beingChecked!;
    const progress = [...this.inProgress];
    for (let i = progress.length; i > 0; i--) {
      if (this.tables.arenas.instanceOf(progress[i - 1]!).types.has(arg)) {
        site = progress[i - 1]!;
        break;
      }
    }
    const given = this.tables.arenas.instanceOf(site).types.get(arg);
    const member = this.recOf(given);
    if (member?.kind === "literal" && member.owner !== undefined) return given!;
    // The interpreter reads a plain tree, and this body's replacements aren't in place yet.
    const plain = rebuiltExpr(cloneExpr(arg), this.tables.rewrites);
    const tagged = comptimeArgument(this, site, plain);
    const tag = tagged !== null && typeof tagged === "object" && tagged.kind === "member" ? tagged.type : undefined;
    if (this.recOf(tag)?.kind === "literal") return tag!;
    const v = untagged(tagged);
    if (typeof v === "bigint" || typeof v === "string" || typeof v === "boolean") return this.tables.typing.literalType(v);
    if (v !== null && typeof v === "object" && v.kind === "array") {
      let strings: string[] = [];
      for (const x of v.items) if (typeof x === "string") strings.push(x);
      if (strings.length === v.items.length) return stringsType(this.tables, strings);
    }
    throw new CompileError("E1102", "a comptime parameter takes an integer, a boolean, a string, an enum member or a string array", arg.start, arg.end);
  }

  // A generic class's constructor parameters, its base's when it declares no constructor.
  templateParams(this: Mut<this>, name: string, seen: Set<string> = new Set<string>()): Param[] | undefined {
    const t = this.templates.get(name);
    if (t === undefined || seen.has(name)) return undefined;
    for (const m of t.members) if (m.kind === "constructor") return cloneParams(m.params);
    const named = t.extends !== undefined ? extendedName(t.extends) : undefined;
    if (named === undefined) return undefined;
    seen.add(name);
    const inherited = this.templateParams(named, seen);
    if (inherited !== undefined) return inherited;
    const base = this.classes.get(named);
    if (base === undefined) return undefined;
    const ctor = this.tables.arenas.classOf(base).constructor;
    return cloneParams(this.tables.arenas.bodyOf(ctor).params);
  }

  // Whether a value of type `from` meeting `to` would become a JS value somewhere inside it: a
  // part that isn't a JsValue or a handle where `to` takes only one. An empty array's `never`
  // elements hold nothing.
  intoJs(this: Mut<this>, given: Type, wanted: Type): boolean {
    const from = heldThrough(this.tables.typing, given);
    const to = heldThrough(this.tables.typing, wanted);
    if (from === to || from === "never" || typeof to === "string" || !holdsJs(this.tables.typing, to)) return false;
    if (isJs(this.tables.typing, to)) return !isJs(this.tables.typing, from);
    const into = this.tables.typing.rec(to);
    const source = this.recOf(from);
    if (into.kind === "union") {
      const wantedMembers = [...into.members];
      let members: Type[] = [];
      if (source !== undefined && source.kind === "union") for (const m of source.members) members.push(m);
      else members.push(from);
      let others: Type[] = [];
      for (const m of wantedMembers) if (!isJs(this.tables.typing, m)) others.push(m);
      for (const m of members) {
        if (wantedMembers.includes(m) || isJs(this.tables.typing, m)) continue;
        let taken = false;
        for (const o of others) if (!taken && this.tables.typing.fits(m, o) && !this.intoJs(m, o)) taken = true;
        if (!taken) return true;
      }
      return false;
    }
    if (source === undefined) return false;
    // An array is never converted element by element where JS values are wanted.
    if ((into.kind === "array" || into.kind === "fixed") && (source.kind === "array" || source.kind === "fixed")) {
      const element = source.element;
      const target = into.element;
      return element !== "never" && !(isJs(this.tables.typing, element) && isJs(this.tables.typing, target)) && (element !== target || this.intoJs(element, target));
    }
    // A field the value leaves out is an absent optional one, which turns nothing into JS.
    if (into.kind === "object" && (source.kind === "object" || source.kind === "class")) {
      let wantedFields: [string, Type][] = [];
      for (const f of into.fields) wantedFields.push([f.name, f.type]);
      let givenFields: [string, Type][] = [];
      for (const g of source.fields) givenFields.push([g.name, g.type]);
      for (const [name, type] of wantedFields) for (const [other, held] of givenFields) if (other === name && this.intoJs(held, type)) return true;
      return false;
    }
    return false;
  }


  // What a function's returned reference borrows from: the parameters with its written
  // lifetime, or by elision `this` for a method, or the only reference parameter.
  /** @throws {CompileError} */
  originsOf(this: Mut<this>, f: Ref<Body>, params: Ref<Type[]>, returns: RefType): Origin[] {
    const at = f.returnType !== undefined ? { start: f.returnType.start, end: f.returnType.end } : { start: f.start, end: f.end };
    const life = this.tables.typing.rec(returns).life;
    if (life !== undefined) {
      let found: Origin[] = [];
      for (let i: usize = 0; i < f.params.length; i++) if (this.named(f.params[i]!.type).has(life)) found.push(i);
      // A lifetime of the method's own class is the object's.
      if (f.owner !== undefined && this.classLifetimes(f).has(life)) found.push("this");
      if (found.length === 0) throw new CompileError("E0209", `no parameter is borrowed for lifetime '${life}'; write 'Ref<T, ${life}>' on the parameter the result points into`, at.start, at.end);
      return found;
    }
    if (f.self !== undefined && !f.self.constructor && f.self.owned !== true) return ["this"];
    let refs: Origin[] = [];
    for (let i: usize = 0; i < params.length; i++) if (this.tables.typing.holdsRef(params[i]!)) refs.push(i);
    if (refs.length === 1) return refs;
    throw new CompileError("E0209", refs.length === 0
      ? "this function returns a reference but borrows nothing it could point into; return an owned value instead"
      : "this function returns a reference and takes several, so say which it points into: declare '<A extends Lifetime>' and write 'Ref<T, A>' on that parameter and the return type", at.start, at.end);
  }

  // What a value holding references a body returns may point into: the parameters whose
  // annotations name a lifetime its type names, or, naming none, whatever was lent.
  heldOrigins(f: Ref<Body>): Origin[] | undefined {
    const names = this.named(f.returnType);
    if (names.size === 0) return undefined;
    let found: Origin[] = [];
    for (let i: usize = 0; i < f.params.length; i++) {
      for (const n of this.named(f.params[i]!.type)) {
        if (names.has(n)) {
          found.push(i);
          break;
        }
      }
    }
    for (const n of this.classLifetimes(f)) {
      if (names.has(n)) {
        found.push("this");
        break;
      }
    }
    return found;
  }

  // The lifetime names an annotation writes: on references, and in classes' lifetime slots.
  named(t: Ref<TypeNode | undefined>): Set<string> {
    let found = new Set<string>();
    if (t === undefined) return found;
    walk({ of: "typeNode", node: t }, (n) => {
      if (n.of !== "typeNode" || n.node.kind !== "ref") return;
      const args: Ref<TypeNode[]> = n.node.args;
      if ((n.node.name === "Ref" || n.node.name === "Mut") && args.length === 2) {
        const life: Ref<TypeNode> = args[1]!;
        if (life.kind === "ref") found.add(life.name);
      }
      const lifetime = this.decls.slots.get(n.node.name);
      if (lifetime !== undefined && args.length === lifetime!.length) {
        for (let i: usize = 0; i < args.length; i++) {
          const a: Ref<TypeNode> = args[i]!;
          if (lifetime![i]! && a.kind === "ref") found.add(a.name);
        }
      }
    });
    return found;
  }

  // What a call's returned reference, or returned value holding references, borrows from, as
  // the callee's signature says; with no lifetime written, whatever was lent to the call.
  /** @throws {CompileError} */
  sourcesOf(this: Mut<this>, id: InstanceId, args: Ref<Expr[]>, receiver: Ref<Expr> | undefined, at: Ref<Span>, lent: Ref<boolean[]>): Expr[] {
    const returns = this.returnOf(id, at);
    if (!this.tables.typing.holdsRef(returns)) return [];
    const ref = this.isRef(returns) ? returns : this.tables.typing.optionRef(returns);
    const f = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
    const params = this.instancing().paramTypes(id);
    const origins = ref !== undefined ? this.originsOf(f, params, ref) : this.heldOrigins(f);
    let out: Expr[] = [];
    if (origins === undefined) {
      for (let i: usize = 0; i < args.length; i++) if (lent[i] === true) out.push(cloneExpr(args[i]!));
      if (receiver !== undefined) out.push(cloneExpr(receiver));
      return out;
    }
    for (const o of origins) {
      if (o !== "this") out.push(cloneExpr(args[o]!));
      else if (receiver !== undefined) out.push(cloneExpr(receiver));
    }
    return out;
  }

  // Every lifetime a body writes must be one it declares.
  /** @throws {CompileError} */
  lifetimes(f: Body) {
    let declared = new Set<string>();
    if (f.typeParams !== undefined) for (const p of f.typeParams) if (isLifetime(p)) declared.add(p.name);
    if (f.owner !== undefined) for (const name of this.classLifetimeNames(this.tables.typing.rec(f.owner).name)) declared.add(name);
    let types: TypeNode[] = [];
    for (const p of f.params) if (p.type !== undefined) types.push(cloneTypeNode(p.type!));
    if (f.returnType !== undefined) types.push(cloneTypeNode(f.returnType!));
    // The first lifetime written that isn't declared.
    let missing: { name: string; start: usize; end: usize }[] = [];
    for (const root of types) {
      walk({ of: "typeNode", node: root }, (n) => {
        if (missing.length > 0 || n.of !== "typeNode" || n.node.kind !== "ref") return;
        const node = n.node;
        const slots = this.decls.slots.get(node.name);
        let lives: TypeNode[] = [];
        if ((node.name === "Ref" || node.name === "Mut") && node.args.length === 2) lives.push(cloneTypeNode(node.args[1]!));
        else if (slots !== undefined && slots!.length === node.args.length) for (let i: usize = 0; i < node.args.length; i++) if (slots![i]!) lives.push(cloneTypeNode(node.args[i]!));
        for (const life of lives) {
          if (life.kind === "ref" && !declared.has(life.name) && missing.length === 0) missing.push({ name: life.name, start: life.start, end: life.end });
        }
      });
    }
    if (missing.length > 0) {
      const life = missing.shift()!;
      throw new CompileError("E0209", `cannot find lifetime '${life.name}'; declare it as '<${life.name} extends Lifetime>'`, life.start, life.end);
    }
  }

  // The lifetimes a method's class declares.
  classLifetimes(f: Ref<Body>): Set<string> {
    let out = new Set<string>();
    if (f.owner === undefined) return out;
    for (const name of this.classLifetimeNames(this.tables.typing.rec(f.owner).name)) out.add(name);
    return out;
  }

  // The lifetimes a class's declaration as written declares.
  classLifetimeNames(name: string): string[] {
    const base = name.split("<")[0]!;
    let out: string[] = [];
    for (const s of this.program) {
      if (s.kind !== "class" || s.name !== base) continue;
      for (const p of s.typeParams) if (isLifetime(p)) out.push(p.name);
      return out;
    }
    return out;
  }

  // Codegen sees each type parameter as the concrete type it stands for.
  /** @throws {CompileError} */
  lowerTables(this: Mut<this>, id: InstanceId): void {
    this.views.set(id, this.tables.arenas.instanceOf(id).returns);
    // `JSON.stringify` and printing write a field by how it was spelled, which lowering forgets.
    let spelled: [Expr, Type][] = [];
    const typed = this.tables.arenas.instanceOf(id).types;
    for (const e of typed.keys()) {
      const instance = this.tables.arenas.instanceOf(id);
      if (e.kind === "call" && this.tables.jsonCalls.get(e) === "stringify" && e.args.length > 0) {
        const x: Ref<Expr> = e.args[0]!;
        const type = instance.coercions.get(x) ?? instance.types.get(x);
        if (type !== undefined) spelled.push([cloneExpr(x), type]);
      }
      if (this.tables.printed.has(e)) {
        const type = instance.coercions.get(e) ?? instance.types.get(e);
        if (type !== undefined) spelled.push([cloneExpr(e), type]);
      }
    }
    if (spelled.length > 0) {
      let instance = this.tables.arenas.instanceMut(id);
      if (instance.spelled === undefined) instance.spelled = new NodeMap<Expr, Type>();
      while (spelled.length > 0) {
        const [x, type] = spelled.shift()!;
        instance.spelled?.set(x, type);
      }
    }
    // A generator a member of a class made from a type parameter gives is the one its counterpart
    // gives, which is the one compiled.
    let made = new TypeMap<Type, Type>();
    let targets: InstanceId[] = [];
    const called = this.tables.arenas.instanceOf(id).calls;
    for (const target of called.values()) targets.push(target);
    for (const target of targets) {
      const to = this.counterpart(target);
      const from = this.tables.arenas.instanceOf(target).generator;
      const into = this.tables.arenas.instanceOf(to).generator;
      if (from !== undefined && into !== undefined && from !== into) made.set(from, into);
    }
    let types: [Expr, Type][] = [];
    const typesOf = this.tables.arenas.instanceOf(id).types;
    for (const [e, t] of typesOf) types.push([cloneExpr(e), t]);
    for (let i: usize = 0; i < types.length; i++) types[i]![1] = this.lowerMade(types[i]![1], made);
    let coercions: [Expr, Type][] = [];
    const coercionsOf = this.tables.arenas.instanceOf(id).coercions;
    for (const [e, t] of coercionsOf) coercions.push([cloneExpr(e), t]);
    for (let i: usize = 0; i < coercions.length; i++) coercions[i]![1] = this.lowerMade(coercions[i]![1], made);
    {
      let instance = this.tables.arenas.instanceMut(id);
      while (types.length > 0) {
        const [e, t] = types.shift()!;
        instance.types.set(e, t);
      }
      while (coercions.length > 0) {
        const [e, t] = coercions.shift()!;
        instance.coercions.set(e, t);
      }
    }
    // A pipe's topic written in as a field read would run a getter once for each `%`.
    const read = this.tables.arenas.instanceOf(id).types;
    for (const e of read.keys()) {
      if (e.kind !== "member" || !this.tables.substituted.has(e)) continue;
      const instance = this.tables.arenas.instanceOf(id);
      const held = this.recOf(instance.types.get(e.object));
      const objectType = held?.kind === "ref" ? held.to : instance.types.get(e.object);
      if (this.recOf(objectType)?.kind === "class" && this.tables.typing.field(objectType as ClassType, e.name) === undefined) throw unsupported("pipes over a field a getter provides", e);
    }
    {
      let instance = this.tables.arenas.instanceMut(id);
      for (const k of instance.patterns.ids()) {
        const lowered = lowerPattern(this.tables.typing, instance.patterns.getById(k)!);
        instance.patterns.setValueById(k, lowered);
      }
      for (const k of instance.raises.ids()) {
        const r = instance.raises.getById(k)!;
        const from = this.tables.typing.lower(r.from);
        const to = this.tables.typing.lower(r.to);
        const param = r.param !== undefined ? this.tables.typing.lower(r.param) : undefined;
        instance.raises.setValueById(k, param !== undefined ? { ...r, from, to, param } : { ...r, from, to });
      }
      for (const k of instance.caught.ids()) {
        const lowered = this.tables.typing.lower(instance.caught.getById(k)!);
        instance.caught.setValueById(k, lowered);
      }
      let predicates: [usize, { index: usize; type: Type; yes: boolean; no: boolean }][] = [];
      if (instance.predicates !== undefined) {
        for (const k of instance.predicates.ids()) {
          const pr = instance.predicates.getById(k)!;
          predicates.push([k, { ...pr, type: this.tables.typing.lower(pr.type) }]);
        }
      }
      while (predicates.length > 0) {
        const [k, pr] = predicates.shift()!;
        instance.predicates?.setValueById(k, pr);
      }
      const thrown = instance.throws;
      if (thrown !== undefined) instance.throws = this.tables.typing.lower(thrown);
    }
    let localIds: LocalId[] = [];
    let seenLocals = new Set<LocalId>();
    const localsOf = this.tables.arenas.instanceOf(id).locals;
    for (const l of localsOf.values()) {
      if (seenLocals.has(l)) continue;
      seenLocals.add(l);
      localIds.push(l);
    }
    let params = new Map<LocalId, Type>();
    for (const l of localIds) {
      const local = this.tables.arenas.localOf(l);
      if (local.param) params.set(l, this.tables.typing.lowerKeepingBrands(local.type));
    }
    const brandedReturns = this.tables.typing.lowerKeepingBrands(this.tables.arenas.instanceOf(id).returns);
    {
      let made = this.tables.arenas.instanceMut(id);
      made.branded = { params, returns: brandedReturns };
    }
    for (const l of localIds) {
      const declaredType = this.tables.arenas.localOf(l).type;
    const lowered = this.lowerMade(declaredType, made);
      let binding = this.tables.arenas.localMut(l);
    binding.type = lowered;
    }
    let calls: [Expr, InstanceId][] = [];
    const callsOf = this.tables.arenas.instanceOf(id).calls;
    for (const [e, target] of callsOf) calls.push([cloneExpr(e), target]);
    for (let i: usize = 0; i < calls.length; i++) calls[i]![1] = this.counterpart(calls[i]![1]);
    let setters: [Expr, InstanceId][] = [];
    const settersOf = this.tables.arenas.instanceOf(id).setters;
    for (const [e, target] of settersOf) setters.push([cloneExpr(e), target]);
    for (let i: usize = 0; i < setters.length; i++) setters[i]![1] = this.counterpart(setters[i]![1]);
    const returns = this.tables.typing.lower(this.tables.arenas.instanceOf(id).returns);
    let instance = this.tables.arenas.instanceMut(id);
    while (calls.length > 0) {
      const [e, target] = calls.shift()!;
      instance.calls.set(e, target);
    }
    while (setters.length > 0) {
      const [e, target] = setters.shift()!;
      instance.setters.set(e, target);
    }
    instance.returns = returns;
  }

  // A type lowered, with each generator a member of a class made from a type parameter gives
  // replaced by its counterpart's.
  /** @throws {CompileError} */
  private lowerMade(this: Mut<this>, t: Type, made: Ref<TypeMap<Type, Type>>): Type {
    const lowered = this.tables.typing.lower(t);
    return made.size > 0 ? this.replaced(lowered, made) : lowered;
  }

  // A member of a generic class made from a type parameter runs as the same member of the
  // class made from what the parameter stands for. Both come from one template, so their
  // members are in the same order.
  /** @throws {CompileError} */
  counterpart(this: Mut<this>, target: InstanceId): InstanceId {
    const instance = this.tables.arenas.instanceOf(target);
    const owner = bodyOf(this.tables.arenas, instance).owner;
    if (owner === undefined) return target;
    const to = this.tables.typing.lower(owner) as ClassType;
    if (to === owner) return target;
    const written = this.tables.arenas.instanceOf(target).body;
    const toClass = this.registry().classOf(to).classId;
    const ownClass = this.registry().classOf(owner).classId;
    const theirs = this.registry().bodiesOf(toClass);
    const mine = this.registry().bodiesOf(ownClass);
    const bodyId = theirs[mine.indexOf(written) as usize]!;
    const body = cloneSignature(this.tables.arenas.bodyOf(bodyId));
    let implicit: string[] = [];
    for (const i of this.instancing().implicitOf(bodyId).keys()) implicit.push(`#${i}`);
    // Its comptime parameters' values carry over too, as do a generic method's own type
    // arguments.
    const bindings = this.tables.arenas.instanceOf(target).bindings;
    let ordered = copyScope(body.scope!);
    for (const p of typeParamsOf(body)) ordered.set(p.name, bindings.get(p.name)!);
    for (const name of implicit) ordered.set(name, bindings.get(name)!);
    for (const [name, t] of bindings) if (name.startsWith("comptime ")) ordered.set(name, t);
    return this.instancing().instanceOf(body, ordered).id;
  }

  // An export in a library is a C function too, so its signature crosses to C as a declared
  // function's does, and it can't throw, be generic or be a generator, which C can't call.
  /** @throws {CompileError} */
  exportable(this: Mut<this>, id: InstanceId): void {
    const instance = this.tables.arenas.instanceOf(id);
    const f = bodyOf(this.tables.arenas, instance);
    if (f.typeParams !== undefined && f.typeParams.length > 0) throw new CompileError("E1003", "a library can't export a generic function to C, which has no generics; export one for each type", f.start, f.end);
    if (f.generator === true) throw new CompileError("E1003", "a library can't export a generator to C, which has no generators", f.start, f.end);
    if (f.throws !== undefined) throw new CompileError("E1003", "a library can't export a function that throws to C, which has no exceptions; return a status instead", f.throws.start, f.throws.end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name) || C_KEYWORDS.has(f.name)) {
      throw new CompileError("E1003", `a library can't export '${f.name}' to C, which needs a name of ASCII letters, digits and underscores that isn't a C or C++ keyword`, f.start, f.end);
    }
    // C reserves names starting with an underscore and a capital, or two underscores, for itself
    // and its runtime: the unwinder's `_Unwind_Resume` among them.
    if (f.name === "main" || f.name.startsWith("fsh_") || /^_[A-Z_]/.test(f.name) || this.takenInC.has(f.name)) {
      throw new CompileError("E1003", `a library can't export '${f.name}' to C, since C's library or the Fish runtime already uses that name`, f.start, f.end);
    }
    for (const p of f.params) {
      if (this.tables.defaulted.has(p)) throw new CompileError("E1003", "an exported function's parameter can't have a default in a library, since C callers pass every argument", p.start, p.end);
      const t = this.tables.arenas.localOf(instance.locals.get(p)!).type;
      if (!this.crossesToLibrary(t)) throw new CompileError("E1003", `an exported function's parameter can't be a '${this.tables.typing.show(t)}' in a library; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    }
    if (instance.returns !== "void" && !this.crossesToLibrary(instance.returns)) {
      const at = f.returnType !== undefined ? { start: f.returnType.start, end: f.returnType.end } : { start: f.start, end: f.end };
      throw new CompileError("E1003", `an exported function can't return a '${this.tables.typing.show(instance.returns)}' in a library; C gives numbers, booleans and raw pointers`, at.start, at.end);
    }
  }

  private crossesToLibrary(t: Type): boolean {
    return isNumeric(t) || t === "boolean" || this.recOf(t)?.kind === "pointer";
  }

  // A C function's signature, which must cross to C as it is: numbers, booleans and raw
  // pointers, with `void` for no result.
  /** @throws {CompileError} */
  foreignSignature(this: Mut<this>, id: InstanceId): void {
    const f = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
    if (f.rust !== undefined) {
      this.rustSignature(id);
      return;
    }
    if (f.typeParams !== undefined && f.typeParams.length > 0) throw unsupported("generic C functions", { start: f.start, end: f.end });
    if (f.generator === true) throw new CompileError("E1002", "a C function can't be a generator; drop the '*'", f.start, f.end);
    if (f.async === true) throw new CompileError("E1002", "a C function can't be async; C calls return when they finish", f.start, f.end);
    if (f.name === "main") throw new CompileError("E1002", "'main' can't be a C function; it is where the program starts", f.start, f.end);
    if (f.throws !== undefined) throw new CompileError("E1002", "a C function can't throw; C reports failures in its result", f.throws.start, f.throws.end);
    if (f.returnType === undefined) throw new CompileError("E1002", "a C function needs its return type written, 'void' if it returns nothing", f.start, f.end);
    const instance = this.tables.arenas.instanceOf(id);
    const scope = this.instancing().scopeOf(id);
    const params = this.instancing().paramTypes(id, scope);
    for (let i: usize = 0; i < f.params.length; i++) {
      const p: Ref<Param> = f.params[i]!;
      if (p.rest || p.optional || p.default !== undefined) throw unsupported("rest, optional and default parameters on C functions", p);
      if (!this.crossesToC(params[i]!, f.start)) throw new CompileError("E1002", `a C function's parameter can't be a '${this.tables.typing.show(params[i]!)}'; C takes numbers, booleans and raw pointers like 'Ptr<u8>'`, p.start, p.end);
    }
    {
      let made = this.tables.arenas.instanceMut(id);
      made.signature = [...params];
    }
    const returns = this.resolver().resolveType(f.returnType);
    if (returns !== "void" && !this.crossesToC(returns, f.start)) throw new CompileError("E1002", `a C function can't return a '${this.tables.typing.show(returns)}'; C gives numbers, booleans and raw pointers`, f.returnType.start, f.returnType.end);
    {
      let record = this.tables.arenas.instanceMut(id);
      record.returns = returns;
    }
    this.done.add(id);
  }

  // Whether a value crosses to C as it is: a number, a boolean or a raw pointer. std's FileHandle
  // hands its counted descriptor to the runtime, which is a pointer to C; only std may, as a
  // program could otherwise make one that closes a descriptor it doesn't own.
  private crossesToC(t: Type, at: usize): boolean {
    if (isNumeric(t) || t === "boolean" || this.recOf(t)?.kind === "pointer") return true;
    if (stdModuleAt(this.tables.files, at) === undefined) return false;
    const r = this.recOf(t);
    const held = r?.kind === "ref" ? this.recOf(r.to) : r;
    return held?.kind === "block" && held.which === "FileDescriptor";
  }

  // A Rust function's signature: numbers and booleans, with `void` for no result, so far.
  /** @throws {CompileError} */
  rustSignature(this: Mut<this>, id: InstanceId): void {
    const f = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
    const what = `the Rust function '${f.name}'`;
    const constructor = f.self?.constructor === true;
    if (f.typeParams !== undefined && f.typeParams.length > 0) throw unsupported("generic Rust functions", { start: f.start, end: f.end });
    if (f.generator === true || f.async === true) throw new CompileError("E1004", `${what} can't be ${f.async === true ? "async" : "a generator"}; it returns when the Rust function does`, f.start, f.end);
    // A Rust `Result`'s `Err` is thrown: as Fish's `Error`, made from its Display text, or as the
    // Rust type it is, declared as a class.
    if (f.throws !== undefined) {
      const error = this.resolver().resolveType(f.throws);
      const r = this.recOf(error);
      const isError = r?.kind === "class" && r.name === "Error" && r.generic === undefined;
      if (!isError && rustClassOf(this.tables.typing, error) === undefined) throw new CompileError("E1004", `${what} throws a Rust 'Err' as Fish's 'Error', made from its Display text, or as a Rust type declared in a 'rust:' block, not as a '${this.tables.typing.show(error)}'`, f.throws.start, f.throws.end);
      if (isError) this.registry().classOf(error as ClassType);
      {
        let record = this.tables.arenas.instanceMut(id);
        record.throws = error;
      }
    }
    if (f.returnType === undefined && !constructor) throw new CompileError("E1004", `${what} needs its return type written, 'void' if it returns nothing`, f.start, f.end);
    const scope = this.instancing().scopeOf(id);
    const params = this.instancing().paramTypes(id, scope);
    for (let i: usize = 0; i < f.params.length; i++) {
      const p: Ref<Param> = f.params[i]!;
      if (p.rest || p.optional || p.default !== undefined || p.comptime) throw unsupported("rest, optional, default and comptime parameters on Rust functions", p);
      this.crossesToRust(params[i]!, false, what, p);
    }
    {
      let made = this.tables.arenas.instanceMut(id);
      made.signature = [...params];
    }
    const returns = f.returnType !== undefined ? this.resolver().resolveType(f.returnType) : "void";
    if (returns !== "void") this.crossesToRust(returns, true, what, { start: f.returnType!.start, end: f.returnType!.end });
    // A constructor gives the handle to the value it made.
    const gives = constructor ? f.owner! : returns;
    {
      let record = this.tables.arenas.instanceMut(id);
      record.returns = gives;
    }
    // Every declaration of one Rust function calls the one shim function, so they agree on types.
    // The receiver and what it throws are part of how the shim calls it, so they have to agree too.
    let shown: string[] = [];
    if (f.self !== undefined && !constructor) shown.push(f.self.owned === true ? "self" : f.self.mutable ? "&mut self" : "&self");
    for (const t of params) shown.push(this.tables.typing.show(t));
    const throws = this.tables.arenas.instanceOf(id).throws;
    const types = `(${shown.join(", ")}): ${this.tables.typing.show(gives)}${throws !== undefined ? ` throws ${this.tables.typing.show(throws)}` : ""}`;
    const other = this.rustTypes.get(f.rust!.symbol);
    if (other !== undefined && other !== types) throw new CompileError("E1004", `'${f.rust!.crate}::${f.rust!.path}' is declared elsewhere as ${other}; declare it with the same types`, f.start, f.end);
    this.rustTypes.set(f.rust!.symbol, types);
    this.done.add(id);
  }

  /** @throws {CompileError} */
  private crossesToRust(this: Mut<this>, t: Type, giving: boolean, what: string, at: Ref<Span>): void {
    const why = crossingOf(this.tables.typing, t, giving);
    if (typeof why === "string") throw new CompileError("E1004", `${giving ? `${what} can't give` : "a Rust function can't take"} a '${this.tables.typing.show(t)}': ${why}`, at.start, at.end);
  }

  // A package's function's signature, from its declaration: what it takes and gives must cross
  // between Fish and JS, as strings, booleans, numbers, Options, unions and literals of them,
  // arrays of them copied across, and opaque JS values.
  // One imported but not called yet is refused only where a program calls it.
  /** @throws {CompileError} */
  jsSignature(this: Mut<this>, id: InstanceId): void {
    try {
      this.jsSigned(id);
    } catch (e) {
      const body = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)).bodyId;
      if (!(e instanceof CompileError) || this.tables.jsCalledAt.has(body)) throw e;
      const f = this.tables.arenas.bodyOf(body);
      this.tables.typing.jsUncalled.set({ id: f.id }, e);
      this.opaqueJs(id);
    }
  }

  // A package's function typed only as giving a JS value, as one Fish can't type, or a generic
  // one's definition, is.
  private opaqueJs(this: Mut<this>, id: InstanceId): void {
    const returns = this.tables.typing.blockType("JsValue");
    let instance = this.tables.arenas.instanceMut(id);
    instance.signature = [];
    instance.returns = returns;
    this.done.add(id);
  }

  /** @throws {CompileError} */
  jsSigned(this: Mut<this>, id: InstanceId): void {
    const f = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
    const named = `'${f.js!.name}' from '${f.js!.module}'`;
    // A declaration Fish can't type is refused where it is declared, noting the call that reached it.
    const called = this.tables.jsCalledAt.get(f.bodyId);
    const at = called === undefined ? undefined : { start: called.start, end: called.end };
    // A generic one is checked for each set of type arguments it is called with, as what crosses
    // is known only then; its definition, never compiled, is typed only by each call.
    if (!this.tables.arenas.instanceOf(id).concrete) {
      this.opaqueJs(id);
      return;
    }
    // What its type parameters stand for, as plain types, since JS sees no Fish placeholders.
    let concrete = new Map<string, Type>();
    for (const [n, t] of this.instancing().scopeOf(id)) concrete.set(n, this.tables.typing.lower(t));
    const declared = this.instancing().paramTypes(id, copyScope(concrete));
    let params: Type[] = [];
    for (const t of declared) params.push(this.tables.typing.jsTakes(t));
    for (let i: usize = 0; i < f.params.length; i++) {
      const p: Ref<Param> = f.params[i]!;
      if (p.rest) throw unsupported(`rest parameters on a package's functions, as ${named} takes,`, p);
      // An object type taken as a JS object's shape is still checked for what it holds.
      const given = params[i]!;
      const written = declared[i]!;
      const shaped = given !== written && typeof written !== "string" && this.tables.typing.rec(written).kind !== "function" && this.tables.typing.rec(written).kind !== "interface";
      const why = this.tables.typing.uncrossable(given) ?? (shaped ? this.tables.typing.uncrossable(written) : undefined);
      if (why !== undefined) throw refusedJs(`${named} takes a '${this.tables.typing.show(given)}', which can't cross between Fish and JS yet: ${why}`, p.type !== undefined ? { start: p.type.start, end: p.type.end } : { start: p.start, end: p.end }, f.js!.name, at);
    }
    {
      let made = this.tables.arenas.instanceMut(id);
      made.signature = [...params];
    }
    const written = f.returnType !== undefined ? this.resolver().resolveIn(concrete, f.returnType) : this.tables.typing.blockType("JsValue");
    const returns = this.tables.typing.jsView(written);
    const why = returns === "void" ? undefined : this.tables.typing.uncrossable(returns);
    if (why !== undefined) throw refusedJs(`${named} gives a '${this.tables.typing.show(returns)}', which can't cross between Fish and JS yet: ${why}`, { start: f.returnType!.start, end: f.returnType!.end }, f.js!.name, at);
    {
      let record = this.tables.arenas.instanceMut(id);
      record.returns = returns;
    }
    this.done.add(id);
  }

  // An overload signature's body only passes its parameters on, so what fails there is the
  // signature not matching its implementation.
  incompatible(id: BodyId, e: CompileError): CompileError {
    const prefix = "this overload signature is not compatible with its implementation";
    const signature = this.tables.arenas.bodyOf(id);
    if (e.start < signature.start || e.end > signature.end || e.message.startsWith(prefix)) return e;
    return new CompileError("E0410", `${prefix}: ${e.message}`, e.start, e.end, e.note === undefined ? undefined : { start: e.note.start, end: e.note.end, message: e.note.message });
  }

  // A call made inside an instance with one of its type parameters gets the type the definition
  // gave it: the callee's return with the callee's parameters as the ones the call passed.
  /** @throws {CompileError} */
  resultOf(this: Mut<this>, id: InstanceId, at: Ref<Span & Id>): Type {
    // Checking the callee may instantiate from this call again, so its site is read first.
    const site = copyOptionalScope(this.instancing().siteOf({ id: at.id, start: at.start, end: at.end }));
    const returns = this.returnOf(id, at);
    const instance = this.tables.arenas.instanceOf(id);
    if (site === undefined || (bodyOf(this.tables.arenas, instance).js !== undefined && instance.concrete)) return returns;
    const f = cloneSignature(bodyOf(this.tables.arenas, instance));
    let bindings = copyScope(instance.bindings);
    for (const [name, t] of site) bindings.set(name, t);
    const declared = this.instancing().returnTypeOf(f, bindings);
    if (declared !== undefined && !this.describes(declared)) return declared;
    const own = this.instancing().scopeOf(id);
    let swap = new TypeMap<Type, Type>();
    for (const [name, t] of site) swap.set(own.get(name)!, t);
    return this.replaced(this.views.get(id) ?? returns, swap);
  }

  // Each member a class writes that implements an abstract member takes what the declaration
  // takes and gives what it gives, as a template calling it through the abstract class expects.
  /** @throws {CompileError} */
  implementsSignatures(this: Mut<this>, c: ClassId): void {
    for (const table of ["methods", "getters", "setters"]) {
      let written: [string, BodyId][] = [];
      for (const [name, id] of membersOf(this.tables.arenas.classOf(c), table)) written.push([name, id]);
      for (const [name, id] of written) {
        const f = this.tables.arenas.bodyOf(id);
        if (f.abstract === true || f.copyOf !== undefined) continue;
        let b = this.tables.arenas.classOf(c).base;
        while (b !== undefined) {
          const declared = membersOf(this.tables.arenas.classOf(b), table).get(name);
          if (declared !== undefined && this.tables.arenas.bodyOf(declared).abstract === true) this.implementsSignature(id, declared, b);
          b = this.tables.arenas.classOf(b).base;
        }
      }
    }
    let b = this.tables.arenas.classOf(c).base;
    while (b !== undefined) {
      const base: ClassId = b;
      b = this.tables.arenas.classOf(base).base;
      let getters: [string, BodyId][] = [];
      for (const [name, id] of this.tables.arenas.classOf(base).getters) getters.push([name, id]);
      for (const [name, id] of getters) {
        const declared = this.tables.arenas.bodyOf(id);
        if (declared.abstract !== true) continue;
        let ownType: Type | undefined = undefined;
        const own = this.tables.typing.rec(this.tables.arenas.classOf(c).type).fields;
        for (const x of own) {
          if (x.name === name) {
            ownType = x.type;
            break;
          }
        }
        if (ownType === undefined) continue;
        const at = { start: declared.start, end: declared.end };
        const called = this.instanceOf(id);
    const wanted = this.returnOf(called, at);
        let written: Span = at;
        for (const x of this.tables.arenas.classOf(c).fields) {
          if (x.name === name) {
            written = { start: x.start, end: x.end };
            break;
          }
        }
        // A field is read as it is, so it has the declared type exactly.
        if (ownType !== wanted) throw new CompileError("E0701", `'${name}' must be a '${this.tables.typing.show(wanted)}', not a '${this.tables.typing.show(ownType)}', as '${this.tables.typing.rec(this.tables.arenas.classOf(base).type).name}' declares it abstract`, written.start, written.end);
      }
    }
  }

  /** @throws {CompileError} */
  implementsSignature(this: Mut<this>, fId: BodyId, declaredId: BodyId, b: ClassId): void {
    const f = cloneSignature(this.tables.arenas.bodyOf(fId));
    const declared = cloneSignature(this.tables.arenas.bodyOf(declaredId));
    const base = this.tables.typing.rec(this.tables.arenas.classOf(b).type).name;
    const why = (text: string) => new CompileError("E0701", `'${declared.name.slice((base.length + 1) as i64)}' ${text}, as '${base}' declares it abstract`, f.start, f.end);
    const want = this.instancing().declaredParams(declared);
    const rest = f.params.find((p) => p.rest);
    if (rest !== undefined && !declared.params.some((p) => p.rest)) throw new CompileError("E0801", `'${f.name.slice((this.tables.typing.rec(f.owner!).name.length + 1) as i64)}' can't gather its arguments into a rest parameter yet where '${base}' declares it abstract with separate ones`, rest.start, rest.end);
    // A generic implementation is the instance its type parameters take from the declaration's.
    const names = new Set(typeParamsOf(f).map((p) => p.name));
    let bindings = new Map<string, Type>();
    if (names.size > 0) {
      for (let i: usize = 0; i < f.params.length && i < want.length; i++) {
        const p: Ref<Param> = f.params[i]!;
        if (p.type !== undefined) infer(this.tables, this.decls, p.type!, want[i]!, names, bindings, f);
      }
    }
    if (bindings.size < names.size) throw why(`must take (${want.map((t) => this.tables.typing.show(t)).join(", ")})`);
    let scoped = new Map<string, Type>();
    if (f.scope !== undefined) for (const [k, t] of f.scope) scoped.set(k, t);
    for (const [k, t] of bindings) scoped.set(k, t);
    const instance = names.size > 0 ? this.instancing().instanceOf(f, scoped).id : this.instanceOf(fId);
    const have = names.size > 0 ? this.instancing().paramTypes(instance) : this.instancing().declaredParams(f);
    // Parameters past the declaration's must be optional, as the calls through it leave them out.
    const extra = f.params.slice(want.length as i64).some((p) => !p.optional);
    let mismatched = false;
    for (let i: usize = 0; i < want.length && i < have.length; i++) if (!this.tables.typing.fits(want[i]!, have[i]!)) mismatched = true;
    if (have.length < want.length || extra || mismatched) throw why(`must take (${want.map((t) => this.tables.typing.show(t)).join(", ")})`);
    if ((f.async === true) !== (declared.async === true)) throw why(declared.async === true ? "must be async" : "can't be async");
    if ((f.generator === true) !== (declared.generator === true)) throw why(declared.generator === true ? "must be a generator" : "can't be a generator");
    if (f.self!.mutable && !declared.self!.mutable) throw why("can't change 'this'; it borrows 'this' read-only");
    if ((f.self!.owned === true) !== (declared.self!.owned === true)) throw why(declared.self!.owned === true ? "must take 'this: Own<this>'" : "can't take 'this: Own<this>'");
    const error = this.errorOf(instance);
    const declaredInstance = this.instanceOf(declaredId);
    const allowed = this.errorOf(declaredInstance);
    if (error !== undefined && (allowed === undefined || !this.tables.typing.fits(error, allowed))) throw why(allowed !== undefined ? `can only throw '${this.tables.typing.show(allowed)}'` : "can't throw");
    const gives = this.returnOf(instance, { start: f.start, end: f.end });
    const declaredFor = this.instanceOf(declaredId);
    const wanted = this.returnOf(declaredFor, { start: declared.start, end: declared.end });
    if (!this.tables.typing.fits(gives, wanted)) throw why(`must return '${this.tables.typing.show(wanted)}', not '${this.tables.typing.show(gives)}'`);
  }

  // What a call of an instance may throw, as its caller sees it.
  /** @throws {CompileError} */
  errorOf(this: Mut<this>, id: InstanceId): Type | undefined {
    const throws = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)).throws;
    if (throws === undefined) return undefined;
    const written = cloneTypeNode(throws);
    const scope = copyScope(this.tables.arenas.instanceOf(id).bindings);
    return this.resolver().resolveIn(scope, written);
  }

  /** @throws {CompileError} */
  returnOf(this: Mut<this>, id: InstanceId, at: Ref<Span>): Type {
    const f = cloneSignature(bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)));
    // A package's function gives what its signature made of its declaration for JS; a generic
    // one's definition gives what it declares, as each instance makes its own.
    if (f.js !== undefined && this.tables.arenas.instanceOf(id).concrete) {
      this.checkBody(id);
      return this.tables.arenas.instanceOf(id).returns;
    }
    const bindings = copyScope(this.tables.arenas.instanceOf(id).bindings);
    const declared = this.instancing().returnTypeOf(f, bindings);
    if (declared !== undefined && !this.describes(declared)) return declared;
    if (this.inProgress.has(id)) {
      if (f.generator === true) throw new CompileError("E0113", `a generator can't make another of itself, since its state would have to hold itself; loop inside one generator instead`, at.start, at.end);
      if (f.async === true) throw new CompileError("E0113", `an async function can't await another of itself, since its state would have to hold itself; loop inside one instead`, at.start, at.end);
      throw new CompileError("E0104", `'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    this.checkBody(id);
    // What it was inferred to give, with the brands lowering left out of the compiled type.
    const checked = this.tables.arenas.instanceOf(id);
    return checked.branded !== undefined ? checked.branded.returns : checked.returns;
  }

  // The check of a generic body as written, before an instance's: a generic function's
  // definition, or the same member of its generic class's definition, with a closure's body
  // checked within the body it is written in.
  /** @throws {CompileError} */
  asWritten(this: Mut<this>, id: InstanceId): void {
    const parent = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id)).closure?.parent;
    if (parent !== undefined) {
      this.asWritten(parent);
      return;
    }
    const f = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(id));
    let body = f.bodyId;
    const { start, end } = f;
    const generic = f.scope !== undefined && f.owner !== undefined ? this.tables.typing.rec(f.owner).generic : undefined;
    const template = generic !== undefined ? this.genericClasses().definedClass(generic.name)?.classId : undefined;
    if (template !== undefined) {
      for (const b of this.registry().bodiesOf(template)) {
        const other = this.tables.arenas.bodyOf(b);
        if (other.start === start && other.end === end) {
          body = b;
          break;
        }
      }
    }
    const written = this.definition(body);
    if (written !== id && !this.inProgress.has(written)) this.checkBody(written);
  }

  // Checks an instance with its type arguments in scope.
  /** @throws {CompileError} */
  checkBody(this: Mut<this>, id: InstanceId): void {
    if (this.done.has(id)) return;
    const outer = this.beingChecked;
    const outerDemanded = this.demanded;
    this.beingChecked = id;
    try {
      // A pass whose body made a new demand is thrown away, whatever it concluded, and the body
      // is checked again with the demanded types; each pass adds one, so this ends.
      for (;;) {
        this.demanded = 0;
        try {
          // A body sees its own names, not those of a body whose check needed it.
          const outerSight = this.resolver().enterSight(undefined);
          const scope = this.instancing().scopeOf(id);
          const outerScope = this.resolver().enterScope(scope);
          try {
            this.checkInstance(id, undefined);
          } finally {
            this.resolverState.scope = outerScope;
            this.resolverState.sight = outerSight;
          }
        } catch (e) {
          this.inProgress.delete(id);
          const body = this.tables.arenas.instanceOf(id).body;
          if (!(e instanceof CompileError)) throw e;
          if (this.demanded === 0) {
            const thrown = this.tables.arenas.bodyOf(body).signature === true ? this.incompatible(body, e) : e;
            this.failed.set(body, thrown.clone());
            throw thrown;
          }
        }
        if (this.demanded === 0) return;
        this.forget(id);
      }
    } finally {
      this.beingChecked = outer;
      this.demanded = outerDemanded;
    }
  }

  // Clears what checking an instance recorded, for another pass: its tables and its closures.
  // A callee checked during the pass stays checked, closures and all.
  forget(this: Mut<this>, id: InstanceId): void {
    let instance = this.tables.arenas.instanceMut(id);
    instance.types.clear();
    instance.locals.clear();
    instance.calls.clear();
    instance.setters.clear();
    instance.coercions.clear();
    instance.jumps.clear();
    instance.borrowsFrom.clear();
    instance.raises.clear();
    instance.caught.clear();
    instance.consumes.clear();
    instance.patterns.clear();
    instance.copiesOut.clear();
    instance.returns = "void";
    instance.throws = undefined;
    instance.envs = undefined;
    instance.dyns = undefined;
    instance.made = undefined;
    instance.predicates = undefined;
    instance.narrowedFields = undefined;
    instance.absent = undefined;
    // A closure checked within a discarded pass isn't in progress any more either.
    let inside: InstanceId[] = [];
    for (const c of this.inProgress) if (this.within(c, id)) inside.push(c);
    for (const c of inside) this.inProgress.delete(c);
    let kept: InstanceId[] = [];
    for (const c of this.closures) if (!this.within(c, id)) kept.push(c);
    this.closures = kept;
    this.views.delete(id);
    this.done.delete(id);
    this.inProgress.delete(id);
  }

  // Whether an instance is `root`, or a closure written inside it.
  private within(c: InstanceId, root: InstanceId): boolean {
    if (c === root) return true;
    const closure = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(c)).closure;
    return closure !== undefined && this.within(closure.parent, root);
  }

  /** @throws {CompileError} */
  checkInstance(this: Mut<this>, id: InstanceId, outer: Mut<BodyChecker> | undefined): void {
    const instance = this.tables.arenas.instanceOf(id);
    const f = bodyOf(this.tables.arenas, instance);
    // A comptime parameter's value is the instance's own; one called from C, or kept in an async
    // function's or a generator's state, or given to an accessor, has no instance per value.
    const fixedParam = f.params.find((p) => p.comptime);
    if (fixedParam !== undefined && f.foreign === true && f.rust === undefined) throw new CompileError("E1002", "a C function can't take a comptime parameter: C takes every argument at run time", fixedParam.start, fixedParam.end);
    if (fixedParam !== undefined && f.accessor === true) throw new CompileError("E1102", "an accessor can't take a comptime parameter, since a read or an assignment gives it no value while compiling", fixedParam.start, fixedParam.end);
    if (f.foreign === true) {
      this.foreignSignature(id);
      return;
    }
    if (f.abstract === true) {
      const returns = this.instancing().returnTypeOf(f, instance.bindings) ?? "void";
      {
        let record = this.tables.arenas.instanceMut(id);
        record.returns = returns;
      }
      this.done.add(id);
      return;
    }
    if (f.js !== undefined) {
      this.jsSignature(id);
      return;
    }
    if (fixedParam !== undefined && (f.async === true || f.generator === true)) throw unsupported("comptime parameters on async functions and generators", fixedParam);
    if (fixedParam !== undefined && f.exported === true) throw new CompileError("E1003", "an exported function can't take a comptime parameter, since C calls it with run-time values", fixedParam.start, fixedParam.end);
    this.inProgress.add(id);
    let checker = new BodyChecker(this, id, outer);
    checker.prepare();
    checker.check();
  }
}

// A class's members, for interface satisfaction, read through the checker.
class ClassMembers implements Members {
  cx: Mut<Checker>;

  constructor(cx: Mut<Checker>) {
    this.cx = cx;
  }

  typing(this: Mut<this>): Mut<Typing> {
    return this.cx.tables.typing;
  }

  arenas(): Ref<Arenas> {
    return this.cx.tables.arenas;
  }

  assuming(this: Mut<this>): Mut<Set<string>> {
    return this.cx.assuming;
  }

  refused(this: Mut<this>): Mut<Refused[]> {
    return this.cx.refused;
  }

  /** @throws {CompileError} */
  classIdOf(this: Mut<this>, t: ClassType): ClassId {
    return this.cx.registry().classIdOf(t);
  }

  /** @throws {CompileError} */
  returnOf(this: Mut<this>, id: BodyId, at: Span): Type {
    const instance = this.cx.definition(id);
    return this.cx.returnOf(instance, at);
  }

  /** @throws {CompileError} */
  throwsOf(this: Mut<this>, id: BodyId): Type | undefined {
    const throws = this.cx.tables.arenas.bodyOf(id).throws;
    if (throws === undefined) return undefined;
    const written = cloneTypeNode(throws);
    const def = this.cx.definition(id);
    const scope = this.cx.instancing().scopeOf(def);
    return this.cx.resolver().resolveIn(scope, written);
  }

  // A generic method's, with its own type parameters standing for themselves.
  /** @throws {CompileError} */
  paramTypesOf(this: Mut<this>, id: BodyId): Type[] {
    const b = cloneSignature(this.cx.tables.arenas.bodyOf(id));
    if (!hasOwnTypeParams(b)) return this.cx.instancing().declaredParams(b);
    const def = this.cx.definition(id);
    const scope = this.cx.instancing().scopeOf(def);
    return this.cx.instancing().paramTypes(def, scope);
  }

  bodyIdNamed(name: string): BodyId | undefined {
    return this.cx.byName.get(name);
  }

  /** @throws {CompileError} */
  replaced(this: Mut<this>, t: Type, swap: Ref<TypeMap<Type, Type>>): Type {
    return this.cx.replaced(t, swap);
  }

  /** @throws {CompileError} */
  typeParamsOf(this: Mut<this>, id: BodyId): Type[] {
    const def = this.cx.definition(id);
    const scope = this.cx.instancing().scopeOf(def);
    let out: Type[] = [];
    const params = this.cx.tables.arenas.bodyOf(id).typeParams;
    if (params !== undefined) for (const p of params) if (!isLifetime(p)) out.push(scope.get(p.name)!);
    return out;
  }
}

class BodyChecker implements Context, GuardHost {
  cx: Mut<Checker>;
  instanceId: InstanceId;
  // The body a closure is written in, which its body reaches back into as it is checked.
  outer: Mut<BodyChecker> | undefined;
  declared: Type | undefined = undefined;
  // A generator's declared `Generator<T>`, or an async one's `AsyncGenerator<T>`, says what it
  // yields; calling it gives its own type.
  generatorType: GeneratorType | undefined = undefined;
  generatorName: string = "";
  yielded: Type | undefined = undefined;
  // What `next(x)` sends, which a `yield` whose value is used gives.
  sends: Type | undefined = undefined;
  // An async function's declared `Promise<T>` says what it gives once awaited; its `return`s
  // give that, and calling it gives its own future, which runs nothing until awaited.
  future: FutureType | undefined = undefined;
  trait: InterfaceType | undefined = undefined;
  // A function returning a generic function type returns the one generic function it gives.
  family: FunctionType | undefined = undefined;
  inferred: Type | undefined = undefined;
  // The awaits written where the state machine can stop at them.
  awaitable: NodeSet<Expr> = new NodeSet<Expr>();
  // The yields whose value is used where the generator can stop at them.
  yieldable: NodeSet<Expr> = new NodeSet<Expr>();
  // How many statements with a `finally` enclose the code being checked: a generator dropped
  // at a `yield` there would never run the `finally`.
  finalizing: usize = 0;
  // This body's sight in the resolver's state, which holds the scopes its bindings are declared in.
  sight: usize = 0;
  targets: Target[] = [];
  // What the conditions guarding the code being checked prove, and what assignments set,
  // innermost last.
  facts: Facts[] = [];
  // Each binding written so far, in order, and where: a write forgets what was known of it.
  written: { local: string; at: usize }[] = [];
  // The names closures and nested functions in the body assign, which never narrow outside them.
  closureAssigned: Set<string> = new Set<string>();
  // The bindings nested functions lend mutably, which never narrow once one is seen.
  nestedLent: Set<LocalId> = new Set<LocalId>();
  // The roots of field paths, a binding's id or `this`, that a closure or nested function changes,
  // whose paths never narrow once one is seen.
  closureChanged: Set<string> = new Set<string>();
  // Each read of a binding as narrowed, in order, and for each loop being checked, how many facts
  // and such reads there were where it starts.
  // Each read of a binding or field path as narrowed, by the read's node id.
  narrowReads: { local: string; at: usize }[] = [];
  loops: { facts: usize; reads: usize }[] = [];
  // The list being checked and the place in it, for a statement that becomes several.
  // The statement being checked directly in a list, by id, and what is to go after it there.
  walking: usize | undefined = undefined;
  after: Stmt[] = [];
  // For each enclosing `try`, the errors its block raises so far, where and of what type.
  handlers: [Expr | Stmt, Type][][] = [];
  // How many comptime blocks or expressions the code being checked is inside, and for each
  // block, how many targets were open when it began, which nothing inside may jump to.
  comptimeDepth: usize = 0;
  floors: usize[] = [];
  // Each narrowed `Mut` given a whole value of another member, in order.
  changed: LocalId[] = [];
  // The expression an expression statement being checked consists of.
  whole: Expr | undefined = undefined;
  assigned: Set<string> = new Set<string>();
  // The parameters the body changes, and those an async nested function takes a copy of, which
  // are checked against each other once the whole body is seen.
  changedParams: Set<LocalId> = new Set<LocalId>();
  // The parameters the body assigns, an inner binding of the same name aside.
  assignedParams: Set<LocalId> = new Set<LocalId>();
  copiedParams: { local: Local; nested: string; at: Span }[] = [];
  // How many scopes enclose each binding's declaration.
  depths: Map<LocalId, usize> = new Map<LocalId, usize>();
  // Bindings declared directly in a switch case body whose checking has finished.
  caseOnly: Set<LocalId> = new Set<LocalId>();
  // A constructor's fields are unset until assigned, so until then `this` may only appear as
  // the target of an assignment to one of them, and the constructor can't return.
  unset: Set<string> = new Set<string>();
  exempt: usize | undefined = undefined;
  // A derived constructor's first statement, `super(...)`, fills the embedded base.
  // After its parameters' defaults, which `super(...)` may read.
  superCall: Expr | undefined = undefined;
  // Whether the constructor has assigned a field, an initializer's or its base's included. A
  // `new` that fails drops nothing, so from then on nothing in the constructor may throw.
  built: boolean = false;
  // A closure sees the `this` of the body it is written in, which it only reads.
  enclosing: Body["self"] = undefined;
  self: Body["self"] = undefined;
  captures: Map<LocalId, LocalId | "this"> | undefined = undefined;
  // What expression checking reads of the program and of this body.
  // Whether this is a closure owning what it captures: async, or `move`.
  owning: boolean = false;
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined = undefined;
  syncMain: boolean = false;
  closing: boolean = false;
  generator: boolean = false;
  runtime: boolean = false;
  locked: string | undefined = undefined;
  sharing: boolean = false;
  counting: boolean = false;
  async: boolean = false;
  unsafe: boolean = false;
  exprsState: ExpressionsState = new ExpressionsState(false);
  // What the function may throw: any value's type. An arrow with none written takes it from the
  // function type it is given as, as it does its parameters' types, or else from what its body
  // can throw; a nested function declares its own.
  contextual: FunctionType | undefined = undefined;
  inferring: [Expr | Stmt, Type][] | undefined = undefined;
  errorType: Type | undefined = undefined;
  params: Type[] = [];
  // A field initializer runs before the constructor's body, out of reach of its parameters.
  hidden: boolean = false;

  // The body being checked.
  f(): Ref<Body> {
    return this.cx.tables.arenas.bodyOf(this.cx.tables.arenas.instanceOf(this.instanceId).body);
  }
  // The instance being checked, and its tables, read from the arena.
  instance(this: Mut<this>): Mut<Instance> {
    return this.cx.tables.arenas.instanceMut(this.instanceId);
  }
  held(): Ref<Instance> {
    return this.cx.tables.arenas.instanceOf(this.instanceId);
  }
  types(this: Mut<this>): Mut<Instance["types"]> {
    return this.instance().types;
  }
  locals(this: Mut<this>): Mut<Instance["locals"]> {
    return this.instance().locals;
  }
  coercions(this: Mut<this>): Mut<Instance["coercions"]> {
    return this.instance().coercions;
  }
  calls(this: Mut<this>): Mut<Instance["calls"]> {
    return this.instance().calls;
  }
  setters(this: Mut<this>): Mut<Instance["setters"]> {
    return this.instance().setters;
  }
  jumps(this: Mut<this>): Mut<Instance["jumps"]> {
    return this.instance().jumps;
  }
  patterns(this: Mut<this>): Mut<Instance["patterns"]> {
    return this.instance().patterns;
  }
  copiesOut(this: Mut<this>): Mut<Instance["copiesOut"]> {
    return this.instance().copiesOut;
  }
  borrowsFrom(this: Mut<this>): Mut<Instance["borrowsFrom"]> {
    return this.instance().borrowsFrom;
  }
  tables(this: Mut<this>): Mut<Tables> {
    return this.cx.tables;
  }
  decls(): Ref<Declarations> {
    return this.cx.decls;
  }
  byName(): Ref<Map<string, BodyId>> {
    return this.cx.byName;
  }
  classes(): Ref<Map<string, ClassId>> {
    return this.cx.classes;
  }
  enums(): Ref<Map<string, EnumInfo>> {
    return this.cx.enums;
  }

  /** @throws {CompileError} */
  inferArgs(this: Mut<this>, node: Ref<TypeNode>, arg: Type, names: Ref<Set<string>>, bindings: Mut<Map<string, Type>>, at: Ref<Span>): void {
    infer(this.cx.tables, this.cx.decls, node, arg, names, bindings, at);
  }

  checking(): InstanceId {
    return this.instanceId;
  }
  macroBody(id: BodyId): boolean {
    return this.cx.macroBodies.has(id);
  }

  /** @throws {CompileError} */
  constructor(cx: Mut<Checker>, instanceId: InstanceId, outer: Mut<BodyChecker> | undefined) {
    this.cx = cx;
    this.instanceId = instanceId;
    this.outer = outer;
  }

  // Reads what the body declares: its return, yield and error types, its receiver, captures and
  // parameters, before its statements are checked.
  /** @throws {CompileError} */
  prepare(this: Mut<this>): void {
    // A closure returns the number type the function type it meets returns, so its literals
    // take that type.
    const expected = this.f().closure?.expected;
    const given = expected !== undefined ? this.cx.tables.typing.rec(expected).returns : undefined;
    this.declared = (this.f().closure !== undefined) ? (this.f().returnType !== undefined ? this.cx.tables.typing.stored(this.cx.resolver().resolveType(this.f().returnType!)) : given !== undefined && isNumeric(given) ? given : undefined) : this.cx.instancing().returnTypeOf(this.f(), this.cx.instancing().scopeOf(this.instance().id));
    if (this.f().generator === true && this.instance().generator === undefined) {
      const symbol = this.instance().symbol;
      const made = madeBy(this.cx.tables.typing, this.cx.tables.typing.generatorType(this.f().name, this.instance().concrete, this.f().async === true), symbol);
      this.instance().generator = made;
    }
    this.generatorType = this.f().generator === true ? this.instance().generator : undefined;
    this.generatorName = (this.f().async === true) ? "AsyncGenerator" : "Generator";
    this.yielded = this.generatorType && this.declared ? this.cx.tables.typing.generatorElement(this.declared, this.f().async === true) : undefined;
    // What `next(x)` sends, which a `yield` whose value is used gives.
    this.sends = this.generatorType && this.declared ? this.cx.tables.typing.generatorSends(this.declared) : undefined;
    if (this.generatorType && this.sends !== undefined) this.cx.tables.typing.rec(this.generatorType).sends = this.instance().concrete ? this.cx.tables.typing.lowerKeepingBrands(this.sends) : this.sends;
    if (this.generatorType && this.declared && !this.yielded) throw new CompileError("E0606", `${this.f().async ? "an async" : "a"} generator function's return type is '${this.generatorName}<T>', the type of what it yields`, this.f().returnType!.start, this.f().returnType!.end);
    if (this.generatorType) this.declared = undefined;
    if (this.yielded && this.cx.tables.typing.holdsRef(this.yielded)) throw unsupported("generators yielding references", this.f().returnType!);
    const futureMade = this.f().async === true && this.f().generator !== true;
    if (futureMade && this.instance().future === undefined) {
      const symbol = this.instance().symbol;
      const made = madeBy(this.cx.tables.typing, this.cx.tables.typing.futureType(this.f().name, this.instance().concrete), symbol);
      this.instance().future = made;
    }
    this.future = futureMade ? this.instance().future : undefined;
    if (this.future && this.declared) {
      const gives = this.cx.tables.typing.promiseElement(this.declared);
      if (gives === undefined) throw new CompileError("E0305", "an async function's return type is 'Promise<T>', the type of what it gives once awaited", this.f().returnType!.start, this.f().returnType!.end);
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
    const outerSight = this.outer !== undefined ? this.outer.sight : undefined;
    this.sight = this.cx.resolver().openSight(this.f().bodyId, outerSight);
    this.cx.resolver().setSight(this.sight);
    this.targets = [];
    this.facts = [];
    this.handlers = [];
    this.comptimeDepth = 0;
    this.floors = [];
    this.changed = [];
    this.assigned = assignedNames(this.f().body);
    this.written = [];
    this.closureAssigned = closureAssigned(this.f().body);
    this.nestedLent = new Set();
    this.closureChanged = new Set();
    this.narrowReads = [];
    this.loops = [];
    this.changedParams = new Set();
    this.assignedParams = new Set();
    this.copiedParams = [];
    this.depths = new Map<LocalId, usize>();
    this.caseOnly = new Set<LocalId>();
    this.unset = new Set(this.f().self?.constructor ? this.cx.registry().classOf(this.f().self!.type).required : []);
    this.superCall = this.f().self?.constructor && this.cx.tables.typing.rec(this.f().self!.type).base ? (this.f().body.find((s) => !this.cx.tables.prologues.has(s)) as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (this.superCall) this.unset.add(SUPER);
    this.built = false;

    // In a member of a generic class's instance, `this` is the class made from the type
    // parameters as this body sees them, so it reads through their bounds as the definition did.
    const generic = this.f().self && this.cx.tables.typing.rec(this.f().self!.type).generic;
    const resolver = this.cx.resolver();
    const viewed = generic && this.cx.genericClasses().classNamed(generic.name, this.cx.registry().classOf(this.f().self!.type).node.typeParams.map((p) => resolver.resolveType({ id: nextId(this.cx.tables.ids), kind: "ref", name: p.name, args: [], start: this.f().start, end: this.f().start })), this.f(), true)!;
    this.enclosing = this.f().closure && selfOf(this.cx.tables.arenas, this.f());
    this.self = this.f().closure ? this.enclosing && { ...this.enclosing, constructor: false, mutable: false, owned: false } : this.f().self && { ...this.f().self!, type: viewed ?? this.f().self!.type };
    this.captures = this.instance().captures;
    this.owning = this.f().closure !== undefined && (this.f().async === true || this.f().closure!.move === true);
    this.owner = this.f().closure ? this.closureOwner(this.f()) : this.f().declared ?? (this.f().owner && this.f().owner === this.f().self?.type ? this.self!.type : this.f().owner);
    this.syncMain = this.cx.tables.timerMains.has(this.f() as Body & Func);
    this.closing = this.f().closure !== undefined;
    this.generator = this.f().generator === true;
    this.runtime = !this.cx.library && this.cx.funcs.some((g) => this.cx.tables.arenas.bodyOf(g).name === "main" && this.cx.tables.arenas.bodyOf(g).async === true);
    this.locked = this.f().closure?.expected === undefined ? undefined : this.cx.tables.typing.lockCallbacks.get(this.f().closure!.expected!);
    this.sharing = this.f().closure?.expected !== undefined && this.cx.tables.typing.sharedCallbacks.has(this.f().closure!.expected!);
    this.counting = this.f().closure?.expected !== undefined && this.cx.tables.typing.rcCallbacks.has(this.f().closure!.expected!);
    this.async = this.f().async === true;
    this.unsafe = this.f().closure?.unsafe === true;
    this.exprsState = new ExpressionsState(this.unsafe);

    // A call leaves out only the last parameters, so none may be required after an optional one.
    const late = this.f().params.find((p, i) => !p.optional && !p.rest && this.f().params.slice(0, i).some((q) => q.optional));
    if (late) throw new CompileError("E0408", "a required parameter can't follow an optional one; move it before them, or make it optional too", late.start, late.end);
    this.contextual = this.f().closure && !this.f().throws && this.f().closure!.self === undefined && !this.f().async && this.f().closure!.expected && !this.cx.tables.typing.openThrows.has(this.f().closure!.expected!) ? this.f().closure!.expected : undefined;
    this.inferring = this.f().closure !== undefined && !this.f().throws && this.f().closure!.self === undefined && !this.contextual ? [] as [Expr | Stmt, Type][] : undefined;
    this.errorType = this.f().throws ? this.cx.resolver().resolveType(this.f().throws!) : this.contextual && this.cx.tables.typing.rec(this.contextual).throws;
    if (this.errorType === "void") throw new CompileError("E0118", "a function can't throw 'void'; throw a value", this.f().throws!.start, this.f().throws!.end);
    if (this.errorType && this.cx.tables.typing.holdsRef(this.errorType)) throw unsupported("errors holding references", this.f().throws!);
    this.instance().throws = this.errorType;
    // Advancing a generator runs its body, so that is what throws, not calling it.
    if (this.generatorType && this.errorType) this.cx.tables.typing.rec(this.generatorType).throws = this.instance().concrete ? this.cx.tables.typing.lower(this.errorType) : this.errorType;
    this.params = this.f().closure ? this.f().params.map((p, i) => this.closureParam(p, i, this.f().closure!.expected!)) : this.cx.instancing().paramTypes(this.instance().id, this.cx.instancing().scopeOf(this.instance().id));
    // An owned parameter is the body's own, as a `let` is; one holding a reference keeps the
    // caller's lifetime, which a new value could outlive.
    this.f().params.forEach((p, i) => {
      this.declare(paramName(p), this.params[i]!, !this.cx.tables.typing.holdsRef(this.params[i]!), true, p);
      if (assignsOwn(this.f().body, paramName(p))) this.assignedParams.add(this.locals().get(p)!);
    });
    this.hidden = false;
  }
  // The expression checker, made over this body where it is used.
  exprs(this: Mut<this>): Expressions<BodyChecker> {
    return new Expressions(this);
  }

  members(this: Mut<this>): Members {
    return this.cx.members();
  }


  /** @throws {CompileError} */
  enumInstance(this: Mut<this>, name: string, args: Type[], at: Ref<Span>): EnumInstance {
    return this.cx.resolver().enumInstance(name, args, at);
  }

  /** @throws {CompileError} */
  enumMember(this: Mut<this>, name: string, member: string): LiteralType | undefined {
    return this.cx.enumMember(name, member);
  }

  /** @throws {CompileError} */
  enumMemberNames(this: Mut<this>, name: string): string[] {
    return this.cx.enumMemberNames(name);
  }

  /** @throws {CompileError} */
  construct(this: Mut<this>, name: string, typeArgs: Ref<TypeNode[]>, argTypes: Type[], at: Ref<Span>): ClassId | undefined {
    const made = this.cx.genericClasses().construct(name, typeArgs, argTypes, at);
    return made !== undefined ? made.classId : undefined;
  }

  templateParams(this: Mut<this>, name: string): Param[] | undefined {
    return this.cx.templateParams(name);
  }

  definedClass(this: Mut<this>, name: string): ClassId | undefined {
    return this.cx.genericClasses().definedClass(name)?.classId;
  }

  /** @throws {CompileError} */
  returnOf(this: Mut<this>, instanceId: InstanceId, at: Ref<Span>): Type {
    return this.cx.returnOf(instanceId, at);
  }

  /** @throws {CompileError} */
  resultOf(this: Mut<this>, instanceId: InstanceId, at: Ref<Span & Id>): Type {
    return this.cx.resultOf(instanceId, at);
  }

  /** @throws {CompileError} */
  sourcesOf(this: Mut<this>, instanceId: InstanceId, args: Ref<Expr[]>, receiver: Ref<Expr> | undefined, at: Ref<Span>, lent: Ref<boolean[]>): Expr[] {
    return this.cx.sourcesOf(instanceId, args, receiver, at, lent);
  }

  /** @throws {CompileError} */
  classOf(this: Mut<this>, t: ClassType): ClassId {
    return this.cx.registry().classOf(t).classId;
  }

  /** @throws {CompileError} */
  instanceOf(this: Mut<this>, f: BodyId, bindings: Map<string, Type> | undefined): InstanceId {
    const sig = cloneSignature(this.cx.tables.arenas.bodyOf(f));
    return this.cx.instancing().instanceOf(sig, bindings).id;
  }

  /** @throws {CompileError} */
  instantiate(this: Mut<this>, f: BodyId, typeArgs: Ref<TypeNode[]>, args: Ref<Expr[]>, argTypes: Type[], at: Ref<Span & Id>): InstanceId {
    const sig = cloneSignature(this.cx.tables.arenas.bodyOf(f));
    return this.cx.instancing().instantiate(sig, typeArgs, args, argTypes, at).id;
  }

  /** @throws {CompileError} */
  paramTypes(this: Mut<this>, instanceId: InstanceId): Type[] {
    return this.cx.instancing().paramTypes(instanceId);
  }

  names(this: Mut<this>, at: usize): string[] {
    return [...this.inScope(), ...this.cx.reached([...this.cx.byName.keys()].map((n) => n.replace(/^const /, "")), at)];
  }

  classNames(at: usize): string[] {
    return this.cx.reached([...this.cx.classes.keys(), ...this.cx.templates.keys()], at);
  }

  /** @throws {CompileError} */
  asWritten(this: Mut<this>) {
    this.cx.asWritten(this.instanceId);
  }

  envOf(this: Mut<this>, e: Ref<Expr>, of: InstanceId, env: LocalId[]): void {
    let inst = this.instance();
    if (inst.envs !== undefined) inst.envs.set(cloneExpr(e), { of, env });
    else {
      let made = new NodeMap<Expr, { of: InstanceId; env: LocalId[] }>();
      made.set(cloneExpr(e), { of, env });
      inst.envs = made;
    }
  }

  dynOf(this: Mut<this>, e: Ref<Expr>, table: DynTable): void {
    let inst = this.instance();
    if (inst.dyns !== undefined) inst.dyns.set(cloneExpr(e), table);
    else {
      let made = new NodeMap<Expr, DynTable>();
      made.set(cloneExpr(e), table);
      inst.dyns = made;
    }
  }

  private markUnreached(this: Mut<this>, s: Ref<Stmt>): void {
    let inst = this.instance();
    if (inst.unreached !== undefined) inst.unreached.add(cloneStmt(s));
    else {
      let made = new NodeSet<Stmt>();
      made.add(cloneStmt(s));
      inst.unreached = made;
    }
  }
  private recordIterator(this: Mut<this>, s: Ref<Stmt>, call: Expr): void {
    let inst = this.instance();
    if (inst.iterators !== undefined) inst.iterators.set(cloneStmt(s), call);
    else {
      let made = new NodeMap<Stmt, Expr>();
      made.set(cloneStmt(s), call);
      inst.iterators = made;
    }
  }

  // A match arm runs in a scope of its own, holding the names its pattern binds.
  enterArm(this: Mut<this>): void {
    this.pushScope(new Map<string, LocalId>());
  }

  leaveArm(this: Mut<this>): void {
    this.popScope();
  }

  /** @throws {CompileError} */
  block(this: Mut<this>, arm: Ref<Extract<Stmt, { kind: "block" }>>, wanted: boolean): [Expr, Type][] {
    const gives: [Expr, Type][] = [];
    const done = this.within({ stmt: standIn(arm), kind: "arm" as const, wanted, gives }, () => this.statement(arm));
    if (wanted && !alwaysReturns(arm.body, this.cx.broken, this.cx.continued)) {
      throw new CompileError("E0601", "this arm can reach its end without giving a value; give one with 'return', as in an arrow's block", arm.end - 1, arm.end);
    }
    return done.gives!;
  }

  /** @throws {CompileError} */
  bind(this: Mut<this>, name: string, type: Type, node: Ref<Expr>): LocalId {
    this.declare(name, type, false, false, node);
    return this.locals().get(node)!;
  }

  captured(lId: LocalId): boolean {
    return this.capturesHas(lId);
  }
  private capturesHas(l: LocalId): boolean {
    return this.captures !== undefined && this.captures.has(l);
  }
  // The binding outside a closure that one of its locals captures.
  private outsideOf(l: LocalId): LocalId | "this" | undefined {
    return this.captures !== undefined ? this.captures.get(l) : undefined;
  }

  enterComptime(this: Mut<this>): void {
    this.comptimeDepth++;
  }

  leaveComptime(this: Mut<this>): void {
    this.comptimeDepth--;
  }

  /** @throws {CompileError} */
  errorOf(this: Mut<this>, instanceId: InstanceId): Type | undefined {
    return this.cx.errorOf(instanceId);
  }

  throwsDeclared(): Type | undefined {
    return this.held().throws;
  }

  reachable(lId: LocalId): boolean {
    const l = this.cx.localOf(lId);
    return !this.caseOnly.has(l.localId);
  }

  depthOf(lId: LocalId): usize {
    const l = this.cx.localOf(lId);
    return this.depths.get(l.localId)!;
  }

  /** @throws {CompileError} */
  resolveWith(this: Mut<this>, t: Ref<TypeNode>, scope: Map<string, Type>): Type {
    return this.cx.resolver().resolveIn(scope, t);
  }

  closureBody(this: Mut<this>, t: ClosureType): InstanceId {
    return this.cx.closureBodies.get(t)!;
  }

  /** @throws {CompileError} */
  resolveType(this: Mut<this>, t: Ref<TypeNode>): Type {
    return this.cx.resolver().resolveType(t);
  }

  /** @throws {CompileError} */
  implicitOf(this: Mut<this>, fId: BodyId): Map<usize, Bound> {
    return this.cx.instancing().implicitOf(fId);
  }

  /** @throws {CompileError} */
  callbackType(this: Mut<this>, fId: BodyId, typeArgs: Ref<TypeNode[]>, argTypes: (Type | undefined)[], i: usize, at: Ref<Span>): FunctionType | undefined {
    const f = cloneSignature(this.cx.tables.arenas.bodyOf(fId));
    return this.cx.instancing().callbackType(f, typeArgs, argTypes, i, at);
  }

  /** @throws {CompileError} */
  constructs(this: Mut<this>, fId: BodyId, args: Ref<Expr[]>, argTypes: Type[]): void {
    const f = cloneSignature(this.cx.tables.arenas.bodyOf(fId));
    this.cx.instancing().constructs(f, args, argTypes);
  }

  // A candidate meeting another integer type demands it, for the next pass.
  // A closure's capture stands for the variable it captures. The first demand decides,
  // and a different one is the usual mismatch once it applies.
  infer(this: Mut<this>, e: Ref<Expr>, to: Type): boolean {
    let local = e.kind === "ident" ? this.locals().get(e) : undefined;
    let at: InstanceId | undefined = this.instanceId;
    while (local !== undefined && at !== undefined) {
      const from = capturedFrom(this.cx.tables.arenas, at, local);
      if (from === undefined) break;
      local = from === "this" ? undefined : from;
      at = parentOf(this.cx.tables.arenas, at);
    }
    const s = local !== undefined ? this.cx.candidates.get(local) : undefined;
    if (s === undefined || !isInteger(to) || to === "i64") return false;
    if (this.cx.demands.has(s)) return this.cx.demands.get(s) === to;
    this.cx.demands.set(s, to);
    this.cx.demanded++;
    return true;
  }

  // A closure's change to what it captures, which a call of it could make at any time, so all
  // that was known of the root's fields is forgotten.
  /** @throws {CompileError} */
  changesLocal(this: Mut<this>, l: Ref<Local>, path: string, action: string, target: Ref<Expr>, throughMut: boolean): void {
    this.closureChanged.add(String(l.localId));
    this.changesPath(l.localId, "", action, target);
    this.exprs().changesLocal(l.localId, path, action, target, throughMut);
  }

  /** @throws {CompileError} */
  changesThis(this: Mut<this>, path: string, action: string, target: Ref<Expr>): void {
    this.closureChanged.add("this");
    this.changesPath("this", "", action, target);
    this.exprs().changesThis(path, action, target);
  }

  // A statement of the body itself, where a constructor's field assignments and its `super`
  // call are tracked.
  /** @throws {CompileError} */
  private topStatement(this: Mut<this>, s: Stmt): Facts | undefined {
    const assigned = this.unset.size > 0 ? this.fieldAssignment(s) : undefined;
    this.exempt = assigned?.object.id;
    this.hidden = this.f().self?.constructor === true && this.cx.registry().classOf(this.f().self!.type).initializers.has(s);
    const after = this.statement(s);
    this.exempt = undefined;
    this.hidden = false;
    if ((assigned !== undefined)) this.unset.delete(assigned.name);
    if (s.kind === "expr" && s.expr === this.superCall) this.unset.delete(SUPER);
    if (assigned !== undefined || (s.kind === "expr" && s.expr === this.superCall)) this.built = true;
    return after;
  }

  /** @throws {CompileError} */
  check(this: Mut<this>) {
    this.statements(this.f().id, "body", this.f().body, true);
    this.exprs().finish();
    const stale = this.copiedParams.find((c) => this.changedParams.has(c.local.localId));
    if (stale) throw new CompileError("E0210", `the async nested function '${stale.nested}' takes its own copy of '${stale.local.name}' when it is made, so a change to it wouldn't reach the function; pass '${stale.local.name}' as a parameter, or leave it unchanged`, stale.at.start, stale.at.end);
    // An inferred error is every one the body lets out, widened as a `let` is.
    if (this.inferring && this.inferring.length > 0) {
      this.errorType = this.cx.tables.typing.unionType(this.inferring.map(([, t]) => this.cx.tables.typing.widenLet(t)));
      for (const [at, from] of this.inferring) this.instance().raises.set(at, { from, to: this.errorType });
      this.instance().throws = this.errorType;
    }
    if (this.unset.size > 0) {
      const missing = this.cx.registry().classOf(this.f().self!.type).fields.find((d) => this.unset.has(d.name))!;
      throw new CompileError("E0703", `property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    if (this.generatorType) {
      if (!this.yielded) throw new CompileError("E0606", `this generator never yields, so what it gives can't be told; declare it as '${this.generatorName}<T>'`, (this.f().returnType ?? this.f()).start, (this.f().returnType ?? this.f()).end);
      const laid = (t: Type) => (this.instance().concrete ? this.cx.tables.typing.lower(t) : t);
      this.cx.tables.typing.rec(this.generatorType).yields = this.instance().concrete ? this.cx.tables.typing.lowerKeepingBrands(this.yielded) : this.yielded;
      this.cx.tables.typing.rec(this.generatorType).params = this.f().params.map((p, i) => ({ name: paramName(p), type: laid(this.params[i]!) }));
      // A generator method's frame holds its object, as an async method's future does.
      if (this.f().self && !this.f().self!.constructor) this.cx.tables.typing.rec(this.generatorType).params.unshift(receiverField(this.cx.tables.typing, this.f().self!, this.instance().concrete));
    }
    const gives = this.declared ?? this.inferred ?? "void";
    // A closure's signature and an async result are kept as written, so a pattern in one would
    // reach the binary.
    if (this.cx.tables.typing.holdsPattern(gives) && (this.future || this.f().closure)) throw unsupported(`template literal pattern types in ${this.future ? "async results" : "closure results"}`, this.f().returnType ?? this.f());
    if (this.f().closure && this.params.some((t) => this.cx.tables.typing.holdsPattern(t))) throw unsupported("template literal pattern types in closure parameters", this.f());
    if (this.future) {
      if (this.cx.tables.typing.holdsRef(gives)) throw unsupported("async functions giving references", this.f().returnType ?? this.f());
      const laid = (t: Type) => (this.instance().concrete ? this.cx.tables.typing.lower(t) : t);
      // An inferred result widens as a `let` does: an async `return "x"` gives a string.
      const given = this.f().returnType ? gives : this.cx.tables.typing.widenLet(gives);
      this.cx.tables.typing.rec(this.future).gives = this.instance().concrete ? this.cx.tables.typing.lowerKeepingBrands(given) : given;
      this.cx.tables.typing.rec(this.future).throws = this.errorType && laid(this.errorType);
      this.cx.tables.typing.rec(this.future).params = this.f().params.map((p, i) => ({ name: paramName(p), type: laid(this.params[i]!) }));
      // An async method's future holds its object: borrowed, or owned under `Own<this>`.
      const self = this.f().self && !this.f().self!.constructor ? receiverField(this.cx.tables.typing, this.f().self!, this.instance().concrete) : undefined;
      if (self) this.cx.tables.typing.rec(this.future).params.unshift(self);
    }
    const type = this.generatorType ?? this.future ?? gives;
    if (this.f().closure && this.cx.tables.typing.holdsRef(type)) throw unsupported("closures returning references", this.f().returnType ?? this.f().closure!.value ?? this.f());
    if (!this.f().closure) this.cx.lifetimes(this.f());
    // A returned value holding references may point into any parameter, or `this`.
    const everything: Origin[] = [...this.f().params.map((_, i) => i), ...(this.f().self && !this.f().self!.owned ? ["this" as const] : [])];
    const ref = this.cx.isRef(type) ? type : this.cx.tables.typing.optionRef(type);
    const origins = ref ? this.cx.originsOf(this.f(), this.params, ref) : this.cx.tables.typing.holdsRef(type) ? this.cx.heldOrigins(this.f()) ?? everything : [];
    if (gives !== "void" && !this.generatorType && !alwaysReturns(this.f().body, this.cx.broken, this.cx.continued)) {
      const at = this.f().returnType ?? this.f();
      throw new CompileError("E0601", "not all code paths return a value", at.start, at.end);
    }
    // From here on the body is read as a plain tree, its replacements in place.
    const bodyId = this.f().bodyId;
    const edited = this.cx.tables.rewrites.listIn(bodyId, this.f().id, "body");
    let body = this.cx.tables.arenas.bodyMut(bodyId);
    if (edited !== undefined) body.body = edited;
    for (let i = 0; i < body.params.length; i++) body.params[i] = rebuiltParam(body.params[i]!, this.cx.tables.rewrites);
    this.cx.tables.rewrites.rebuilding = bodyId;
    rebuiltStmts(body.body, this.cx.tables.rewrites);
    this.cx.tables.rewrites.rebuilding = undefined;
    // A method this body calls on an object holding references is checked first, so the move
    // check knows whether it keeps what it is lent.
    for (const target of this.instance().calls.values()) this.cx.keepsKnown(target, this.instance().id);
    let moved = timed(this.cx.tables.session.timings, "moves", () => checkMoves(this.cx.tables, this.f(), this.instance(), origins));
    const assumed = this.instance().keepsAssumedBy;
    if (moved.keeps && assumed !== undefined) {
      // A body calling itself took itself to keep nothing; since it keeps, its calls are checked
      // again as calls that keep.
      if (assumed.size === 1 && assumed.has(this.instance().id)) {
        this.instance().keeps = true;
        this.instance().keepsAssumedBy = undefined;
        moved = timed(this.cx.tables.session.timings, "moves", () => checkMoves(this.cx.tables, this.f(), this.instance(), origins));
      } else {
        throw new CompileError("E0209", `'${this.f().name}' keeps what it is lent in 'this', but a call of it made while it was still being checked was taken not to; store an owned value instead, or don't lend it a value of the caller's own`, this.f().start, this.f().end);
      }
    }
    for (const id of moved.captures) this.instance().moved!.add(id);
    for (const id of moved.consumes) this.instance().consumes.add(id);
    this.instance().keeps = moved.keeps;
    // A class's own `clone()` replaces the compiler's copy, so it has to make one.
    if (this.self !== undefined && this.cx.registry().classOf(this.self.type).methods.get("clone") === this.f().bodyId && (this.f().params.length > 0 || type !== this.self.type)) {
      throw new CompileError("E0213", `a 'clone' method must take no parameters and return '${this.cx.tables.typing.show(this.self.type)}', since it replaces the compiler's copy`, this.f().start, this.f().end);
    }
    this.instance().returns = type;
    if (this.instance().concrete) this.cx.lowerTables(this.instance().id);
    if (this.generatorType) frameOf(this.cx.tables, this.instance(), this.generatorType);
    if (this.future) frameOf(this.cx.tables, this.instance(), this.future);
    this.cx.done.add(this.instance().id);
    this.cx.inProgress.delete(this.instance().id);
  }

  // The scopes this body's bindings are declared in, innermost last. Every type written from here
  // on, in annotations, casts and closures, sees their names; only a type written inside the body
  // does, as one written elsewhere is resolved here only because the body needed it.
  private scopeList(): Ref<Map<string, LocalId>[]> {
    return this.cx.resolverState.sights[this.sight]!.scopes;
  }
  private pushScope(this: Mut<this>, scope: Map<string, LocalId>): void {
    this.cx.resolverState.sights[this.sight]!.scopes.push(scope);
  }
  private popScope(this: Mut<this>): void {
    this.cx.resolverState.sights[this.sight]!.scopes.pop();
  }
  // The bindings the innermost scope holds.
  private innerLocals(): LocalId[] {
    const scopes = this.scopeList();
    return [...scopes[scopes.length - 1]!.values()];
  }
  // The innermost scope, where a declaration goes.
  private innerScope(this: Mut<this>): Mut<Map<string, LocalId>> {
    const at = this.cx.resolverState.sights[this.sight]!.scopes.length - 1;
    return this.cx.resolverState.sights[this.sight]!.scopes[at]!;
  }
  // A `Mut` variable is never pointed elsewhere, so assigning it doesn't stop it narrowing.
  // A capture narrows as a variable of the closure's would. A binding holding no reference
  // narrows between its writes, unless a closure writes it, whose calls a check can't see.
  narrowable(this: Mut<this>, l: Ref<Local>): boolean {
    const own = this.capturesHas(l.localId) ? !this.assigned.has(l.name) && !this.nestedLent.has(l.localId) : !this.cx.tables.typing.holdsRef(l.type) ? !this.closureAssigned.has(l.name) && !this.nestedLent.has(l.localId) : l.param ? !this.assignedParams.has(l.localId) : !l.mutable || !this.assigned.has(l.name);
    return own || (this.cx.isRef(l.type) && this.cx.tables.typing.rec(l.type).mutable);
  }
  // Whether a binding of this body is written anywhere in it, so a closure can't trust a check
  // made where it was written.
  reassigned(lId: LocalId): boolean {
    const l = this.cx.localOf(lId);
    if (this.cx.tables.typing.holdsRef(l.type)) return false;
    return l.param ? this.assignedParams.has(l.localId) : l.mutable && this.assigned.has(l.name);
  }
  // A write to a binding holding no reference forgets what any check or assignment said of it.
  forget(this: Mut<this>, lId: LocalId, at: Ref<Span>): void {
    this.forgetPaths(String(lId), at);
    const type = this.cx.localOf(lId).type;
    if (this.cx.tables.typing.holdsRef(type)) return;
    this.written.push({ local: bindingKey(lId), at: at.start });
    const key = bindingKey(lId);
    this.drop((k) => k === key);
  }
  // Forgets what was known of the field paths at or below `prefix`.
  forgetPaths(this: Mut<this>, prefix: string, at: Ref<Span>): void {
    if (!this.facts.some((f) => [...f.keys()].some((k) => covers(prefix, k)))) return;
    this.written.push({ local: prefix, at: at.start });
    this.drop((k) => isPath(k) && covers(prefix, k));
  }
  drop(this: Mut<this>, gone: (k: string) => boolean) {
    for (let i = 0; i < this.facts.length; i++) {
      if (![...this.facts[i]!.keys()].some((k) => gone(k))) continue;
      this.facts[i] = new Map([...this.facts[i]!].filter(([k]) => !gone(k)));
    }
  }
  // Forgets, before a loop, what is known of the bindings it assigns, since a later iteration
  // could reach any read in it with another member.
  forgetLoop(this: Mut<this>, loop: Ref<Stmt>): void {
    const known = new Set(this.facts.flatMap((f) => [...f.keys()]));
    const roots = fieldRoots([loop]);
    for (const id of known) {
      if (isPath(id)) {
        const root = id.split(/[.[]/)[0]!;
        const name = root === "this" ? root : this.cx.localOf(keyId(root)).name;
        if (roots.has(name) || (root !== "this" && assignsOwn([loop], name))) this.forgetPaths(root, loop);
        continue;
      }
      const named = this.cx.localOf(keyId(id)).name;
      if (assignsOwn([loop], named)) this.forget(keyId(id), loop);
    }
  }
  // Lending a binding mutably may give it another member, so what was known of it is forgotten,
  // in the body a closure captures it from too. A read earlier in a loop, checked as narrowed by
  // something from before the loop, would see the new member the next time round, so that is
  // refused.
  /** @throws {CompileError} */
  lendsWhole(this: Mut<this>, lId: LocalId, at: Ref<Expr>): void {
    const l = this.cx.localOf(lId);
    if (this.cx.tables.typing.holdsRef(l.type)) return;
    const outside = this.outsideOf(l.localId);
    if (outside === "this") return;
    if (outside !== undefined) {
      this.forget(l.localId, at);
      const from = this.cx.localOf(outside);
      this.outer!.lendsWhole(from.localId, at);
      if (this.f().closure?.self !== undefined) this.outer!.lentPerCall(from.localId);
      return;
    }
    this.loopChange(String(l.localId), "mutably borrow", l.name, at);
    const from = this.facts.findIndex((f) => f.has(bindingKey(l.localId)));
    const loop = from < 0 ? undefined : this.loops.find((x) => (x.facts as i64) > from);
    if (loop && this.narrowReads.slice(loop.reads).some((r) => r.local === bindingKey(l.localId) && r.at !== at.id)) {
      throw new CompileError("E0109", `can't lend '${l.name}' mutably here: earlier in this loop it was read as narrowed by what was known before the loop, and the next time round it may hold another member; check or assign it inside the loop`, at.start, at.end);
    }
    this.forget(l.localId, at);
  }
  narrowRead(this: Mut<this>, lId: LocalId, at: Ref<Expr>): void {
    this.narrowReads.push({ local: bindingKey(lId), at: at.id });
    const outside = this.outsideOf(lId);
    if (outside !== undefined && outside !== "this" && this.outer !== undefined) this.outer.narrowRead(outside, at);
  }
  lentPerCall(this: Mut<this>, l: LocalId): void {
    this.nestedLent.add(l);
  }
  // The key a field path narrows under: its root's id or `this`, then its fields as a change to
  // them is shown. Only plain fields of objects and classes make one, read through no getter or
  // `?.`, below a root no closure changes.
  pathKey(this: Mut<this>, written: Ref<Expr>): string | undefined {
    const e = this.cx.tables.rewrites.current(written);
    if (e.kind === "this") return this.closureChanged.has("this") ? undefined : "this";
    if (e.kind === "ident") {
      const id = this.locals().get(e);
      return id === undefined || this.closureChanged.has(String(id)) ? undefined : String(id);
    }
    if (e.kind !== "member" || e.optional || this.calls().has(e) || this.cx.tables.computed.has(e) || this.cx.tables.jsMembers.has(e) || this.copiesOut().has(e)) return undefined;
    const t = this.types().get(e.object);
    const r = this.cx.recOf(t);
    const holder = r?.kind === "ref" ? r.to : t;
    if (holder === undefined || typeof holder === "string") return undefined;
    const h = this.cx.tables.typing.unfold(holder);
    const hr = this.cx.recOf(h);
    // Through a parameter typed by an object type, a field is read with the type its bound gives.
    const bound = hr?.kind === "param" ? hr.bound : h;
    const kind = this.cx.recOf(bound)?.kind;
    if (kind !== "object" && kind !== "class") return undefined;
    const field = this.cx.tables.typing.field(bound as Exclude<Type, string>, e.name);
    if (!field) return undefined;
    const root = this.pathKey(e.object);
    return root === undefined ? undefined : `${root}${/^\d+$/.test(e.name) ? `[${e.name}]` : `.${shownName(e.name)}`}`;
  }
  // Whether something is known of the field paths at or below `prefix`. A change there, in a loop
  // that read one of them as narrowed by a check from before the loop, is refused.
  /** @throws {CompileError} */
  loopChange(this: Mut<this>, prefix: string, action: string, shown: string, at: Ref<Expr>): boolean {
    const from = this.facts.findIndex((f) => [...f.keys()].some((k) => isPath(k) && covers(prefix, k)));
    if (from < 0) return false;
    const loop = this.loops.find((x) => (x.facts as i64) > from);
    if (loop && this.narrowReads.slice(loop.reads).some((r) => isPath(r.local) && covers(prefix, r.local) && r.at !== at.id)) {
      throw new CompileError("E0109", `can't ${action} '${shown}' here: earlier in this loop a field it reaches was read as narrowed by what was known before the loop, and the next time round it may hold another member; check it inside the loop`, at.start, at.end);
    }
    return true;
  }
  // What the innermost facts that know of `key` say of it.
  private factOf(key: string): Type | undefined {
    for (let i = this.facts.length; i > 0; i--) {
      const t = this.facts[i - 1]!.get(key);
      if (t !== undefined) return t;
    }
    return undefined;
  }
  // A field's type where a check narrowed its path, noting the read.
  narrowedField(this: Mut<this>, e: Ref<Expr>): Type | undefined {
    const key = this.pathKey(e);
    const t = key === undefined ? undefined : this.factOf(key);
    if (t !== undefined) this.narrowReads.push({ local: key!, at: e.id });
    return t;
  }
  present(this: Mut<this>, object: Ref<Expr>, name: string): boolean {
    const root = this.pathKey(object);
    return root !== undefined && this.facts.some((f) => f.has(presentKey(root, name)));
  }
  // A change at `path` inside a binding or `this` forgets what was known of the field paths it
  // reaches, below an element all of the array's. Lending a path as the one member a check
  // narrowed it to, or updating it in place as `+=` does, keeps that member.
  /** @throws {CompileError} */
  changesPath(this: Mut<this>, rootId: LocalId | "this", path: string, action: string, at: Ref<Expr>): void {
    const rootName = rootId === "this" ? rootId : this.cx.localOf(rootId).name;
    const cut = path.indexOf("[...]");
    const prefix = `${rootId === "this" ? rootId : String(rootId)}${cut < 0 ? path : path.slice(0, cut)}`;
    if (!this.loopChange(prefix, action, `${rootName}${path}`, at)) return;
    const kept = action !== "assign to" || this.exprsState.updating === at.id ? this.factOf(prefix) : undefined;
    const keeps = kept !== undefined && kept === this.types().get(at) && this.cx.recOf(kept)?.kind !== "union";
    if (!keeps) return this.forgetPaths(prefix, at);
    const below = (k: string) => isPath(k) && k !== prefix && covers(prefix, k);
    for (const k of new Set(this.facts.flatMap((f) => [...f.keys()].filter(below)))) this.written.push({ local: k, at: at.start });
    this.drop(below);
  }
  // A call of a function whose result is `x is T` narrows its argument for x to T.
  /** @throws {CompileError} */
  predicate(this: Mut<this>, call: Ref<Extract<Expr, { kind: "call" }>>): { index: usize; type: Type } | undefined {
    const targetId = this.calls().get(call);
    if (targetId === undefined) return undefined;
    const target = this.cx.tables.arenas.instanceOf(targetId);
    const f = bodyOf(this.cx.tables.arenas, target);
    const p: Ref<TypeNode> | undefined = f.returnType;
    if (p === undefined || p.kind !== "predicate" || p.type === undefined) return undefined;
    const name = p.name;
    const index = f.params.findIndex((x) => x.pattern.kind === "ident" && x.pattern.name === name) as usize;
    const written = cloneTypeNode(p.type!);
    let scope = new Map<string, Type>();
    for (const [n, t] of target.bindings) scope.set(n, t);
    const type = this.cx.resolver().resolveIn(scope, written);
    return { index, type };
  }
  predicateNarrows(this: Mut<this>, call: Ref<Extract<Expr, { kind: "call" }>>, index: usize, type: Type, yes: boolean, no: boolean): void {
    if (!yes && !no) return;
    let inst = this.instance();
    if (inst.predicates !== undefined) inst.predicates.set(cloneExpr(call), { index, type, yes, no });
    else {
      let made = new NodeMap<Expr, { index: usize; type: Type; yes: boolean; no: boolean }>();
      made.set(cloneExpr(call), { index, type, yes, no });
      inst.predicates = made;
    }
  }
  typeChecked(e: Ref<Expr>): Type | undefined {
    return this.held().types.get(e);
  }
  localRead(e: Ref<Expr>): LocalId | undefined {
    return this.held().locals.get(e);
  }
  // A binding the condition itself writes isn't narrowed by it.
  /** @throws {CompileError} */
  proves(this: Mut<this>, e: Ref<Expr>): Guard {
    const proven = guard(this, e);
    const inside = this.written.filter((w) => w.at >= e.start && w.at < e.end);
    // A variable compared as declared, in a check it was already narrowed past, stays as narrow.
    let declared = new Set<LocalId>();
    walk({ of: "expr", node: e }, (n) => {
      if (n.of === "expr" && n.node.kind === "ident" && this.exprsState.asDeclared.has(n.node)) declared.add(this.locals().get(n.node)!);
    });
    if (inside.length === 0 && declared.size === 0) return proven;
    const keep = (f: Facts) => new Map([...f].filter(([l]) => !inside.some((w) => covers(w.local, l))).map(([l, t]) => [l, declared.has(keyId(l)) ? this.narrowedPast(keyId(l), t) : t] as const));
    return { yes: keep(proven.yes), no: keep(proven.no) };
  }
  // What a check on a variable read as declared leaves of what it was narrowed to.
  narrowedPast(this: Mut<this>, id: LocalId, t: Type): Type {
    const now = this.narrowed(id);
    const members = (x: Type): Type[] => {
      const r = this.cx.recOf(x);
      return r?.kind === "union" ? r.members : [x];
    };
    const kept: Type[] = now === undefined ? [] : members(t).filter((m) => members(now).some((k) => this.cx.tables.typing.fits(m, k)));
    return kept.length === 0 ? t : this.cx.tables.typing.unionType(kept);
  }

  // Nested functions go right after the declarations of the variables they use, as early as
  // that allows, so a call before a function's own statement still finds it, as JavaScript's
  // hoisting does. A function using another goes after it.
  hoist(list: Mut<Stmt[]>): void {
    // An async one takes over what it uses when it is made, so it stays where it is written.
    const functions = nestedFunctions(list);
    if (functions.length === 0) return;
    for (let pass: usize = 0; pass < functions.length; pass++) {
      for (const id of functions) {
        const fn = list.splice(list.findIndex((s) => s.id === id), 1)[0]!;
        const used = fn.kind === "function" ? freeNames(fn) : new Set<string>();
        const name = fn.kind === "function" ? fn.name : "";
        let at = 0;
        for (let i = 0; i < list.length; i++) if (declaredNames(list[i]!).some((n) => n !== name && used.has(n))) at = i + 1;
        list.splice(at, 0, fn);
      }
    }
  }

  // `name(...)` inside the nested function `name`: a call of itself, with its own captures.
  /** @throws {CompileError} */
  selfCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): { type: Type; what: string } | undefined {
    const name = (e.callee as Extract<Expr, { kind: "ident" }>).name;
    // A name the body declares itself is that, not the function.
    if (this.f().closure?.self !== name || this.scopeList().some((scope) => scope.has(name))) return undefined;
    if ((this.f().returnType === undefined)) throw new CompileError("E0104", `'${name}' calls itself, so its return type has to be written, as TypeScript requires, as in 'function ${name}(...): T'`, e.start, e.end);
    if (this.f().async === true) throw unsupported("async nested functions that call themselves", e);
    const required = this.f().params.filter((p) => !p.optional && !p.rest).length;
    if (e.args.length < required || e.args.length > this.f().params.length) throw new CompileError("E0501", `expected ${required === this.f().params.length ? `${required}` : `${required}-${this.f().params.length}`} arguments, but got ${e.args.length}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const to = this.cx.localOf(this.locals().get(this.f().params[i]!)!).type;
      this.exprs().expect(a, to);
      const t = this.exprs().value(a);
      this.exprs().coerce(a, t, to, `argument of type '${this.cx.tables.typing.show(t)}' is not assignable to parameter of type '${this.cx.tables.typing.show(to)}'`);
    });
    this.cx.tables.selfCalls.add(e);
    this.calls().set(e, this.instance().id);
    if (this.errorType) this.raise(e, this.errorType, `'${name}'`);
    return { type: this.cx.resolver().resolveType(this.f().returnType!), what: `'${name}'` };
  }

  // `let x: T` declares a variable that holds nothing until assigned; the moves check refuses
  // every use before that, as TypeScript's definite assignment does.
  /** @throws {CompileError} */
  unassigned(this: Mut<this>, s: Stmt, d: Declarator, name: string): undefined {
    if ((d.type === undefined)) throw new CompileError("E0406", `'${name}' needs a type to be declared without a value, like 'let ${name}: string'; Fish doesn't work it out from later assignments`, d.start, d.end);
    const resolved = this.cx.resolver().resolveType(d.type);
    const type = this.cx.tables.typing.stored(resolved);
    if (this.cx.tables.typing.lower(type) === "void") throw new CompileError("E0118", `'${name}' can't be of type 'void', which no value has`, d.start, d.end);
    if (this.cx.isInterface(type)) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since an interface describes a value of some concrete type`, d.start, d.end);
    const r = this.cx.recOf(type);
    if (r?.kind === "function" && r.generic !== undefined) throw new CompileError("E0406", `'${name}' needs its value where it is declared, since a generic function type describes the generic function it holds`, d.start, d.end);
    this.declare(name, type, true, false, s);
    return undefined;
  }

  // `[a, b] = [b, a]`, in JavaScript's order: the right side is evaluated whole, into fresh
  // variables, then each target is assigned its part in turn, a default taken at its own
  // target, after the targets before it. An array or object literal on the right is taken
  // part by part, each part typed as its target is, so a swap of values that move needs no
  // array and a literal meets its target's type.
  /** @throws {CompileError} */
  destructuring(this: Mut<this>, e: Ref<Extract<Expr, { kind: "destructure" }>>): Stmt[] {
    // Every part is read first, then every target written, so a target can't change what a
    // later part reads, as in '({ a: o.b, b: o.a } = o)'.
    let out: Destructured = { reads: [], writes: [] };
    this.destructureFrom(out, e.pattern, cloneExpr(e.value));
    return [...out.reads, ...out.writes];
  }
  private freshPart(this: Mut<this>): string {
    return `destructured ${this.cx.tables.counts.destructures++}`;
  }
  private partIdent(this: Mut<this>, name: string, at: Ref<Span>): Expr {
    return { id: nextId(this.cx.tables.ids), kind: "ident", name, start: at.start, end: at.end };
  }
  private partDeclared(this: Mut<this>, target: Pattern, init: Expr, at: Ref<Span>, typedAs: Expr | undefined): Stmt {
    const s: Stmt = { id: nextId(this.cx.tables.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.tables.ids), target, type: undefined, init, start: at.start, end: at.end }], start: at.start, end: at.end };
    if (typedAs !== undefined) this.cx.tables.destructuredParts.set(cloneStmt(s), typedAs);
    return s;
  }
  private partTarget(this: Mut<this>, p: Ref<Pattern>): Expr | undefined {
    if (p.kind === "ident") return this.partIdent(p.name, p);
    if (p.kind === "expr") return cloneExpr(p.expr);
    if (p.kind === "default") return this.partTarget(p.target);
    return undefined;
  }
  // Writes what `part` reads to a target, its default taken when the part is an empty Option.
  /** @throws {CompileError} */
  private destructureWrite(this: Mut<this>, out: Mut<Destructured>, p: Ref<Pattern>, part: Expr): void {
    if (p.kind === "default") {
      const or: Expr = { id: nextId(this.cx.tables.ids), kind: "binary", op: "??", left: part, right: cloneExpr(p.value), start: p.start, end: p.end };
      this.cx.tables.unusedDefaults.add(cloneExpr(or));
      this.destructureWrite(out, p.target, or);
      return;
    }
    if (p.kind === "ident" || p.kind === "expr") {
      const target = this.partTarget(p)!;
      out.writes.push({ id: nextId(this.cx.tables.ids), kind: "expr", expr: { id: nextId(this.cx.tables.ids), kind: "assign", op: "=", target, value: part, start: p.start, end: p.end }, start: p.start, end: p.end });
      return;
    }
    // A nested pattern takes apart what the part holds, from its fresh variable.
    this.destructureFrom(out, p, part);
  }
  // A place is read where it is, piece by piece, so only the pieces named move out of it,
  // as a declaration's destructuring does; anything else is held in a fresh variable first.
  // A chain reading a getter isn't one: its getter runs once, into a fresh variable.
  private partPlace(v: Ref<Expr>): boolean {
    return v.kind === "ident" || v.kind === "this" || (v.kind === "member" && !v.optional && !this.cx.tables.getterNames.has(v.name) && this.partPlace(v.object));
  }
  /** @throws {CompileError} */
  private destructureFrom(this: Mut<this>, out: Mut<Destructured>, p: Ref<Pattern>, value: Expr): void {
    if (p.kind !== "array" && p.kind !== "object") throw new CompileError("E0003", "this can't be a destructuring target; assign to a variable, a field or an element", p.start, p.end);
    // A literal is taken part by part, each part typed as its target.
    if (p.kind === "array" && value.kind === "array" && !value.elements.some((x) => x === undefined || x.kind === "spread")) {
      let parts: { nested: Expr | undefined; read: Expr | undefined }[] = [];
      for (let i: usize = 0; i < value.elements.length; i++) {
        const x: Ref<Expr> = value.elements[i]!;
        const q = i < p.elements.length ? p.elements[i] : undefined;
        const inner = q === undefined ? undefined : q.kind === "default" ? q.target : q;
        // A nested literal for a nested pattern is taken apart in turn.
        if (inner !== undefined && (inner.kind === "array" || inner.kind === "object") && (x.kind === "array" || x.kind === "object") && q!.kind !== "default") {
          parts.push({ nested: cloneExpr(x), read: undefined });
          continue;
        }
        const name = this.freshPart();
        const typedAs = q !== undefined ? this.partTarget(q) : undefined;
        out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "ident", name, start: x.start, end: x.end }, cloneExpr(x), x, typedAs));
        parts.push({ nested: undefined, read: this.partIdent(name, x) });
      }
      for (let i: usize = 0; i < p.elements.length; i++) {
        const q = p.elements[i];
        if (q === undefined) continue;
        const part = i < parts.length ? parts[i] : undefined;
        if (part !== undefined && part.nested !== undefined) this.destructureFrom(out, q, cloneExpr(part.nested));
        else if (part !== undefined && part.read !== undefined) this.destructureWrite(out, q, cloneExpr(part.read));
        else if (q.kind !== "default") throw new CompileError("E0003", `the array on the right has no element at index ${i} for this target`, q.start, q.end);
        else this.destructureWrite(out, q.target, cloneExpr(q.value));
      }
      if (p.rest !== undefined) {
        let rest: Expr[] = [];
        for (let i = p.elements.length; i < parts.length; i++) rest.push(cloneExpr(parts[i]!.read!));
        this.destructureWrite(out, p.rest!, { id: nextId(this.cx.tables.ids), kind: "array", elements: rest, start: value.start, end: value.end });
      }
      return;
    }
    if (p.kind === "object" && p.rest === undefined && value.kind === "object" && value.props.every((x) => x.kind === "property" && typeof x.key === "string") && p.props.every((x) => typeof x.key === "string")) {
      let parts = new Map<string, Expr>();
      for (const x of value.props) {
        if (x.kind !== "property") continue;
        const key = x.key as string;
        const name = this.freshPart();
        const q = p.props.find((y) => y.key === key);
        const typedAs = q !== undefined ? this.partTarget(q.value) : undefined;
        out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "ident", name, start: x.start, end: x.end }, cloneExpr(x.value), x, typedAs));
        parts.set(key, this.partIdent(name, x));
      }
      for (const prop of p.props) {
        const part = parts.get(prop.key as string);
        if (part !== undefined) this.destructureWrite(out, prop.value, cloneExpr(part));
        else if (prop.value.kind === "default") this.destructureWrite(out, prop.value.target, cloneExpr(prop.value.value));
        else throw new CompileError("E0003", `the object on the right has no property '${String(prop.key)}' for this target`, prop.start, prop.end);
      }
      return;
    }
    let whole = value;
    if (!this.partPlace(value)) {
      const name = this.freshPart();
      const at = { start: value.start, end: value.end };
      out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "ident", name, start: at.start, end: at.end }, value, at, undefined));
      whole = this.partIdent(name, at);
    }
    // Each top-level piece is read by a declaration naming only it, nested patterns down to
    // their leaves, so only the leaves move out of a place. A slot with a default reads
    // nothing past the end; the default itself is taken at the target.
    const span = { start: p.start, end: p.end };
    let leaves: [Pattern, string][] = [];
    if (p.kind === "array") {
      for (let i: usize = 0; i < p.elements.length; i++) {
        const q = p.elements[i];
        if (q === undefined) continue;
        let elements: (Pattern | undefined)[] = [];
        for (let j: usize = 0; j < i; j++) elements.push(undefined);
        elements.push(this.partShape(leaves, q));
        out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "array", elements, rest: undefined, ...span }, cloneExpr(whole), q, undefined));
      }
      if (p.rest !== undefined) {
        let elements: (Pattern | undefined)[] = [];
        for (let j: usize = 0; j < p.elements.length; j++) elements.push(undefined);
        const rest = this.partShape(leaves, p.rest!);
        out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "array", elements, rest, ...span }, cloneExpr(whole), p.rest!, undefined));
      }
    } else if (p.rest !== undefined) {
      // An object's rest is read with every property it leaves out, in one declaration.
      out.reads.push(this.partDeclared(this.partShape(leaves, p), cloneExpr(whole), p, undefined));
    } else {
      for (const prop of p.props) {
        const shaped = this.partShape(leaves, prop.value);
        out.reads.push(this.partDeclared({ id: nextId(this.cx.tables.ids), kind: "object", props: [{ ...clonePatternProp(prop), id: nextId(this.cx.tables.ids), value: shaped }], rest: undefined, ...span }, cloneExpr(whole), prop.value, undefined));
      }
    }
    for (const [q, name] of leaves) this.destructureWrite(out, q, this.partIdent(name, q));
  }
  /** @throws {CompileError} */
  private partShape(this: Mut<this>, leaves: Mut<[Pattern, string][]>, q: Ref<Pattern>): Pattern {
    const at = { start: q.start, end: q.end };
    if (q.kind === "default" && (q.target.kind === "ident" || q.target.kind === "expr")) {
      const name = this.freshPart();
      leaves.push([clonePattern(q), name]);
      return { id: nextId(this.cx.tables.ids), kind: "default", target: { id: nextId(this.cx.tables.ids), kind: "ident", name, ...at }, value: { id: nextId(this.cx.tables.ids), kind: "null", ...at }, ...at };
    }
    if (q.kind === "ident" || q.kind === "expr") {
      const name = this.freshPart();
      leaves.push([clonePattern(q), name]);
      return { id: nextId(this.cx.tables.ids), kind: "ident", name, ...at };
    }
    if (q.kind === "array") {
      let elements: (Pattern | undefined)[] = [];
      for (const x of q.elements) elements.push(x === undefined ? undefined : this.partShape(leaves, x));
      const rest = q.rest !== undefined ? this.partShape(leaves, q.rest!) : undefined;
      return { id: nextId(this.cx.tables.ids), kind: "array", elements, rest, start: q.start, end: q.end };
    }
    if (q.kind === "object") {
      let props: PatternProp[] = [];
      for (const x of q.props) {
        const value = this.partShape(leaves, x.value);
        props.push({ ...clonePatternProp(x), id: nextId(this.cx.tables.ids), value });
      }
      const rest = q.rest !== undefined ? this.partShape(leaves, q.rest!) : undefined;
      return { id: nextId(this.cx.tables.ids), kind: "object", props, rest, start: q.start, end: q.end };
    }
    throw new CompileError("E0003", "this can't be a destructuring target; assign to a variable, a field or an element", q.start, q.end);
  }

  // The type a destructured part's fresh variable takes: its target's, as declared.
  partType(this: Mut<this>, s: Ref<Stmt>): Type | undefined {
    const target = this.cx.tables.destructuredParts.get(s);
    if ((target === undefined)) return undefined;
    if (target.kind === "ident") { const found = this.lookup(target.name, undefined); return found === undefined ? undefined : this.cx.localOf(found).type; }
    // A field of 'this' has its declared type, which a constructor may not read yet.
    if (target.kind === "member" && target.object.kind === "this" && this.f().self !== undefined) return this.cx.tables.typing.allFields(this.f().self!.type as ClassType).find((x) => x.name === target.name)?.type;
    // A target with only a setter can't be read for its type; its part keeps its own.
    try {
      const read = renumberExpr(cloneExpr(target), () => nextId(this.cx.tables.ids));
      this.exprsState.asDeclared.add(read);
      const t = this.exprs().value(read);
      return this.cx.recOf(t)?.kind === "ref" ? undefined : t;
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // `let a = 1, b = a` is a declaration per name, in order, each seeing those before it. A
  // `for` head's go in a block around the loop, which scopes them as the head does.
  /** @throws {CompileError} */
  separate(this: Mut<this>, list: Stmt[]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const s = this.cx.tables.rewrites.currentStmt(list[i]!);
      if (s.kind === "expr" && s.expr.kind === "destructure") {
        list.splice(i as i64, 1, ...this.destructuring(s.expr));
        continue;
      }
      if (s.kind === "let" && s.declarations.length > 1) {
        list.splice(i, 1, ...s.declarations.map((d, n): Stmt => ({ ...s, id: nextId(this.cx.tables.ids), declarations: [d], start: n === 0 ? s.start : d.start, end: d.end })));
        continue;
      }
      let loop = s;
      while (loop.kind === "labeled") loop = this.cx.tables.rewrites.currentStmt(loop.body);
      if (loop.kind === "for" && loop.init?.kind === "let" && loop.init.declarations.length > 1) {
        list[i] = { id: nextId(this.cx.tables.ids), kind: "block", body: [loop.init, s], start: s.start, end: s.end };
        this.cx.tables.wrappedIn.set(s, cloneStmt(list[i]!));
        this.cx.tables.rewrites.replaceStmt(loop, { ...loop, init: undefined });
        continue;
      }
      // Inside the block it was moved into, the loop is already where it belongs.
      const wrapped = this.cx.tables.wrappedIn.get(list[i]!);
      if (wrapped !== undefined && wrapped.kind === "block" && list[i - 1]?.id !== wrapped.body[0]?.id) list[i] = cloneStmt(wrapped);
    }
  }

  // Checks a list of statements in order. What an `if` that leaves early proves holds for
  // the statements after it, and so does what an assignment sets. Gives the type each binding
  // the list writes has at its end.
  /** @throws {CompileError} */
  statements(this: Mut<this>, owner: usize, field: string, given: Ref<Stmt[]>, top = false): Facts {
    // A list is checked as a copy, edited where checking splits, moves or adds statements, and
    // recorded for the rebuild; a list checked again starts from its edited form.
    const bodyId = this.f().bodyId;
    const edited = this.cx.tables.rewrites.listIn(bodyId, owner, field);
    let list: Stmt[] = edited !== undefined ? edited.slice() : given.slice();
    this.separate(list);
    this.hoist(list);
    const before = this.facts.length;
    const writes = this.written.length;
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      const inserted = this.cx.tables.insertedAfter.get(s);
      if (inserted !== undefined && inserted.length > 0 && list[i + 1]?.id !== inserted[0]!.id) list.splice(i + 1, 0, ...inserted.map((x) => cloneStmt(x)));
      const outerWalking = this.walking;
      const outerAfter = this.after;
      this.walking = s.id;
      this.after = [];
      const mark = this.changed.length;
      if (this.ruledOut()) this.markUnreached(s);
      const after = top ? this.topStatement(s) : this.statement(s);
      const added = this.after;
      this.walking = outerWalking;
      this.after = outerAfter;
      if (added.length > 0) list.splice(i + 1, 0, ...added);
      if (after) this.facts.push(this.current(after, mark));
    }
    if (list.length !== given.length || list.some((x, i) => x.id !== given[i]!.id)) this.cx.tables.rewrites.replaceList(bodyId, owner, field, list);
    const ends: Facts = new Map();
    for (const { local } of this.written.slice(writes)) {
      // A field path written is forgotten wherever it was narrowed, so it is joined as declared;
      // no value has type `void`, so it marks one.
      if (isPath(local)) {
        ends.set(local, "void");
        continue;
      }
      const l = this.cx.localOf(Number(local) as LocalId);
      ends.set(local, this.narrowed(l.localId) ?? l.type);
    }
    this.facts.length = before;
    return ends;
  }

  // `const { a, b: c = 1, ...rest } = v` and `const [x, , y = 0] = v`: the value goes to a
  // variable named for the pattern, and each name becomes a declaration of its part after it,
  // in the list being checked, so the names own the parts as Rust's `let` does. A nested
  // pattern is a declaration of its own, destructured in turn. A default is taken when its
  // part is null.
  /** @throws {CompileError} */
  destructured(this: Mut<this>, s: Extract<Stmt, { kind: "let" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>): undefined {
    if (this.walking !== s.id) throw unsupported("destructuring patterns here", pattern);
    // A place is read part by part where it is, so only the parts named move out of it, as in
    // Rust; any other value goes to a variable named for the pattern, as messages show it.
    if (d.init === undefined) throw new CompileError("E0406", "a destructuring declaration needs its value where it is declared, as TypeScript requires", d.start, d.end);
    const init = d.init;
    const read = (e: Expr): boolean => e.kind === "ident" || e.kind === "this" || ((e.kind === "member" || e.kind === "index") && !e.optional && read(e.object));
    // A getter along the path runs each time the path is read, so its result is kept once.
    const computed = (e: Expr): boolean => (e.kind === "member" && this.calls().has(e)) || ((e.kind === "member" || e.kind === "index") && computed(e.object));
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
        const usize: TypeNode = { id: nextId(this.cx.tables.ids), kind: "ref", name: "usize", args: [], ...at };
        hoisted.unshift({ id: nextId(this.cx.tables.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.tables.ids), target: { id: nextId(this.cx.tables.ids), kind: "ident", name, ...at }, type: usize, init: e.index, ...at }], ...at });
      }
      const copy = (e: Expr, at: Span): Expr => {
        if (e.kind === "member") return { ...e, id: nextId(this.cx.tables.ids), object: copy(e.object, at), start: at.start, end: at.end };
        if (e.kind !== "index") return { ...e, id: nextId(this.cx.tables.ids), start: at.start, end: at.end };
        const name = indexes.get(e);
        const index: Expr = name ? { id: nextId(this.cx.tables.ids), kind: "ident", name, start: e.index.start, end: e.index.end } : { ...e.index, id: nextId(this.cx.tables.ids) };
        return { ...e, id: nextId(this.cx.tables.ids), object: copy(e.object, at), index, start: at.start, end: at.end };
      };
      from = (at) => copy(init, at);
      this.cx.tables.rewrites.replaceStmt(s, { id: 0, kind: "empty", start: s.start, end: s.end });
    } else {
      const held = patternText(pattern);
      this.cx.tables.rewrites.replaceDeclarator(d, { ...d, target: { id: nextId(this.cx.tables.ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
      this.statement(s);
      type = this.cx.localOf(this.locals().get(s)!).type;
      from = (at) => ({ id: nextId(this.cx.tables.ids), kind: "ident", name: held, start: at.start, end: at.end });
    }
    const destructuring: Type = type!;
    // A top-level const is read where it lives rather than lent.
    let root = init;
    while (root.kind === "member" || root.kind === "index") root = root.object;
    const global = inPlace && root.kind === "ident" && !this.locals().has(root);
    const borrowed = this.cx.isRef(destructuring) && !global;
    const lowered = this.cx.tables.typing.lower(this.cx.isRef(destructuring) ? this.cx.tables.typing.rec(destructuring).to : destructuring);
    const l = this.cx.recOf(lowered);
    // An object-typed or interface-typed parameter stands for any type with its fields, which its
    // bound names.
    const whole = l?.kind === "param" && l.bound && ["object", "interface"].includes(this.cx.tables.typing.rec(l.bound).kind) ? l.bound : lowered;
    const w = this.cx.recOf(whole);
    const parts: [Pattern, Expr, Type][] = [];
    // A part with a default: what the part holds, or the default when it is null.
    const part = (target: Pattern, read: Expr, t: Type) => {
      if (target.kind !== "default") return parts.push([target, read, t]);
      const u = this.cx.recOf(t);
      const empty = t === "null" || (u?.kind === "union" && u.members.includes("null"));
      parts.push([target.target, empty ? { id: nextId(this.cx.tables.ids), kind: "binary", op: "??", left: read, right: target.value, start: target.start, end: target.end } : read, t]);
    };
    if (pattern.kind === "object") {
      // A union of objects, as `as const` rows give, is read field by field, each field the union
      // of its members', as a member read of it is.
      const members = w?.kind === "union" ? w.members : [whole];
      if (!members.every((m) => this.cx.recOf(m)?.kind === "object" || this.cx.recOf(m)?.kind === "class" || (m === whole && this.cx.recOf(m)?.kind === "interface"))) {
        throw new CompileError("E0003", `'{ ... }' destructures an object or an instance, not '${this.cx.tables.typing.show(destructuring)}'`, pattern.start, pattern.end);
      }
      const taken = new Set<string>();
      for (const p of pattern.props) {
        const key = typeof p.key === "string" ? p.key : this.exprs().knownKey(p.key);
        const found = members.map((m) => this.cx.tables.typing.field(m as ClassType | ObjectType, key));
        const method = w?.kind === "interface" && w.methods.some((m) => m.name === key);
        if (method) throw new CompileError("E0003", `'{ ... }' can't take method '${key}' out of '${this.cx.tables.typing.show(whole)}'; call it on the value, as in 'x.${key}()'`, p.start, p.end);
        if (found.some((f) => !f)) throw new CompileError("E0502", `property '${key}' does not exist on type '${this.cx.tables.typing.show(whole)}'`, p.start, p.end);
        taken.add(key);
        part(p.value, { id: nextId(this.cx.tables.ids), kind: "member", object: from(p), name: key, optional: false, start: p.start, end: p.end }, this.cx.tables.typing.unionType(found.map((f) => f!.type)));
      }
      if (pattern.rest && w?.kind === "union") throw unsupported("rest patterns over a union of objects", pattern.rest);
      if (pattern.rest && w?.kind === "interface") throw unsupported("rest patterns over an interface's fields", pattern.rest);
      // The rest is an object of the fields the pattern didn't name, taken over.
      if (pattern.rest && (w?.kind === "object" || w?.kind === "class")) {
        const fields = w.kind === "class" ? this.cx.tables.typing.allFields(whole as ClassType) : w.fields;
        const props = fields.filter((f) => !taken.has(f.name) && (f.access ?? "public") === "public").map((f): ObjectProp => ({ id: nextId(this.cx.tables.ids), kind: "property", key: f.name, value: { id: nextId(this.cx.tables.ids), kind: "member", object: from(pattern.rest!), name: f.name, optional: false, start: pattern.rest!.start, end: pattern.rest!.end }, start: pattern.rest!.start, end: pattern.rest!.end }));
        parts.push([pattern.rest, { id: nextId(this.cx.tables.ids), kind: "object", props, start: pattern.rest.start, end: pattern.rest.end }, whole]);
      }
    } else if (this.cx.tables.typing.isTuple(whole)) {
      const elements = this.cx.tables.typing.elementsOf(whole as ObjectType);
      const many = this.cx.tables.typing.rec(whole as ObjectType).rest;
      if (pattern.elements.length > elements.length && many === undefined) throw new CompileError("E0117", `tuple type '${this.cx.tables.typing.show(whole)}' of length ${elements.length} has no element at index ${elements.length}`, pattern.start, pattern.end);
      // A rest tuple's `...rest` takes its array where its fixed elements end, or a copy of the
      // part after the names taken from it, as an array pattern's rest is, when they copy.
      const later = pattern.elements.length - elements.length;
      if (pattern.rest && (many === undefined || later < 0 || (later > 0 && !this.cx.tables.typing.isCopy(many)))) throw unsupported(many === undefined ? "rest elements in tuple patterns" : later < 0 ? "rest patterns that don't start where a tuple's rest elements do" : "rest patterns after names taken from rest elements whose type doesn't copy", pattern.rest);
      pattern.elements.forEach((p, i) => {
        if (!p) return;
        const at = { start: p.start, end: p.end };
        // With a default, an element past the fixed ones may be missing, so it is read as
        // `.at(i)` on the rest, which an array pattern's default reads too.
        if (i >= elements.length && p.kind === "default") {
          // Read with `.at(i)`, a value that doesn't copy would be copied where `t[i]` moves it.
          if (!this.cx.tables.typing.isCopy(many!)) throw new CompileError("E0117", `a default past a tuple's fixed elements would take a '${this.cx.tables.typing.show(many!)}' out of the tuple's rest when it is there, leaving a hole; destructure without the default, or index it and clone`, p.start, p.end);
          const array: Expr = { id: nextId(this.cx.tables.ids), kind: "member", object: from(p), name: "...", optional: false, ...at };
          this.cx.tables.restStarts.set(array, elements.length);
          const read: Expr = { id: nextId(this.cx.tables.ids), kind: "call", callee: { id: nextId(this.cx.tables.ids), kind: "member", object: array, name: "at", optional: false, ...at }, args: [{ id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(i - elements.length), ...at }], typeArgs: [], optional: false, ...at };
          return part(p, read, this.cx.tables.typing.unionType([many!, "null"]));
        }
        part(p, { id: nextId(this.cx.tables.ids), kind: "index", object: from(p), index: { id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(i), ...at }, optional: false, ...at }, elements[i] ?? many!);
      });
      if (pattern.rest) {
        const at = { start: pattern.rest.start, end: pattern.rest.end };
        const array: Expr = { id: nextId(this.cx.tables.ids), kind: "member", object: from(pattern.rest), name: "...", optional: false, ...at };
        this.cx.tables.restStarts.set(array, elements.length);
        const taken: Expr = later === 0 ? array : { id: nextId(this.cx.tables.ids), kind: "call", callee: { id: nextId(this.cx.tables.ids), kind: "member", object: array, name: "slice", optional: false, ...at }, args: [{ id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(later), ...at }], typeArgs: [], optional: false, ...at };
        part(pattern.rest, taken, this.cx.tables.typing.arrayType(many!));
      }
    } else if (w?.kind === "array") {
      // An array's elements are read as `xs[i]`, which a value that moves would leave a hole in.
      if (!this.cx.tables.typing.isCopy(w.element)) throw new CompileError("E0202", `an array pattern reads each element as 'xs[i]', and a '${this.cx.tables.typing.show(w.element)}' would be moved out of the array, leaving a hole; index it and clone, or loop over it`, pattern.start, pattern.end);
      pattern.elements.forEach((p, i) => {
        if (!p) return;
        const at = { start: p.start, end: p.end };
        const index: Expr = { id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(i), ...at };
        // With a default, a missing element is the default rather than a panic.
        const read: Expr = p.kind === "default"
          ? { id: nextId(this.cx.tables.ids), kind: "binary", op: "??", left: { id: nextId(this.cx.tables.ids), kind: "call", callee: { id: nextId(this.cx.tables.ids), kind: "member", object: from(p), name: "at", optional: false, ...at }, args: [index], typeArgs: [], optional: false, ...at }, right: p.value, ...at }
          : { id: nextId(this.cx.tables.ids), kind: "index", object: from(p), index, optional: false, ...at };
        parts.push([p.kind === "default" ? p.target : p, read, w.element]);
      });
      if (pattern.rest) {
        const at = { start: pattern.rest.start, end: pattern.rest.end };
        const slice: Expr = { id: nextId(this.cx.tables.ids), kind: "call", callee: { id: nextId(this.cx.tables.ids), kind: "member", object: from(pattern.rest), name: "slice", optional: false, ...at }, args: [{ id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(pattern.elements.length), ...at }], typeArgs: [], optional: false, ...at };
        parts.push([pattern.rest, slice, whole]);
      }
    } else throw new CompileError("E0003", `'[ ... ]' destructures a tuple, like '[i64, string]', or an array, not '${this.cx.tables.typing.show(destructuring)}'`, pattern.start, pattern.end);
    const lets: Stmt[] = parts.map(([target, init]): Stmt => {
      const at = { start: target.start, end: target.end };
      const declarator: Declarator = { id: nextId(this.cx.tables.ids), target, type: undefined, init, ...at };
      // A part of a borrowed value is borrowed too, as a loop's pattern's parts are; an array's
      // parts copy.
      if (borrowed && target.kind === "ident" && (init.kind === "member" || (init.kind === "index" && this.cx.tables.typing.isTuple(whole)))) this.cx.tables.loopParts.add(declarator);
      return { id: nextId(this.cx.tables.ids), kind: "let", keyword: s.keyword, declarations: [declarator], ...at };
    });
    // A parameter's parts come before a derived constructor's `super(...)`, as its whole did.
    if (this.cx.tables.prologues.has(s)) for (const l of [...hoisted, ...lets]) this.cx.tables.prologues.add(l);
    this.after.push(...hoisted, ...lets);
    this.cx.tables.insertedAfter.set(s, [...hoisted, ...lets].map((x) => cloneStmt(x)));
    return undefined;
  }

  // `for (const [k, v] of pairs)` and `for (const { x, y } of points)`: the element goes to a
  // variable named for the pattern, and each name becomes a `const` of its part at the top of
  // the body. A part of a borrowed element is borrowed, or copied when it copies.
  // `for (const x of t)` over a tuple reads each position in turn, as a counted loop over its
  // length choosing `t[0]`, `t[1]` and so on: each element is a copy when they all copy, typed
  // as their union, or lent when they share one type that doesn't. A union of references to
  // different types can't be held, so those are refused.
  /** @throws {CompileError} */
  private tupleLoop(this: Mut<this>, s: Extract<Stmt, { kind: "forIn" | "forOf" }>, tuple: ObjectType): Stmt {
    const typing = this.cx.tables.typing;
    const ids = this.cx.tables.ids;
    const { rest } = typing.rec(tuple);
    const fixed = typing.elementsOf(tuple);
    let parts: Type[] = [...fixed];
    if (rest !== undefined) parts.push(rest);
    if (parts.length === 0) throw new CompileError("E0119", "this tuple is empty, so a 'for...of' over it would never run its body", s.right.start, s.right.end);
    const element = parts.every((p) => typing.isCopy(p)) ? typing.unionType(parts) : parts.every((p) => p === parts[0]) ? typing.refType(parts[0]!, false) : undefined;
    if (element === undefined) throw unsupported("'for...of' loops over a tuple whose elements differ in type and don't all copy", s.right);
    const at = { start: s.right.start, end: s.right.end };
    // Each element reads the tuple again, so it has to be a place, not a value made for the loop.
    const place = (x: Expr): Expr | undefined => {
      x = this.cx.tables.rewrites.current(x);
      if (x.kind === "ident" || x.kind === "this") return { ...x, id: nextId(ids) };
      if (x.kind !== "member" || x.optional || this.calls().has(x)) return undefined;
      const object = place(x.object);
      return object && { ...x, id: nextId(ids), object };
    };
    // JavaScript's loop keeps the tuple it started with, and this one reads the variable on each
    // pass, so a body giving the variable a new tuple is refused rather than read differently.
    const root = this.cx.tables.rewrites.current(s.right);
    if (root.kind === "ident" && assignsOwn(s.body, root.name)) throw new CompileError("E0203", `cannot give '${root.name}' a new tuple inside a 'for...of' over it, which reads it on each pass; change its elements, or loop over a copy, as in 'const each = ${root.name};'`, at.start, at.end);
    const from = (): Expr => place(s.right) ?? (() => { throw new CompileError("E0212", "a 'for...of' over a tuple reads it once per element, so it needs a name; give the value one first, as in 'const t = ...;'", at.start, at.end); })();
    const preset = (t: Type): TypeNode => {
      const made: TypeNode = { id: nextId(ids), kind: "ref", name: typing.show(t), args: [], ...at };
      this.cx.tables.presetTypes.set(made, t);
      return made;
    };
    const counter = (): Expr => ({ id: nextId(ids), kind: "ident", name: "tuple position", ...at });
    const int = (n: usize): Expr => ({ id: nextId(ids), kind: "int", value: BigInt(n), ...at });
    const member = (name: string): Expr => ({ id: nextId(ids), kind: "member", object: from(), name, optional: false, ...at });
    let chosen: Expr = rest === undefined ? member(String(fixed.length - 1)) : { id: nextId(ids), kind: "index", object: member("..."), index: { id: nextId(ids), kind: "binary", op: "-", left: counter(), right: int(fixed.length), ...at }, optional: false, ...at };
    for (let i = rest === undefined ? fixed.length - 2 : fixed.length - 1; i >= 0; i--) {
      chosen = { id: nextId(ids), kind: "conditional", cond: { id: nextId(ids), kind: "binary", op: "===", left: counter(), right: int(i), ...at }, then: member(String(i)), else: chosen, ...at };
    }
    const left = s.left as Extract<Stmt, { kind: "let" }>;
    const d = left.declarations[0]!;
    const each: Stmt = { id: nextId(ids), kind: "let", keyword: left.keyword, declarations: [{ ...d, id: nextId(ids), type: preset(element), init: chosen }], start: left.start, end: left.end };
    const init: Stmt = { id: nextId(ids), kind: "let", keyword: "let", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name: "tuple position", ...at }, type: preset("usize"), init: int(0), ...at }], ...at };
    const test: Expr = { id: nextId(ids), kind: "binary", op: "<", left: counter(), right: member("length"), ...at };
    const update: Expr = { id: nextId(ids), kind: "update", op: "++", prefix: false, operand: counter(), ...at };
    const body: Stmt = { id: nextId(ids), kind: "block", body: s.body, start: s.body[0]?.start ?? s.end, end: s.end };
    return this.cx.tables.rewrites.replaceStmt(s, { id: 0, kind: "for", init, test, update, body: [each, body], start: s.start, end: s.end });
  }

  /** @throws {CompileError} */
  loopPattern(this: Mut<this>, s: Extract<Stmt, { kind: "forIn" | "forOf" }>, d: Declarator, pattern: Extract<Pattern, { kind: "array" | "object" }>) {
    if (pattern.rest !== undefined) throw unsupported("rest patterns", pattern.rest!);
    const named = (p: Pattern | undefined): Extract<Pattern, { kind: "ident" }> | undefined => {
      if (p !== undefined && p.kind !== "ident") throw unsupported(p.kind === "default" ? "defaults in destructuring patterns" : "nested destructuring patterns", p);
      return p;
    };
    const parts: [Extract<Pattern, { kind: "ident" }>, (from: Expr) => Expr][] = pattern.kind === "array"
      ? pattern.elements.flatMap((p, i) => {
        const n = named(p);
        return n ? [[n, (from: Expr): Expr => ({ id: nextId(this.cx.tables.ids), kind: "index", object: from, index: { id: nextId(this.cx.tables.ids), kind: "int", value: BigInt(i), start: n.start, end: n.end }, optional: false, start: n.start, end: n.end })]] : [];
      })
      : pattern.props.map((p) => {
        const key = typeof p.key === "string" ? p.key : this.exprs().knownKey(p.key);
        return [named(p.value)!, (from: Expr): Expr => ({ id: nextId(this.cx.tables.ids), kind: "member", object: from, name: key, optional: false, start: p.start, end: p.end })];
      });
    const held = pattern.kind === "array" ? `[${pattern.elements.map((p) => (p?.kind === "ident" ? p.name : "")).join(", ")}]` : `{ ${parts.map(([n]) => n.name).join(", ")} }`;
    const lets: Stmt[] = parts.map(([n, part]) => {
      const at = { start: n.start, end: n.end };
      const declarator: Declarator = { id: nextId(this.cx.tables.ids), target: n, type: undefined, init: part({ id: nextId(this.cx.tables.ids), kind: "ident", name: held, ...at }), ...at };
      this.cx.tables.loopParts.add(declarator);
      return { id: nextId(this.cx.tables.ids), kind: "let", keyword: (s.left as Extract<Stmt, { kind: "let" }>).keyword, declarations: [declarator], ...at };
    });
    const left = s.left as Extract<Stmt, { kind: "let" }>;
    const target: Declarator = this.cx.tables.rewrites.replaceDeclarator(d, { ...d, target: { id: nextId(this.cx.tables.ids), kind: "ident", name: held, start: pattern.start, end: pattern.end } });
    // The loop's own body is a block inside the parts' scope, so it may declare their names.
    const body: Stmt = { id: nextId(this.cx.tables.ids), kind: "block", body: s.body, start: s.body[0]?.start ?? s.end, end: s.end };
    return this.cx.tables.rewrites.replaceStmt(s, { ...s, left: this.cx.tables.rewrites.replaceStmt(left, { ...left, declarations: [target] }) as typeof left, body: [...lets, body] });
  }

  // A name a loop's pattern binds: its part of the element, borrowed when the element is.
  /** @throws {CompileError} */
  loopPart(this: Mut<this>, s: Extract<Stmt, { kind: "let" }>, d: Declarator): undefined {
    const init = d.init!;
    const object = init.kind === "index" || init.kind === "member" ? init.object : init;
    const whole = this.exprs().value(object);
    const element = this.cx.isRef(whole) ? this.cx.tables.typing.rec(whole).to : whole;
    if (init.kind === "index" && !this.cx.tables.typing.isTuple(element)) throw new CompileError("E0801", `only tuples, like '[i64, string]', can be destructured so far, not '${this.cx.tables.typing.show(element)}'`, d.start, d.end);
    const type = this.exprs().value(init);
    const name = (d.target as Extract<Pattern, { kind: "ident" }>).name;
    // A `let` part may change, or be pointed elsewhere when it is borrowed, as a `let` loop
    // variable may.
    if (this.cx.isRef(whole) && !this.cx.tables.typing.isCopy(type)) {
      const lent = this.cx.tables.typing.refType(type, false);
      this.exprs().coerce(init, type, lent, "");
      this.declare(name, lent, s.keyword === "let", false, s);
    } else this.declare(name, type, s.keyword === "let", false, s);
    return undefined;
  }

  // A whole value written through a narrowed `Mut` may be another member, so from here to the
  // end of each narrowing scope it is read as declared. A loop inside such a scope could come
  // back to reads already checked as narrowed.
  /** @throws {CompileError} */
  rewritten(this: Mut<this>, lId: LocalId, at: Ref<Expr>): void {
    const l = this.cx.localOf(lId);
    const outside = this.outsideOf(l.localId);
    if ((outside !== undefined) && outside !== "this" && this.outer !== undefined && this.outer.narrowed(outside) !== undefined) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a closure while a check outside it narrows it; assign its fields instead`, at.start, at.end);
    }
    const from = this.facts.findIndex((f) => f.has(bindingKey(l.localId)));
    if (from < 0) return;
    // Inside a larger expression, a condition could still prove the member it had.
    if (at !== this.whole) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a larger expression while a check narrows it; assign it as a statement of its own`, at.start, at.end);
    }
    this.changed.push(l.localId);
    if (this.targets.some((t) => t.kind === "loop" && (t.facts! as i64) > from)) {
      throw new CompileError("E0109", `can't give '${l.name}' another member inside a loop here: a check outside the loop narrowed it; assign its fields instead, or check it inside the loop`, at.start, at.end);
    }
    for (let i = from; i < this.facts.length; i++) this.facts[i] = new Map(this.facts[i]).set(bindingKey(l.localId), l.type);
  }

  // What holds after branches for the bindings they write: each one's types at the ends of the
  // branches that reach their end, joined. A binding a branch leaves alone has there what the
  // branch's condition proved, or what held before.
  joined(after: Facts | undefined, entry: Facts[], branches: [boolean, Facts, Facts][]): Facts | undefined {
    const wrote = new Set(branches.flatMap(([, ends]) => [...ends.keys()]));
    if (wrote.size === 0) return after;
    let out: Facts = new Map();
    if (after !== undefined) for (const [l, t] of after) if (![...wrote].some((w) => covers(w, l))) out.set(l, t);
    for (const id of wrote) {
      if (isPath(id)) continue;
      const l = this.cx.localOf(keyId(id));
      const types = branches.filter(([leaves]) => !leaves).map(([, ends, proved]) => ends.get(id) ?? proved.get(id) ?? entry.findLast((f) => f.has(id))?.get(id) ?? l.type);
      if (types.length === 0) continue;
      const t = this.cx.tables.typing.unionType(types);
      if (t !== l.type) out.set(id, t);
    }
    return out;
  }

  // A variable given a whole value holds one of its declared members the value can be.
  settles(this: Mut<this>, e: Extract<Expr, { kind: "assign" }>): Facts | undefined {
    const target = this.cx.tables.rewrites.current(e.target);
    const id = target.kind === "ident" ? this.locals().get(target) : undefined;
    const l = id === undefined ? undefined : this.cx.localOf(id);
    const given = this.types().get(e.value);
    const declared = l !== undefined ? this.cx.recOf(l.type) : undefined;
    if (l === undefined || given === undefined || declared?.kind !== "union" || this.cx.tables.typing.holdsRef(l.type) || !this.narrowable(l)) return undefined;
    const r = this.cx.recOf(given);
    const parts = r?.kind === "union" ? r.members : [given];
    const kept = declared.members.filter((m) => parts.some((p) => this.cx.tables.typing.fits(p, m)));
    if (parts.some((p) => !kept.some((m) => this.cx.tables.typing.fits(p, m)))) return undefined;
    const t = this.cx.tables.typing.unionType(kept);
    return t === l.type ? undefined : new Map([[bindingKey(l.localId), t]]);
  }

  // Facts proven before a statement that carry past it, less any it gave another member.
  current(proven: Facts, mark: usize): Facts {
    const gone = this.changed.slice(mark as i64);
    return gone.length === 0 ? proven : new Map([...proven].filter(([l]) => isPath(l) || !gone.includes(keyId(l))));
  }

  assumeFacts(this: Mut<this>, proven: Facts): void {
    this.facts.push(proven);
  }

  forgetFacts(this: Mut<this>): void {
    this.facts.pop();
  }

  /** @throws {CompileError} */
  assume<T>(this: Mut<this>, proven: Facts, check: InScope<T>): T {
    this.assumeFacts(proven);
    try {
      return check();
    } finally {
      this.forgetFacts();
    }
  }

  // An arrow function: its own type, and its body checked here, where it is written.
  /** @throws {CompileError} */
  closure(this: Mut<this>, e: Ref<Arrow>, expected: FunctionType | undefined, unsafeGiven: boolean | undefined, owningGiven: boolean | undefined): ClosureType {
    const unsafe = unsafeGiven === true;
    // An async arrow's future usually outlives the call making it, so it owns its captures.
    const owning = owningGiven === true || e.async;
    const value = Array.isArray(e.body) ? undefined : e.body;
    const body = this.cx.tables.arenas.addBody({
      id: nextId(this.cx.tables.ids), name: this.f().name, params: e.params, returnType: e.returnType, ...(e.throws !== undefined ? { throws: e.throws } : {}), start: e.start, end: e.end, async: e.async || undefined, closure: { value, parent: this.instance().id, expected, move: e.move || owning, unsafe, self: this.cx.tables.nestedFunctions.get(e), made: this.cx.tables.madeArrows.has(e) || undefined },
      body: value ? [{ id: nextId(this.cx.tables.ids), kind: "return", value, start: value.start, end: value.end }] : (e.body as Stmt[]),
    });
    const inner = this.cx.tables.arenas.addInstance({
      body: body.bodyId, symbol: `${this.instance().symbol}.closure${this.cx.closures.filter((c) => bodyOf(this.cx.tables.arenas, this.cx.tables.arenas.instanceOf(c)).closure!.parent === this.instance().id).length}`,
      bindings: this.instance().bindings, concrete: this.instance().concrete, depth: this.instance().depth, returns: "void",
      types: new NodeMap(), locals: new NodeMap(), calls: new NodeMap(), setters: new NodeMap(), coercions: new NodeMap(), jumps: new NodeMap(), borrowsFrom: new NodeMap(), raises: new NodeMap(), caught: new NodeMap(), consumes: new Set<usize>(), patterns: new NodeMap(), copiesOut: new NodeSet(),
    });
    inner.captures = new Map();
    inner.captureUses = new Map();
    inner.changed = new Set();
    inner.moved = new Set();
    this.cx.closures.push(inner.id);
    const outerSight = this.cx.resolver().enterSight(this.sight);
    try {
      this.cx.checkInstance(inner.id, this);
    } finally {
      this.cx.resolverState.sight = outerSight;
    }
    const sup = [...inner.types.keys()].find((u) => u.kind === "super");
    if (sup) throw unsupported("'super' in closures", sup);
    const captured = [...inner.captures].map(([alias, from]): [Local, Local | "this"] => [this.cx.localOf(alias), from === "this" ? from : this.cx.localOf(from)]);
    const moved = [...inner.moved].map((id) => this.cx.localOf(id));
    // A closure owning what it captures holds a nested function it uses as made here, so it
    // borrows what that function uses, as this body has it.
    if (e.async || bodyOf(this.cx.tables.arenas, inner).closure!.move) {
      for (const [, from] of captured) {
        if (from === "this" || !this.nestedLocal(from.localId)) continue;
        const of = this.cx.closureBodies.get(this.cx.tables.typing.lower(from.type) as ClosureType)!;
        const nested = this.cx.tables.arenas.instanceOf(of);
        const env = [...nested.captures!].map(([alias, x]) => {
          const mine = this.reach(x as LocalId, e);
          if (nested.changed?.has(alias)) this.exprs().changesLocal(mine, "", "change", e, false);
          return mine;
        });
        let held = this.instance();
        if (held.made === undefined) held.made = new NodeMap();
        held.made!.set(e, [...(held.made!.get(e) ?? []), { of, env }]);
      }
    }
    // A nested function runs whenever it is called, so it can't take over what it uses.
    const nested = this.cx.tables.nestedFunctions.get(e);
    if (nested !== undefined) {
      const self = captured.find(([, from]) => from === "this");
      if (self) throw new CompileError("E0708", `'this' inside the nested function '${nested}' isn't the enclosing method's; pass what it needs as a parameter`, (inner.captureUses.get(self[0].localId) ?? e).start, (inner.captureUses.get(self[0].localId) ?? e).end);
      // An async one takes its own copy of what it uses when it is made, which a later change
      // to a `let` wouldn't reach, as it would in JavaScript.
      const changing = e.async ? captured.find(([, from]) => from !== "this" && from.mutable && !from.param) : undefined;
      if (changing) throw new CompileError("E0210", `the async nested function '${nested}' takes its own copy of '${changing[0].name}' when it is made, so a later change to it wouldn't reach the function; pass '${changing[0].name}' as a parameter, or make it a 'const'`, (inner.captureUses.get(changing[0].localId) ?? e).start, (inner.captureUses.get(changing[0].localId) ?? e).end);
      if (e.async) for (const [alias, from] of captured) if (from !== "this" && from.param && from.mutable) this.copiedParams.push({ local: from, nested, at: inner.captureUses.get(alias.localId) ?? e });
      const first = moved[0];
      if (first) throw new CompileError("E0202", `the nested function '${nested}' moves '${first.name}' out of the variables it uses, which a second call couldn't do again; take it as a parameter instead`, (inner.captureUses.get(first.localId) ?? e).start, (inner.captureUses.get(first.localId) ?? e).end);
    }
    // A shared value's `update` callback lends its parameter only through its fields.
    if (this.f().closure?.expected && this.cx.tables.typing.sharedCallbacks.has(this.f().closure!.expected!)) {
      for (const [alias, from] of captured) {
        const ref = from === "this" ? undefined : this.cx.recOf(from.type);
        const held = from === "this" ? undefined : ref?.kind === "ref" ? ref.to : from.type;
        if (from !== "this" && from.param && held !== undefined && this.cx.tables.typing.interiorMutable(held)) {
          const at = inner.captureUses.get(alias.localId) ?? e;
          const message = this.cx.tables.typing.rcCallbacks.has(this.f().closure!.expected!)
            ? `a closure inside an Rc's 'update' can't capture '${alias.name}': its interior-mutable parts are borrowed where they live, outside 'update'`
            : `a closure inside a shared value's 'update' can't capture '${alias.name}': other tasks borrow its interior-mutable parts without the lock`;
          throw new CompileError("E0304", message, at.start, at.end);
        }
      }
    }
    // A closure holds what it moves, or everything under `move`, and borrows the rest; `this`
    // is a reference either way.
    // In an instance, what a type parameter stands for is laid out.
    const laid = (t: Type) => (inner.concrete ? this.cx.tables.typing.lower(t) : t);
    const fields = captured.map(([alias, from]) => ({
      name: alias.name,
      type: laid(from === "this" ? this.cx.tables.typing.refType(this.self!.type, inner.changed!.has(alias.localId)) : e.move || owning || inner.moved!.has(alias.localId) ? from.type : this.cx.tables.typing.refType(from.type, inner.changed!.has(alias.localId))),
    }));
    // Calling an async arrow gives its future, whose frame holds a copy of what it captured.
    // An async arrow's call only makes its future, which carries what it throws.
    const throws = inner.future ? undefined : inner.throws && laid(inner.throws);
    const type = madeBy(this.cx.tables.typing, this.cx.tables.typing.closureType(e.params.map((p) => writtenName(this.cx.tables, p)), e.params.map((p) => inner.branded?.params.get(inner.locals.get(p)!) ?? this.cx.localOf(inner.locals.get(p)!).type), inner.future ?? inner.branded?.returns ?? inner.returns, fields, moved[0]?.name, inner.concrete, throws), inner.symbol);
    // One throwing what the function type it is given as doesn't take can't be given as it.
    const given = expected && this.cx.tables.typing.rec(expected);
    if (expected && given && throws && e.throws && !this.cx.tables.typing.openThrows.has(expected) && !(given.throws && this.cx.tables.typing.fits(throws, given.throws))) {
      const takes = given.throws ? `which throws '${this.cx.tables.typing.show(given.throws)}'` : "which throws nothing";
      throw new CompileError("E0602", `this closure throws '${this.cx.tables.typing.show(throws)}', but it is given as '${this.cx.tables.typing.show(expected)}', ${takes}; catch it inside the closure with try/catch`, e.throws.start, e.throws.end);
    }
    // An async one's future throws, which a function type giving a Promise can't say yet.
    const failing = inner.future && this.cx.tables.typing.rec(inner.future).throws;
    if (expected && given && failing && !this.cx.tables.typing.openThrows.has(expected) && this.cx.tables.typing.promiseElement(given.returns) !== undefined) {
      const at = e.throws ?? [...inner.raises.keys()][0] ?? e;
      throw new CompileError("E0602", `this async closure throws '${this.cx.tables.typing.show(failing)}', but it is given as '${this.cx.tables.typing.show(expected)}', whose Promise throws nothing; catch it inside the closure with try/catch`, at.start, at.end);
    }
    // Each call's future works on its own copy of the captures, so a change would be lost.
    const changed = e.async && inner.changed.size > 0 ? this.cx.localOf([...inner.changed][0]!) : undefined;
    if (changed) {
      const at = inner.captureUses.get(changed.localId) ?? e;
      if (this.cx.tables.timerWrappers.has(e)) throw new CompileError("E0210", `a timer's function owns what it captures, so changing '${changed.name}' would change only its own copy; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
      throw new CompileError("E0210", `this async arrow changes '${changed.name}', which it captured, but each call's future works on its own copy, so the change would be lost; keep that state in an 'Atomic' or a 'Lock'`, at.start, at.end);
    }
    // Its future holds the captures as it holds parameters, for what crosses threads.
    if (inner.future) {
      this.cx.tables.typing.rec(inner.future).frame[1] = { name: "env", type };
      this.cx.tables.typing.rec(inner.future).params = [{ name: "env", type }, ...this.cx.tables.typing.rec(inner.future).params];
    }
    inner.closure = type;
    this.calls().set(e, inner.id);
    this.cx.closureBodies.set(type, inner.id);
    return type;
  }

  // A parameter's type is written, or else the one the function type the closure meets gives.
  /** @throws {CompileError} */
  closureParam(this: Mut<this>, p: Param, i: usize, expected: FunctionType | undefined): Type {
    const takes = expected !== undefined ? this.cx.tables.typing.rec(expected).params : undefined;
    const given = takes !== undefined && i < takes.length ? takes[i] : undefined;
    if (expected && takes && !given && !p.type) {
      const n = takes.length;
      throw new CompileError("E0506", `'${this.cx.tables.typing.show(expected)}' passes ${n} argument${n === 1 ? "" : "s"}, so this closure can't take '${paramName(p)}'`, p.start, p.end);
    }
    if (p.comptime) throw unsupported("comptime parameters on closures", p);
    if (p.rest) throw unsupported("rest parameters on arrow functions", p);
    const plain = !p.rest && !p.optional && !p.default && p.modifiers.length === 0 && p.decorators.length === 0 && paramName(p) !== "this";
    // A declared function's parameter, named as a value, is typed where the function is declared.
    // A closure is one compiled function, so a function it takes is a stored callable.
    const written = this.cx.tables.presetParams.get(p) ?? (!p.type && given && plain ? given : this.cx.resolver().paramType(p));
    const w = this.cx.recOf(written);
    const type = w?.kind === "function" && !w.generic ? this.cx.tables.typing.stored(written) : written;
    const to = this.cx.isRef(type) ? this.cx.tables.typing.rec(type).to : type;
    if (this.cx.recOf(to)?.kind === "interface") throw unsupported("closure parameters of interface types", p);
    return type;
  }

  /** @throws {CompileError} */
  statement(this: Mut<this>, written: Stmt): Facts | undefined {
    const s = this.cx.tables.rewrites.currentStmt(written);
    if (s.kind !== "while" && s.kind !== "doWhile" && s.kind !== "for" && s.kind !== "forOf") return this.statementOf(s);
    // A loop's condition and update are inside it, run again each time round.
    this.forgetLoop(s);
    this.loops.push({ facts: this.facts.length, reads: this.narrowReads.length });
    try {
      return this.statementOf(s);
    } finally {
      this.loops.pop();
    }
  }

  /** @throws {CompileError} */
  statementOf(this: Mut<this>, s: Stmt): Facts | undefined {
    const declaration = unsupportedDeclaration(s);
    if ((declaration !== undefined)) throw declaration;
    switch (s.kind) {
      case "expr":
        this.whole = s.expr;
        // `yield* g` gives each value `g` gives, as `for (const % of g) yield %;` does.
        if (s.expr.kind === "yield" && s.expr.delegate && this.generatorType !== undefined && s.expr.value !== undefined) {
          const { value, start, end } = s.expr;
          const topic = { id: nextId(this.cx.tables.ids), kind: "ident" as const, name: "%", start, end };
          const each: Stmt = { id: nextId(this.cx.tables.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.tables.ids), target: topic, type: undefined, init: undefined, start, end }], start, end };
          const body: Stmt[] = [{ id: nextId(this.cx.tables.ids), kind: "expr", expr: { id: nextId(this.cx.tables.ids), kind: "yield", value: { ...topic, id: nextId(this.cx.tables.ids) }, delegate: false, start, end }, start, end }];
          return this.statement(this.cx.tables.rewrites.replaceStmt(s, { id: 0, kind: "forOf", await: false, left: each, right: value, body, start: s.start, end: s.end }));
        }
        if (s.expr.kind === "yield") {
          this.yielding(s.expr);
          return undefined;
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
        const made = pausing ? YIELD_NOW : this.types().get(s.expr) ?? this.cx.tables.arenas.instanceOf(this.calls().get(s.expr))?.returns;
        const r = this.cx.recOf(made);
        const boxed = r?.kind === "dyn" && this.cx.tables.typing.promiseElement(r.of) !== undefined;
        if (s.expr.kind !== "assign" && s.expr.kind !== "destructure" && (r?.kind === "future" || boxed)) {
          // The prelude's call of a promise's executor: the executor written gives a Promise.
          const callee = s.start >= STD_BASE && s.expr.kind === "call" ? this.types().get(s.expr.callee) : undefined;
          const executor = callee === undefined ? undefined : this.cx.tables.typing.lower(callee);
          const closure = this.cx.recOf(executor);
          if (closure?.kind === "closure") {
            const written = bodyOf(this.cx.tables.arenas, this.cx.tables.arenas.instanceOf(this.cx.closureBodies.get(executor as ClosureType)!));
            throw new CompileError("E0305", "an executor runs at once and what it gives is dropped, so the Promise it gives would never run; keep 'resolve' and await that call beside this Promise, as in 'Promise.all([promise, later(resolve)])'", written.start, written.end);
          }
          // `spawn` runs only an async function's call, and only inside an async function.
          const spawnable = this.f().async === true && !pausing && !boxed && r?.kind === "future" && !this.cx.tables.typing.leafOf.has(made as FutureType);
          throw new CompileError("E0302", `this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'${spawnable ? ", or wrap the call in 'spawn(...)' for fire-and-forget" : ""}`, s.expr.start, s.expr.end);
        }
        // Past an assertion its condition holds, as TypeScript's `asserts cond` says.
        if (s.expr.kind === "call" && this.cx.tables.asserts.has(s.expr)) return this.proves(s.expr.args[0]!).yes;
        const assigned = this.cx.tables.rewrites.current(s.expr);
        return assigned.kind === "assign" && assigned.op === "=" ? this.settles(assigned) : undefined;
      case "let": {
        if (s.keyword === "var") throw new CompileError("E0802", "'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
        const d = this.cx.tables.rewrites.currentDeclarator(s.declarations[0]!);
        if (d.init?.kind === "arrow" && d.target.kind === "ident" && s.keyword === "const" && d.init.typeParams.some((p) => !isLifetime(p))) return this.lift(s, d.target.name, arrowFunction(this.cx.tables.ids, d.target.name, d.init, d));
        if (d.target.kind === "array" || d.target.kind === "object") return this.destructured(s, d, d.target);
        if (this.cx.tables.loopParts.has(d)) return this.loopPart(s, d);
        if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
        if (!d.init && s.keyword === "const") throw new CompileError("E0406", "a 'const' needs its value where it is declared, as TypeScript requires; use 'let' to assign it later", d.start, d.end);
        if (!d.init) return this.unassigned(s, d, d.target.name);
        if (isAwait(d.init)) this.awaiting(d.init);
        if (d.init.kind === "yield") this.yieldable.add(d.init);
        // A function type there makes the variable a stored callable.
        const declared = (d.type && this.cx.tables.typing.stored(this.cx.resolver().resolveType(d.type))) || this.cx.demands.get(s) || this.partType(s);
        // A generic function type describes the value, which keeps its own type, as an
        // interface's does.
        const named = this.cx.recOf(declared);
        const family = named?.kind === "function" && named.generic ? declared : undefined;
        const annotated = family ? undefined : declared;
        if (annotated) this.exprs().expect(d.init, annotated);
        const type = this.exprs().value(d.init);
        if (s.keyword === "let") this.exprs().readOnlySubarray(d.init);
        if (annotated) this.exprs().coerce(d.init, type, annotated, `type '${this.cx.tables.typing.show(type)}' is not assignable to type '${this.cx.tables.typing.show(annotated)}'`);
        const closure = this.cx.recOf(type);
        if (family && !(closure?.kind === "closure" && closure.generic)) throw new CompileError("E0101", `type '${this.cx.tables.typing.show(type)}' is not assignable to type '${this.cx.tables.typing.show(family)}': it takes a generic function, one that works for every type`, d.init.start, d.init.end);
        // An interface describes the value, which keeps its own concrete type.
        // A `let` may later hold another member of an enum, so it holds the enum.
        const widened = s.keyword === "let" && !annotated ? this.cx.tables.typing.widenLet(type) : type;
        if (widened !== type) this.exprs().coerce(d.init, type, widened, "");
        const array = this.cx.recOf(widened);
        if (!annotated && array?.kind === "array" && array.element === "never") {
          throw new CompileError("E0104", `an empty array needs a type to say what it will hold, like 'let ${d.target.name}: string[] = []'`, d.init.start, d.init.end);
        }
        // So does a regex given as a 'RegExp', which keeps its pattern's captures.
        const describes = annotated && (this.cx.isInterface(annotated) || (annotated === ANY_REGEX && s.keyword === "const"));
        this.declare(d.target.name, annotated && !describes ? annotated : widened, s.keyword === "let", false, s);
        if (s.keyword === "let" && !annotated && type === "i64" && this.exprs().literalOnly(d.init, false)) this.cx.candidates.set(this.locals().get(s)!, s);
        const number = s.keyword === "const" ? numberKey(d.init) : undefined;
        if (number !== undefined) this.cx.tables.numberKeys.set(this.locals().get(s)!, number);
        // A nested function's declaration, met as this `const` again when a body is checked anew.
        if (this.cx.tables.nestedFunctions.has(d.init)) this.cx.tables.nestedBindings.add(this.locals().get(s)!);
        return;
      }
      case "if": {
        this.exprs().condition(s.cond);
        const proven = this.proves(s.cond);
        const entry = [...this.facts];
        const thenEnds = this.assume(proven.yes, () => this.scoped(s.id, "then", s.then));
        const elseEnds = s.else ? this.assume(proven.no, () => this.scoped(s.id, "else", s.else!)) : new Map<string, Type>();
        // A branch that never reaches its end leaves the other's facts for what follows.
        const [thenLeaves, elseLeaves] = [this.leaves(s.then), s.else ? this.leaves(s.else) : false];
        const after = thenLeaves && !elseLeaves ? proven.no : elseLeaves && !thenLeaves ? proven.yes : undefined;
        return this.joined(after, entry, [[thenLeaves, thenEnds, proven.yes], [elseLeaves, elseEnds, proven.no]]);
      }
      case "while":
        this.exprs().condition(s.cond);
        this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.assume(this.proves(s.cond).yes, () => this.scoped(s.id, "body", s.body)));
        return;
      // A nested function is a closure under its name, lending what it uses per call.
      case "function": {
        if (!s.body) throw unsupported("nested functions without a body", s);
        if (s.typeParams.some((p) => !isLifetime(p)) && !s.generator && !s.macro) return this.lift(s, s.name, s as Func);
        if (s.typeParams.length > 0) throw unsupported("generic nested functions", s);
        if (s.generator) throw unsupported("nested generator functions", s);
        if (s.macro) throw unsupported("nested macros", s);
        const at = { start: s.start, end: s.end };
        const arrow: Expr = { id: nextId(this.cx.tables.ids), kind: "arrow", move: false, async: s.async, typeParams: [], params: s.params, returnType: s.returnType, ...(s.throws && { throws: s.throws }), body: s.body, ...at };
        this.cx.tables.nestedFunctions.set(arrow, s.name);
        // The body is the arrow's now; the statement holds nothing else, or walks over it would find
        // the body twice, as an async function's frame did, taking the function's loops and awaits
        // for its own.
        return this.statement(this.cx.tables.rewrites.replaceStmt(s, { id: 0, kind: "let", keyword: "const", declarations: [{ id: nextId(this.cx.tables.ids), target: { id: nextId(this.cx.tables.ids), kind: "ident", name: s.name, start: s.start, end: s.end }, type: undefined, init: arrow, ...at }], ...at }));
      }
      // Checked as the code it is; it runs while compiling, where its locals are its own.
      case "comptime":
        this.comptimeDepth++;
        this.floors.push(this.targets.length);
        this.scoped(s.id, "body", s.body);
        this.floors.pop();
        this.comptimeDepth--;
        return;
      case "block":
        this.scoped(s.id, "body", s.body);
        return;
      case "unsafe":
        this.exprs().unsafely(() => this.scoped(s.id, "body", s.body));
        return;
      case "debugger":
        throw unsupported("'debugger' statements", s);
      case "empty": {
        // A generic function lifted from here in an earlier check of this body.
        const lifted = this.cx.tables.liftedFunctions.get(s);
        if (lifted) {
          this.declare(lifted.name, "void", false, false, s);
          this.cx.localOf(this.locals().get(s)!).generic = this.cx.byName.get(lifted.fn.name)!;
        }
        return;
      }
      case "for":
        // A name declared in the head is scoped to the loop.
        this.pushScope(new Map<string, LocalId>());
        if (s.init) this.statement(s.init);
        if (s.test) this.exprs().condition(s.test);
        if (s.update) this.exprs().effect(s.update);
        this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
        this.popScope();
        return;
      case "forIn":
        throw unsupported("'for...in' loops", s);
      // `for (const x of arr)` borrows each element, shared, or copies a Copy one.
      case "forOf": {
        if (s.await) {
          if (!this.f().async || this.cx.tables.timerMains.has(this.f() as Body & Func)) throw new CompileError("E0301", "'for await' can only be used inside an 'async' function", s.start, s.end);
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
        const referred = this.cx.isRef(through) ? this.cx.tables.typing.rec(through).to : through;
        // An `Iterable<T>` parameter is looped over as what it stands for in an instance; at its
        // definition, it gives its `T`s.
        const element = this.cx.tables.typing.iterableElement(referred);
        const object = element === undefined ? referred : this.cx.tables.typing.lower(referred);
        const call = element === undefined ? undefined : this.exprs().iteratorCall(s.right, object);
        if (call) {
          this.recordIterator(s, cloneExpr(call));
          const made = this.exprs().value(call);
          const error = this.cx.tables.typing.generatorThrows(made);
          if (error) this.raise(call, error, "this generator");
        }
        if (element !== undefined && (object === referred || call)) {
          this.pushScope(new Map<string, LocalId>());
          this.declare(d.target.name, call ? this.cx.tables.typing.yieldsOf(this.types().get(call)!)! : element, left.keyword === "let", false, left);
          this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
          this.popScope();
          return;
        }
        const o = this.cx.recOf(object);
        // std's ServerWebSocket gives the messages its client sends.
        if (s.await && o?.kind === "class" && o.name === "ServerWebSocket" && this.cx.registry().classOf(object as ClassType).node.start >= STD_BASE) {
          const at = { start: s.right.start, end: s.right.end };
          const callee: Expr = { id: nextId(this.cx.tables.ids), kind: "member", object: s.right, name: "__wsMessages", optional: false, ...at };
          return this.statement(this.cx.tables.rewrites.replaceStmt(s, { ...s, right: { id: nextId(this.cx.tables.ids), kind: "call", callee, typeArgs: [], args: [], optional: false, ...at } }));
        }
        if (s.await) {
          this.awaitLoop(s, d.target.name, left.keyword === "let", through, object);
          return;
        }
        // A class with a `[Symbol.iterator]` method is looped over through what it gives.
        const iterator = this.exprs().iteratorCall(s.right, object) ?? this.exprs().embeddedIterated(s.right, object);
        if (iterator) return this.statement(this.cx.tables.rewrites.replaceStmt(s, { ...s, right: iterator }));
        // A loop borrows what it reads from as long as it runs, so it can't read a part of a
        // value made for the statement, which is gone before the first pass.
        // A reference reaches a value living elsewhere, wherever it came from.
        const lent = (x: Expr) => this.cx.isRef(this.types().get(x)!);
        let root = s.right;
        // A getter's result is made for the read, so the walk ends at it.
        while (!lent(root) && ((root.kind === "member" && !this.calls().has(root)) || root.kind === "index" || root.kind === "nonNull")) root = root.kind === "nonNull" ? root.expr : root.object;
        if (root !== s.right && !lent(root) && root.kind !== "ident" && root.kind !== "this" && !stringLike(this.cx.tables.typing, object)) {
          throw new CompileError("E0212", "this loop would read from a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'", s.right.start, s.right.end);
        }
        // A string gives each of its code points, as a string of its own.
        if (stringLike(this.cx.tables.typing, object)) {
          if (through !== "string") this.coercions().set(s.right, "string");
          this.pushScope(new Map<string, LocalId>());
          this.declare(d.target.name, "string", left.keyword === "let", false, left);
          this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
          this.popScope();
          return;
        }
        // A generator gives each value it yields, owned. Like JavaScript closing it when the
        // loop ends, the loop takes an owned generator over; one behind a `Mut` is lent.
        const yields = this.cx.tables.typing.yieldsOf(object);
        if (yields !== undefined) {
          if (this.cx.isRef(through) && !this.cx.tables.typing.rec(through).mutable) throw new CompileError("E0206", "a 'for...of' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
          const error = this.cx.tables.typing.generatorThrows(object);
          if (error) this.raise(s.right, error, "this generator");
          this.pushScope(new Map<string, LocalId>());
          this.declare(d.target.name, yields, left.keyword === "let", false, left);
          this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
          this.popScope();
          return;
        }
        // A fixed array's elements, as an array's: borrowed, or copies when they copy.
        if (o?.kind === "fixed") {
          this.pushScope(new Map<string, LocalId>());
          this.declare(d.target.name, this.cx.tables.typing.isCopy(o.element) ? o.element : this.cx.tables.typing.refType(o.element, false), left.keyword === "let", false, left);
          this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
          this.popScope();
          return;
        }
        // A Map gives each entry as a `[key, value]` pair, and a Set each member, in insertion
        // order: each part borrowed, or a copy when it copies.
        if (o?.kind === "map" && o.dict) throw this.exprs().notIterable(s.right);
        if (o?.kind === "map") {
          if (object !== through) this.coercions().set(s.right, object);
          const lend = (u: Type) => (this.cx.tables.typing.isCopy(u) ? u : this.cx.tables.typing.refType(u, false));
          this.pushScope(new Map<string, LocalId>());
          this.declare(d.target.name, o.set ? lend(o.key) : this.cx.tables.typing.tupleType([lend(o.key), lend(o.value)]), left.keyword === "let", false, left);
          this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
          this.popScope();
          return;
        }
        if (this.cx.tables.typing.isTuple(object) && o?.kind === "object" && !o.match) return this.statement(this.tupleLoop(s, object as ObjectType));
        if (this.cx.tables.typing.yieldsOf(object, true) !== undefined) throw new CompileError("E0119", "an async generator's values are awaited, so loop over it with 'for await'", s.right.start, s.right.end);
        if (o?.kind !== "array") throw new CompileError("E0119", `'for...of' needs an array, a Map, a Set, a string, a generator or an iterable class, not '${this.cx.tables.typing.show(object)}'`, s.right.start, s.right.end);
        if (object !== through) this.coercions().set(s.right, object);
        this.pushScope(new Map<string, LocalId>());
        this.declare(d.target.name, this.cx.tables.typing.isCopy(o.element) ? o.element : this.cx.tables.typing.refType(o.element, false), left.keyword === "let", false, left);
        this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
        this.popScope();
        return;
      }
      case "doWhile":
        this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
        this.exprs().condition(s.cond);
        return;
      case "switch": {
        const type = this.exprs().read(s.discriminant);
        const r = this.cx.recOf(type);
        const union = r?.kind === "union" ? (type as UnionType) : undefined;
        if (r && !union && r.kind !== "literal" && r.kind !== "brand") throw unsupported("comparisons of objects", s.discriminant);
        const defaults = s.cases.filter((c) => !c.test);
        if (defaults.length > 1) throw new CompileError("E0608", "a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
        // The case bodies share one scope, as in JavaScript, but any case may be entered
        // directly, skipping the bodies before it, so a binding one case declares is usable
        // only in that case.
        this.pushScope(new Map<string, LocalId>());
        this.within({ stmt: standIn(s), kind: "switch" as const }, () => {
          // A case narrows a union for its body, and so do the cases that fall through into it.
          // `falling` is what holds for a body the previous one falls into, or null when it leaves.
          let falling: Facts | null = null;
          for (const c of s.cases) {
            const before = new Set(this.innerLocals());
            let test = c.test && this.exprs().value(c.test);
            // A literal case takes the discriminant's type, or its union's one number type.
            // A brand's cases are its base's values, as `===` compares them.
            const numbers = union ? numberMembers(this.cx.tables.typing, union) : [this.cx.tables.typing.unbranded(type)];
            if (test && test !== type && numbers.length === 1 && this.exprs().adapt(c.test!, numbers[0]!)) test = numbers[0]!;
            // A discriminant whose type is still open takes an integer case's.
            if (test && test !== type && isInteger(test) && !this.exprs().literalOnly(s.discriminant, false) && this.exprs().adapt(s.discriminant, test)) test = type;
            if (test && objectsMeet(this.cx.tables.typing, type, test)) throw unsupported("comparisons of objects", c.test!);
            if (test && test !== type && !comparable(this.cx.tables.typing, this.cx.tables.typing.lower(type), test)) {
              throw new CompileError("E0112", `type '${this.cx.tables.typing.show(test)}' is not comparable to type '${this.cx.tables.typing.show(type)}'`, c.test!.start, c.test!.end);
            }
            const tested: Facts = c.test ? this.proves({ id: nextId(this.cx.tables.ids), kind: "binary", op: "===", left: s.discriminant, right: c.test, start: c.start, end: c.end }).yes : new Map();
            const reaching: Facts = falling ? either(this.cx.tables.typing, falling, tested) : tested;
            const mark = this.changed.length;
            const ends = this.assume(reaching, () => this.statements(c.id, "body", c.body));
            for (const local of this.innerLocals()) if (!before.has(local)) this.caseOnly.add(local);
            falling = this.leaves(c.body) ? null : new Map([...this.current(reaching, mark)].filter(([l]) => !ends.has(l)));
          }
        });
        this.popScope();
        return;
      }
      case "labeled": {
        if (this.targets.some((t) => t.label === s.label)) {
          throw new CompileError("E0402", `duplicate label '${s.label}'`, s.start, s.start + s.label.length);
        }
        let body = s.body;
        while (body.kind === "labeled") body = body.body;
        const loop = ["while", "doWhile", "for", "forIn", "forOf"].includes(body.kind) ? body : undefined;
        this.within({ stmt: standIn(s), kind: "label" as const, label: s.label, loop: loop !== undefined ? standIn(loop) : undefined }, () => this.statement(s.body));
        return;
      }
      case "break":
      case "continue": {
        const target = this.jumpTarget(s);
        if (this.floors.length > 0 && this.targets.findIndex((t) => t.stmt.id === target.id) < this.floors.at(-1)!) {
          throw new CompileError("E1102", `'${s.kind}' can't leave a comptime block, which runs while compiling, before the program does`, s.start, s.end);
        }
        this.jumps().set(s, target);
        (s.kind === "break" ? this.cx.broken : this.cx.continued).add(target);
        return;
      }
      case "throw":
        this.thrownAt(cloneStmt(s), { start: s.start, end: s.end }, s.value);
        return;
      case "try": {
        // Without a catch, what the block raises goes on out, after the `finally`.
        if (!s.handler) {
          this.finalizing++;
          this.scoped(s.id, "block", s.block);
          this.scoped(s.id, "finalizer", s.finalizer!);
          this.finalizing--;
          return;
        }
        if (s.finalizer) this.finalizing++;
        if (s.paramType) throw new CompileError("E0004", "a catch parameter takes no type annotation: its type is what the 'try' can throw", s.paramType.start, s.paramType.end);
        // What the block raises goes to the catch, which takes the union of it.
        this.handlers.push([]);
        this.scoped(s.id, "block", s.block);
        const sites = this.handlers.pop()!;
        if (sites.length === 0) {
          const never = new CompileError("E0603", "nothing in this 'try' can throw, so its 'catch' never runs; remove the try/catch", s.start, s.start + 3);
          this.cx.tryCallees.push([never, [...this.instance().calls].filter(([x]) => x.start >= s.start && x.end <= s.end).map(([, i]) => this.cx.tables.arenas.instanceOf(i).body)]);
          throw never;
        }
        const caught = this.cx.tables.typing.unionType(sites.map(([, t]) => t));
        for (const [at, from] of sites) this.instance().raises.set(at, { from, to: caught });
        this.instance().caught.set(s, caught);
        this.pushScope(new Map<string, LocalId>());
        if (s.param) {
          if (s.param.kind !== "ident") throw unsupported("destructuring patterns", s.param);
          this.declare(s.param.name, caught, true, false, s);
        }
        this.statements(s.id, "handler", s.handler!);
        this.popScope();
        if (s.finalizer) {
          this.scoped(s.id, "finalizer", s.finalizer);
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
          this.jumps().set(s, arm.stmt);
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
        if (this.f().self?.constructor && s.value) throw new CompileError("E0605", "a constructor can't return a value", s.start, s.end);
        if (this.unset.size > 0) throw new CompileError("E0605", "a constructor can't return before every field is assigned", s.start, s.end);
        if (this.declared && s.value) this.exprs().expect(s.value, this.declared);
        // An arrow's expression body may be a call returning nothing.
        const type = !s.value ? "void" : s.value === this.f().closure?.value && (s.value.kind === "call" || s.value.kind === "tagged") ? this.exprs().result(s.value) : this.exprs().value(s.value);
        // A closure returned is boxed into the callable the function declares.
        // A generic function value is returned as it is, capturing nothing.
        const r = this.cx.recOf(type);
        if (r?.kind === "closure" && !r.generic && this.cx.recOf(this.declared)?.kind !== "dyn") {
          if (this.f().comptime === "const") throw new CompileError("E0801", "a top-level const holding a function is supported when its value is an arrow written in place, as in 'const f = (x: i64) => ...'; declare the function with 'function', or call it by its own name", s.value!.start, s.value!.end);
          throw unsupported("functions returned without a function return type", s.value!);
        }
        // Returns of different regexes give any regex, as TypeScript infers 'RegExp'.
        if (!this.declared && this.cx.recOf(this.inferred)?.kind === "regex" && r?.kind === "regex" && this.inferred !== type) this.inferred = ANY_REGEX;
        const expected = this.declared ?? this.inferred;
        // A subclass's copy of a member returning `this` must give back the subclass.
        const inherits = this.f().copyOf !== undefined && selfTyped(this.f()) ? `: '${this.cx.tables.typing.show(this.f().self!.type)}' inherits this method, and its 'this' return type is the receiver's own class, so return 'this'` : "";
        const message = `type '${this.cx.tables.typing.show(type)}' is not assignable to return type '${this.cx.tables.typing.show(expected ?? type)}'${inherits}`;
        if (expected && s.value) this.exprs().coerce(s.value, type, expected, message);
        else if (expected && type !== expected) throw new CompileError("E0101", message, s.start, s.end);
        const bound = r?.kind === "param" ? this.cx.recOf(r.bound) : undefined;
        const passedOn = bound?.kind === "function" && bound.generic !== undefined;
        if (this.family && !passedOn && !(r?.kind === "closure" && r.generic)) throw new CompileError("E0101", `type '${this.cx.tables.typing.show(type)}' is not assignable to return type '${this.cx.tables.typing.show(this.family)}': it takes a generic function, one that works for every type`, (s.value ?? s).start, (s.value ?? s).end);
        const reason = this.trait && unsatisfied(type, this.trait, this.cx.members(), s.value ?? s);
        if (reason) throw new CompileError("E0101", `type '${this.cx.tables.typing.show(type)}' is not assignable to return type '${this.cx.tables.typing.rec(this.trait!).name}': ${reason}`, (s.value ?? s).start, (s.value ?? s).end);
        this.inferred = expected ?? type;
        return;
      }
    }
  }

  // `for await`: an async generator gives each value it yields, as a generator's loop does, and
  // a Channel each value it receives until it is closed and drained.
  /** @throws {CompileError} */
  awaitLoop(this: Mut<this>, s: Extract<Stmt, { kind: "forIn" | "forOf" }>, name: string, mutable: boolean, through: Type, object: Type) {
    const yields = this.cx.tables.typing.yieldsOf(object, true);
    const o = this.cx.recOf(object);
    const channel = o?.kind === "block" && o.which === "Channel" ? this.cx.tables.typing.lowerKeepingBrands(o.of) : undefined;
    if (yields === undefined && channel === undefined) {
      throw new CompileError("E0119", `'for await' loops over an async generator or a Channel, not '${this.cx.tables.typing.show(through)}'`, s.right.start, s.right.end);
    }
    if (yields !== undefined && this.cx.isRef(through) && !this.cx.tables.typing.rec(through).mutable) throw new CompileError("E0206", "a 'for await' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'", s.right.start, s.right.end);
    const error = this.cx.tables.typing.generatorThrows(object);
    if ((error !== undefined)) this.raise(s.right, error, "this generator");
    this.pushScope(new Map<string, LocalId>());
    this.declare(name, yields ?? channel!, mutable, false, s.left as Stmt);
    this.within({ stmt: standIn(s), kind: "loop" as const }, () => this.scoped(s.id, "body", s.body));
    this.popScope();
  }

  // The `this.x` a statement assigns, when it is a plain assignment to one of the class's
  // own fields. A setter is a method, which can't run until every field is set.
  // `yield v;`: the generator gives `v` and stops until `next()` is called again. It runs as
  // a statement of its own, or as all of a declaration's initializer or an assignment's value,
  // so nothing the statement made is pending across it. Its value is what `next(x)` sends.
  /** @throws {CompileError} */
  yielding(this: Mut<this>, e: Ref<Extract<Expr, { kind: "yield" }>>): Type {
    if ((this.generatorType === undefined)) throw new CompileError("E0606", "'yield' can only be used inside a 'function*'", e.start, e.end);
    if (this.yieldable.has(e) && this.f().async === true) throw unsupported("values sent into an async generator's 'next'", e);
    if (this.yieldable.has(e) && this.sends === undefined) {
      throw new CompileError("E0606", `this 'yield' gives what 'next(x)' sends, so declare what that is, as in 'Generator<${(this.yielded !== undefined) ? this.cx.tables.typing.show(this.yielded) : "T"}, void, string>'`, e.start, e.end);
    }
    if (this.targets.some((t) => t.kind === "arm")) throw unsupported("'yield' inside match arms", e);
    if (this.finalizing > 0) throw unsupported("'yield' statements in a 'try' with a 'finally'", e);
    if (e.delegate) throw unsupported("'yield*'", e);
    if ((e.value === undefined)) throw new CompileError("E0606", "a generator's 'yield' gives a value, like 'yield x;'", e.start, e.end);
    if (this.yielded) this.exprs().expect(e.value, this.yielded);
    const t = this.exprs().value(e.value);
    if (!this.yielded) this.yielded = this.cx.tables.typing.widenLet(t);
    if (this.cx.tables.typing.holdsRef(this.yielded)) throw unsupported("generators yielding references", e.value);
    this.exprs().coerce(e.value, t, this.yielded, `type '${this.cx.tables.typing.show(t)}' is not assignable to the generator's '${this.generatorName}<${this.cx.tables.typing.show(this.yielded)}>'`);
    return this.sends ?? "void";
  }

  // An `await` written as a statement of its own, or as all of a declaration's initializer,
  // an assignment's value or a return's: one the state machine can stop at with nothing else
  // of the statement pending.
  /** @throws {CompileError} */
  awaiting(this: Mut<this>, e: Expr) {
    if ((this.f().async !== true)) return;
    if (this.targets.some((t) => t.kind === "arm")) throw unsupported("'await' inside match arms", e);
    if (this.finalizing > 0) throw unsupported("'await' statements in a 'try' with a 'finally'", e);
    this.awaitable.add(e);
  }

  /** @throws {CompileError} */
  fieldAssignment(this: Mut<this>, s: Ref<Stmt>): Extract<Expr, { kind: "member" }> | undefined {
    if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
    // This runs before the statement is checked; a `!` here that can unwrap is refused there.
    let target = s.expr.target;
    while (target.kind === "nonNull") target = target.expr;
    if (target.kind !== "member" || target.object.kind !== "this") return undefined;
    // Once `super(...)` has run, the base's fields are set, and may be set again before the
    // class's own are.
    const { base } = this.cx.tables.typing.rec(this.f().self!.type);
    const inherited = !this.unset.has(SUPER) && base !== undefined && this.cx.tables.typing.field(base, target.name) !== undefined;
    const name = target.name;
    return this.cx.registry().classOf(this.f().self!.type).fields.some((d) => d.name === name) || inherited ? { ...target } : undefined;
  }

  /** @throws {CompileError} */
  within(this: Mut<this>, target: Target, check: InScope<void>): Target {
    target.facts = this.facts.length;
    this.targets.push(target);
    check();
    return this.targets.pop()!;
  }

  /** @throws {CompileError} */
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
  // Whether a check made here rules out what a variable or field holds, which the narrowing
  // marks by giving it the type `never`.
  private ruledOut(): boolean {
    return this.facts.some((m) => [...m.values()].includes("never"));
  }

  leaves(stmts: Stmt[]): boolean {
    const last = stmts.at(-1);
    return alwaysReturns(stmts, this.cx.broken, this.cx.continued) || last?.kind === "break" || last?.kind === "continue";
  }

  /** @throws {CompileError} */
  scoped(this: Mut<this>, owner: usize, field: string, stmts: Ref<Stmt[]>): Facts {
    this.pushScope(new Map<string, LocalId>());
    const ends = this.statements(owner, field, stmts);
    this.popScope();
    return ends;
  }

  /** @throws {CompileError} */
  declare(this: Mut<this>, name: string, type: Type, mutable: boolean, param: boolean, node: Ref<Stmt | Param | Expr>): void {
    // A destructuring's own variable, named for its pattern, may repeat; nothing names it.
    if (this.innerScope().has(name) && !name.startsWith("[") && !name.startsWith("{")) throw new CompileError("E0402", `cannot redeclare '${name}' in the same scope`, node.start, node.end);
    const localId = this.cx.tables.arenas.addLocal({ name, type, mutable, param, id: this.cx.nextLocal++ }).localId;
    this.depths.set(localId, this.scopeList().length);
    this.innerScope().set(name, localId);
    this.locals().set(node, localId);
    this.cx.tables.declarations.add(node);
  }

  lookup(this: Mut<this>, name: string, at: Ref<Expr | ObjectProp> | undefined): LocalId | undefined {
    for (let i = this.scopeList().length - 1; i >= (this.hidden ? 1 : 0); i--) {
      const local = this.scopeList()[i]!.get(name);
      if (local !== undefined) return local;
    }
    const outside = this.outer?.lookup(name, at);
    if (outside === undefined) return undefined;
    // A local generic function holds nothing to capture.
    return this.cx.localOf(outside).generic !== undefined ? outside : this.capture(outside, at);
  }

  // Whether a binding is the one a sync nested function's declaration makes, or a closure's
  // capture of it.
  nestedLocal(this: Mut<this>, lId: LocalId): boolean {
    const written = this.cx.localOf(lId).type;
    const type = this.cx.tables.typing.lower(written);
    const closure = this.cx.recOf(type);
    if (!this.cx.tables.nestedBindings.has(lId) || closure?.kind !== "closure") return false;
    const nested = this.cx.tables.arenas.instanceOf(this.cx.closureBodies.get(type as ClosureType));
    return nested === undefined || bodyOf(this.cx.tables.arenas, nested).async !== true;
  }

  peek(this: Mut<this>, name: string): LocalId | undefined {
    for (let i = this.scopeList().length - 1; i >= (this.hidden ? 1 : 0); i--) {
      const local = this.scopeList()[i]!.get(name);
      if (local !== undefined) return local;
    }
    return this.outer?.peek(name);
  }

  inScope(this: Mut<this>): string[] {
    let out: string[] = [];
    for (let i: usize = this.hidden ? 1 : 0; i < this.scopeList().length; i++) for (const name of this.scopeList()[i]!.keys()) out.push(name);
    if (this.outer !== undefined) for (const name of this.outer.inScope()) out.push(name);
    return out;
  }

  // By the binding itself, not its name, which a body in between may have taken for another.
  reach(this: Mut<this>, l: LocalId, at: Ref<Expr | ObjectProp> | undefined): LocalId {
    if (this.capturesHas(l) || this.scopeList().some((scope) => [...scope.values()].includes(l))) return l;
    if (this.outer === undefined) return l;
    const reached = this.outer.reach(l, at);
    return this.capture(reached, at);
  }

  // A generic function written in a body, or a generic arrow a const holds, is a generic
  // function of its own, instantiated per call, so it can use nothing of the body around it.
  /** @throws {CompileError} */
  lift(this: Mut<this>, s: Stmt, name: string, fn: Func): undefined {
    this.lifted(s, name, fn, `'${name}'`);
    return this.statement(this.cx.tables.rewrites.replaceStmt(s, { id: 0, kind: "empty", start: s.start, end: s.end })) as undefined;
  }

  // A generic arrow written as a value is a generic function of its own, as one a const holds
  // is, and the arrow becomes its name.
  /** @throws {CompileError} */
  liftArrow(this: Mut<this>, e: Ref<Extract<Expr, { kind: "arrow" }>>): Expr {
    const fn = this.lifted(e, "", arrowFunction(this.cx.tables.ids, "", e, e), "this arrow");
    return this.cx.tables.rewrites.replace(e, { id: 0, kind: "ident", name: fn.name, start: e.start, end: e.end });
  }

  // Lifts a generic function out of the body around it, once per place it is written. `who`
  // names it in messages.
  /** @throws {CompileError} */
  lifted(this: Mut<this>, key: Stmt | Expr, name: string, fn: Func, who: string): Func {
    const own = fn as Extract<Stmt, { kind: "function" }>;
    if (fn.body && holdsNode({ of: "stmts", node: fn.body }, (n) => n.of === "expr" && n.node.kind === "this")) {
      throw new CompileError("E0409", `${who} is generic, so it is made anew for each call and can't use 'this'; pass what it needs as a parameter`, fn.start, fn.end);
    }
    // It is checked apart from the body around it, so a name that body declares anywhere,
    // before or after, a sibling generic function or a type parameter included, would mean
    // something else inside it.
    const around = new Set([...declaredIn(this.f()), ...(this.f().scope?.keys() ?? []), ...this.scopeList().flatMap((s) => [...s.keys()])]);
    for (const n of freeNames(own)) {
      if (n !== name && (around.has(n) || this.lookup(n, undefined) !== undefined)) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use '${n}' from there; pass it as a parameter, or declare it at the top level`, fn.start, fn.end);
    }
    const outer = (n: AnyNode) => {
      if (n.of !== "typeNode" || n.node.kind !== "ref") return false;
      const name = n.node.name;
      return around.has(name) && !(fn.typeParams ?? []).some((p) => p.name === name);
    };
    const typed = fn.params.some((p) => holdsNode({ of: "param", node: p }, outer)) || (fn.returnType !== undefined && holdsNode({ of: "typeNode", node: fn.returnType }, outer)) || (fn.body !== undefined && holdsNode({ of: "stmts", node: fn.body }, outer));
    if (typed) throw new CompileError("E0409", `${who} is generic, so it is made apart from the function around it and can't use its types; declare it at the top level`, fn.start, fn.end);
    let lifted = this.cx.tables.liftedFunctions.get(key);
    if (!lifted) {
      lifted = { name, fn: { ...fn, id: nextId(this.cx.tables.ids), name: `${this.f().name}.${name || "arrow"}#${this.cx.tables.counts.lifts++}` } };
      // Its calls of itself call what it was lifted to.
      const symbol = lifted.fn.name;
      if (fn.body) walk({ of: "stmts", node: fn.body }, (n) => {
        if (n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && n.node.callee.name === name) this.cx.tables.rewrites.replace(n.node.callee, { ...n.node.callee, name: symbol });
      });
      this.cx.tables.liftedFunctions.set(key, lifted);
      this.cx.byName.set(lifted.fn.name, this.cx.addBody(lifted.fn));
      this.cx.funcs.push(this.cx.addBody(lifted.fn));
    }
    return lifted.fn;
  }

  // Whether `this` may be used: a constructor's can't until every field is assigned, nor can
  // a closure's made before then.
  thisReady(this: Mut<this>, e: Ref<Expr>): boolean {
    return this.outer !== undefined ? this.outer.thisReady(e) : this.unset.size === 0 || e.id === this.exempt;
  }

  // A closure changing what it captures captures it mutably, if it may change where the
  // closure is made.
  /** @throws {CompileError} */
  changesCapture(this: Mut<this>, lId: LocalId | undefined, path: string, action: string, target: Ref<Expr>, throughMut: boolean): void {
    const l = lId === undefined ? undefined : this.cx.localOf(lId);
    const alias = l?.localId ?? [...this.captures!].find(([, from]) => from === "this")![0];
    const held = this.captures!.get(alias)!;
    this.instance().changed!.add(alias);
    const from = held === "this" ? held : this.cx.localOf(held);
    if (from === "this") this.outer!.changesThis(path, action, target);
    // What a `move` closure holds is its own to change, unless the change goes through a
    // mutable reference it holds a copy of; as in Rust, only a copy of a `let` may change.
    else if (this.f().closure!.move && !(this.cx.isRef(from.type) && (path || throughMut))) {
      if (this.outer!.constant(from.localId)) {
        throw new CompileError("E0207", `cannot ${action} '${from.name}${path}' in this closure because '${from.name}' is a constant; declare it with 'let'`, target.start, target.end);
      }
      return;
    }
    else {
      if (!path && action === "assign to" && this.cx.isRef(from.type) && !this.cx.tables.typing.rec(from.type).mutable) throw unsupported("closures that point captured references elsewhere", target);
      this.outer!.changesLocal(from, path, action, target, throughMut);
    }
  }

  constant(this: Mut<this>, lId: LocalId): boolean {
    const from = this.outsideOf(lId);
    if ((from !== undefined) && from !== "this" && this.outer !== undefined) return this.outer.constant(from);
    return !this.cx.localOf(lId).mutable;
  }

  // `throw` returns an error of the type the function declares, or goes to a catch. A value
  // the error type takes is converted to it; another may be wrapped.
  /** @throws {CompileError} */
  thrown(this: Mut<this>, at: Ref<Expr>, thrownValue: Ref<Expr>): void {
    this.thrownAt(cloneExpr(at), { start: at.start, end: at.end }, thrownValue);
  }

  /** @throws {CompileError} */
  thrownAt(this: Mut<this>, at: Expr | Stmt, span: { start: usize; end: usize }, thrownValue: Ref<Expr>): void {
    const type = this.exprs().value(thrownValue);
    const into = (this.errorType !== undefined) && this.handlers.length === 0 && (this.cx.tables.typing.fits(type, this.errorType) || this.exprs().adapt(thrownValue, this.errorType));
    if (into) this.exprs().coerce(thrownValue, type, this.errorType!, `type '${this.cx.tables.typing.show(type)}' can't be thrown here: ${this.who()} throws '${this.cx.tables.typing.show(this.errorType!)}'`);
    this.raiseAt(at, span, into ? this.errorType! : this.types().get(thrownValue)!, "'throw'", true);
  }

  // An error raised by a call or a `throw` goes to the function's caller, which needs a
  // `throws` clause it fits.
  /** @throws {CompileError} */
  raise(this: Mut<this>, at: Ref<Expr>, type: Type, what: string): void {
    this.raiseAt(cloneExpr(at), { start: at.start, end: at.end }, type, what, at.kind === "throw");
  }

  // `site` raises the error, written at `span`; `throwing` when it is a `throw`.
  /** @throws {CompileError} */
  raiseAt(this: Mut<this>, at: Expr | Stmt, span: { start: usize; end: usize }, type: Type, what: string, throwing: boolean): void {
    if (this.cx.tables.typing.holdsRef(type)) throw unsupported("errors holding references", span);
    if (this.handlers.length > 0) {
      this.handlers[this.handlers.length - 1]!.push([at, type]);
      return;
    }
    // An error comptime code doesn't catch is a compile error where it runs, so it may throw any.
    if (this.f().comptime !== undefined || this.comptimeDepth > 0) return;
    if (this.built) throw new CompileError("E0602", "a constructor can only throw before it assigns its first field, so a failed 'new' leaves nothing half built; field initializers count as assigned first, so check and throw before assigning, then assign the fields", span.start, span.end);
    if (this.inferring !== undefined) {
      this.inferring!.push([at, type]);
      return;
    }
    if (this.errorType === undefined && this.contextual !== undefined) {
      const does = throwing ? `this closure throws '${this.cx.tables.typing.show(this.cx.tables.typing.widenLet(type))}'` : `${what} can throw '${this.cx.tables.typing.show(this.cx.tables.typing.widenLet(type))}'`;
      throw new CompileError("E0602", `${does}, but the closure is given as '${this.cx.tables.typing.show(this.contextual)}', which throws nothing; catch it inside the closure with try/catch`, span.start, span.end);
    }
    if (this.errorType === undefined) {
      const does = throwing ? "to throw here" : `since ${what} can throw '${this.cx.tables.typing.show(type)}'`;
      throw new CompileError("E0602", `${this.who()} must declare 'throws ${this.cx.tables.typing.show(type)}' after its return type ${does}, or catch it with try/catch`, span.start, span.end);
    }
    if (this.cx.tables.typing.fits(type, this.errorType)) {
      this.instance().raises.set(at, { from: type, to: this.errorType });
      return;
    }
    // An error the declared type doesn't take may be wrapped by a class of it that
    // implements `From` for it.
    const union = this.cx.recOf(this.errorType);
    let candidates: Type[] = [];
    if (union !== undefined && union.kind === "union") for (const m of union.members) candidates.push(m);
    else candidates.push(this.errorType);
    let classes: ClassType[] = [];
    for (const m of candidates) if (typeof m !== "string" && this.cx.tables.typing.rec(m).kind === "class") classes.push(m as ClassType);
    let wrappers: { wrapper: ClassType; param: Type; via: InstanceId }[] = [];
    for (const c of classes) {
      const id = this.cx.registry().classIdOf(c);
      let taking: [BodyId, Type][] = [];
      for (const [x, body, param] of this.cx.registry().wrapsOf(id)) if (this.cx.tables.typing.fits(type, x)) taking.push([body, param]);
      for (const [body, param] of taking) wrappers.push({ wrapper: c, param, via: this.cx.instanceOf(body) });
    }
    const does = throwing ? `this 'throw' throws '${this.cx.tables.typing.show(type)}'` : `${what} can throw '${this.cx.tables.typing.show(type)}'`;
    if (wrappers.length === 0) {
      const hint = classes.length > 0 ? `convert it, or have '${this.cx.tables.typing.rec(classes[0]!).name}' implement 'From<${this.cx.tables.typing.show(type)}>'` : `convert it to '${this.cx.tables.typing.show(this.errorType)}'`;
      throw new CompileError("E0602", `${does}, which isn't the '${this.cx.tables.typing.show(this.errorType)}' that ${this.who()} throws; ${hint}`, span.start, span.end);
    }
    if (wrappers.length > 1) {
      throw new CompileError("E0602", `${does}, which ${wrappers.map((w) => `'${this.cx.tables.typing.rec(w.wrapper).name}'`).join(" and ")} both wrap; throw one of them yourself`, span.start, span.end);
    }
    this.instance().raises.set(at, { from: type, to: this.errorType, ...wrappers[0]! });
  }

  // Who throws, in messages: the function, or the closure or nested function it is in.
  who(): string {
    const self = this.f().closure?.self;
    return self !== undefined ? `'${self}'` : this.f().closure !== undefined ? "this closure" : `'${this.f().name}'`;
  }

  noteThis(this: Mut<this>, e: Ref<Expr>): void {
    if (this.captures === undefined || [...this.captures.values()].includes("this")) return;
    const alias = this.cx.tables.arenas.addLocal({ name: "this", type: this.self!.type, mutable: false, param: false, id: this.cx.nextLocal++ });
    this.captures.set(alias.localId, "this");
    let inst = this.instance();
    if (inst.captureUses !== undefined) inst.captureUses.set(alias.localId, cloneExpr(e));
    if (this.outer !== undefined) this.outer.noteThis(e);
  }

  // Who a closure's body counts as for access to private members: its function's class.
  closureOwner(this: Mut<this>, b: Body): Body["owner"] {
    let outerBody = b;
    while (outerBody.closure !== undefined) outerBody = bodyOf(this.cx.tables.arenas, this.cx.tables.arenas.instanceOf(outerBody.closure!.parent));
    return outerBody.declared ?? (outerBody.owner && outerBody.owner === this.enclosing?.type ? this.self!.type : outerBody.owner);
  }

  // A variable's type where something narrowed it: a captured one as it was where the closure
  // was made.
  narrowed(this: Mut<this>, lId: LocalId): Type | undefined {
    const outside = this.outsideOf(lId);
    const known = this.factOf(bindingKey(lId));
    if (known !== undefined) return known;
    if (outside === undefined || outside === "this" || this.outer === undefined) return undefined;
    return !this.outer.reassigned(outside) ? this.outer.narrowed(outside) : undefined;
  }

  // A closure's body reads a variable it captures through a binding of its own, standing
  // for it.
  capture(this: Mut<this>, fromId: LocalId, at?: Ref<Expr | ObjectProp>): LocalId {
    let alias = this.captureOf(fromId);
    if (alias === undefined) {
      const name = this.cx.localOf(fromId).name;
      const type = this.cx.localOf(fromId).type;
      const made = this.cx.tables.arenas.addLocal({ name, type, mutable: false, param: false, id: this.cx.nextLocal++ }).localId;
      this.depths.set(made, 0);
      if (this.captures !== undefined) this.captures.set(made, fromId);
      if (this.cx.tables.nestedBindings.has(fromId)) this.cx.tables.nestedBindings.add(made);
      alias = made;
    }
    if (at !== undefined) this.noteCaptureUse(alias, at);
    return alias;
  }
  // The binding a closure reads `from` through, when it has made one.
  private captureOf(from: LocalId): LocalId | undefined {
    if (this.captures === undefined) return undefined;
    for (const [alias, l] of this.captures) if (l === from) return alias;
    return undefined;
  }
  // Where a closure first uses what one of its bindings captures.
  private noteCaptureUse(this: Mut<this>, alias: LocalId, at: Ref<Expr | ObjectProp>): void {
    let inst = this.instance();
    if (inst.captureUses === undefined || inst.captureUses.has(alias)) return;
    inst.captureUses.set(alias, at.kind === "shorthand" ? cloneObjectProp(at) : cloneExpr(at as Ref<Expr>));
  }
}

// The `this` a body sees: a closure's is that of the function it is written in.
export function selfOf(arenas: Ref<Arenas>, f: Ref<Body>): Body["self"] {
  if (f.closure !== undefined) return selfOf(arenas, bodyOf(arenas, arenas.instanceOf(f.closure.parent)));
  if (f.self === undefined) return undefined;
  return f.self.owned !== undefined ? { type: f.self.type, constructor: f.self.constructor, mutable: f.self.mutable, owned: f.self.owned } : { type: f.self.type, constructor: f.self.constructor, mutable: f.self.mutable };
}

// Stands for the base in a derived constructor's unset fields until `super(...)` runs.
const SUPER = "super()";

// What a returned reference borrows from: a parameter, by index, or `this`.
export type Origin = usize | "this";

function hasBody(f: Ref<Declared>): f is Func {
  return f.body !== undefined;
}

// An abstract class a type holds as a value, not one embedded as a concrete class's base.
function abstractPart(typing: Ref<Typing>, t: Type): ClassType | undefined {
  let bases = new TypeSet<Type>();
  let found: ClassType | undefined = undefined;
  typing.holdsPart(t, (u) => {
    if (typeof u === "string") return false;
    const r = typing.rec(u);
    if (r.kind !== "class") return false;
    if (r.base !== undefined) bases.add(r.base);
    if (r.abstract === true && !bases.has(u)) found = u as ClassType;
    return found !== undefined;
  }, true);
  return found;
}

// Where a compiled instance reaches one that isn't compiled: the expression's span and the name
// it called by, the instance, and how it got there.
type Reach = { start: usize; end: usize; named: string | undefined; target: InstanceId; through: string };

function reachAt(at: Ref<Expr>, target: InstanceId, through: string): Reach {
  let named: string | undefined = undefined;
  if (at.kind === "call" || at.kind === "new") named = calledName(at.callee);
  return { start: at.start, end: at.end, named, target, through };
}

// A net under the rules that decide what is compiled: no compiled function calls, and no
// compiled Dyn's table holds, an instance that isn't compiled. Only a value of an abstract
// class's own type, which escaped where no rule saw it, could reach one.
// Where the first of a declaration's decorators is written, if it has one.
function firstSpan(xs: Ref<Expr[] | undefined>): { start: usize; end: usize } | undefined {
  if (xs === undefined || xs.length === 0) return undefined;
  return { start: xs[0]!.start, end: xs[0]!.end };
}

// Whether a written type names `name` with no type arguments' say: `T` or `T<...>`.
function refNamed(t: Ref<TypeNode | undefined>, name: string): boolean {
  return t !== undefined && t.kind === "ref" && t.name === name;
}

function cloneParams(ps: Ref<Param[]>): Param[] {
  let out: Param[] = [];
  for (const p of ps) out.push(cloneParam(p));
  return out;
}

// The class an `extends` names, written plainly or with type arguments.
function extendedName(e: Ref<Expr>): string | undefined {
  if (e.kind === "ident") return e.name;
  if (e.kind === "instantiation") return identName(e.expr);
  return undefined;
}

function identName(e: Ref<Expr>): string | undefined {
  return e.kind === "ident" ? e.name : undefined;
}

// What a generator's `next()` gives, as the frame of a `for await` over one awaits it: a boxed
// one's lent promise, or another's promise.
function nextOf(typing: Mut<Typing>, held: Type): Type {
  const yields = typing.yieldsOf(held, true)!;
  return typing.nextResult(yields);
}

function lentNext(typing: Mut<Typing>, held: Type): Type {
  const next = nextOf(typing, held);
  return typing.lentPromise(next);
}

function promisedNext(typing: Mut<Typing>, held: Type): Type {
  const next = nextOf(typing, held);
  return typing.promiseInterface(next);
}

// What a reference refers to, or the type itself.
function heldThrough(typing: Ref<Typing>, t: Type): Type {
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  return r.kind === "ref" ? r.to : t;
}

// Whether a type is a JsValue.
function isJs(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  return r.kind === "block" && r.which === "JsValue";
}

function holdsJs(typing: Ref<Typing>, t: Type): boolean {
  return typing.holdsPart(t, (u) => isJs(typing, u), true);
}

// Whether an instance is checked and never compiled: a template's, one made for an abstract
// class, or a closure of either.
function checkedOnly(tables: Ref<Tables>, i: Ref<Instance>): boolean {
  const b = bodyOf(tables.arenas, i);
  if (b.template === true) return true;
  for (const t of i.bindings.values()) if (abstractPart(tables.typing, t) !== undefined) return true;
  return b.closure !== undefined && checkedOnly(tables, tables.arenas.instanceOf(b.closure!.parent));
}

// The span that starts first, the earlier one where two start together.
function earliestOf(spans: Ref<Expr[]>): { start: usize; end: usize } | undefined {
  let first: { start: usize; end: usize } | undefined = undefined;
  for (const e of spans) if (first === undefined || e.start < first.start) first = { start: e.start, end: e.end };
  return first;
}

// The type an argument crosses into JS as: the stored callable a callback meets, or its own.
function crossingType(typing: Ref<Typing>, i: Ref<Instance>, a: Ref<Expr>): Type {
  const to = i.coercions.get(a);
  return to !== undefined && typing.holdsPart(to, (u) => typeof u !== "string" && typing.rec(u).kind === "dyn") ? to : i.types.get(a)!;
}

function calledName(callee: Ref<Expr>): string | undefined {
  if (callee.kind === "ident" || callee.kind === "member") return callee.name;
  return undefined;
}

/** @throws {CompileError} */
export function unreached(typing: Ref<Typing>, equalities: Ref<Tables["equalities"]>, arenas: Ref<Arenas>, compiled: Ref<InstanceId[]>, dropped: (i: Ref<Instance>) => boolean) {
  for (const each of compiled) {
    const i = arenas.instanceOf(each);
    let hit: Reach | undefined = undefined;
    for (const [at, target] of i.calls) if (hit === undefined && dropped(arenas.instanceOf(target))) hit = reachAt(at, target, "");
    for (const [at, target] of i.setters) if (hit === undefined && dropped(arenas.instanceOf(target))) hit = reachAt(at, target, "");
    if (i.dyns !== undefined) {
      for (const [at] of i.dyns!) {
        const table = i.dyns!.get(at)!;
        let targets: InstanceId[] = [];
        for (const t of table.methods) if (t !== undefined) targets.push(t);
        for (const t of table.fields) if (t !== undefined) targets.push(t);
        if (table.clone !== undefined && table.clone !== "copy") targets.push(table.clone);
        for (const t of targets) if (hit === undefined && dropped(arenas.instanceOf(t))) hit = reachAt(at, t, " through a 'Dyn'");
      }
    }
    // A comparison of values runs each class's `equals` it reaches, through objects and unions.
    for (const [k] of i.types) {
      const e: Ref<Expr> = k;
      if (hit !== undefined) break;
      if (e.kind !== "binary" || (e.op !== "===" && e.op !== "!==" && e.op !== "==" && e.op !== "!=")) continue;
      const left = comparedBy(typing, equalities, i.types.get(e.left), new TypeSet<Type>());
      const right = comparedBy(typing, equalities, i.types.get(e.right), new TypeSet<Type>());
      for (const t of left) if (hit === undefined && dropped(arenas.instanceOf(t))) hit = reachAt(e, t, " to compare them");
      for (const t of right) if (hit === undefined && dropped(arenas.instanceOf(t))) hit = reachAt(e, t, " to compare them");
    }
    if (hit === undefined) continue;
    const target = arenas.instanceOf(hit.target);
    const body = bodyOf(arenas, target);
    let abstract = body.abstract === true ? body.owner : undefined;
    if (abstract === undefined) for (const t of target.bindings.values()) if (abstract === undefined) abstract = abstractPart(typing, t);
    if (abstract === undefined) abstract = body.declared;
    if (abstract === undefined) abstract = body.owner;
    const root = bodyOf(arenas, arenas.instanceOf(closureRoot(arenas, i.id)));
    const member = (root.owner !== undefined ? root.name.slice((typing.rec(root.owner).name.length + 1) as i64) : root.name).replace(/#.*$/, "");
    // The name the call wrote, rather than the prelude function it may run.
    const named = hit.named !== undefined ? hit.named : body.name.replace(/#.*$/, "");
    throw new CompileError("E0701", `a value of the abstract class '${abstract === undefined ? "undefined" : typing.rec(abstract).name}' can't reach '${named}'${hit.through} here yet; pass a subclass's value instead, or give '${member}' to each subclass`, hit.start, hit.end);
  }
}

// Each `equals` a comparison of two values runs, as codegen finds them: a class's own stops the
// search, and otherwise its base and fields, an object's fields and a union's members compare.
function comparedBy(typing: Ref<Typing>, equalities: Ref<Tables["equalities"]>, t: Type | undefined, seen: Mut<TypeSet<Type>>): InstanceId[] {
  let out: InstanceId[] = [];
  comparedInto(typing, equalities, t, seen, out);
  return out;
}

function comparedInto(typing: Ref<Typing>, equalities: Ref<Tables["equalities"]>, t: Type | undefined, seen: Mut<TypeSet<Type>>, out: Mut<InstanceId[]>): void {
  if (t === undefined || typeof t === "string" || seen.has(t)) return;
  seen.add(t);
  const r = typing.rec(t);
  if (r.kind === "ref") {
    comparedInto(typing, equalities, r.to, seen, out);
    return;
  }
  if (r.kind === "class") {
    const own = equalities.get(t as ClassType);
    if (own !== undefined) {
      out.push(own);
      return;
    }
    comparedInto(typing, equalities, r.base, seen, out);
    for (const f of r.fields) comparedInto(typing, equalities, f.type, seen, out);
    return;
  }
  if (r.kind === "union") for (const u of r.members) comparedInto(typing, equalities, u, seen, out);
  if (r.kind === "object") for (const f of r.fields) comparedInto(typing, equalities, f.type, seen, out);
}

function closureRoot(arenas: Ref<Arenas>, i: InstanceId): InstanceId {
  const closure = bodyOf(arenas, arenas.instanceOf(i)).closure;
  return closure !== undefined ? closureRoot(arenas, closure.parent) : i;
}
