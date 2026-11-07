import type { Declarations, Tables } from "./compilation.ts";
import { stdModuleAt, textAt } from "./program.ts";
import { rustClassOf, type RustClass } from "./rust.ts";
import { abstractIn, copyFor, inherited, selfTyped, shownName, isLifetime, type Body, type ClassInfo, type FieldDecl } from "./classes.ts";
import { openParam } from "./typefns.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { Direct } from "./overloads.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, Func, Interface, MatchArm, ObjectProp, Param, PropertyName, Pattern, Span, Stmt, TypeMember, TypeNode, TypeParam } from "./parser.ts";
import { bindings, literalOf, made, missing, objectFields, uncovered, type PatternInfo, type PatternTest, type Shape } from "./match.ts";
import { channel, collection, fields, COUNTED_UNLOCKED, counted, interior, shareable, tagStrings, type InScope } from "./resolve.ts";
import { infer } from "./generics.ts";
import { EMBEDDED, ITERATOR, MAP_METHODS, SET_METHODS, TypeMap, tupleElements, type ParamRecord, type FunctionRecord, type FutureType, type ParamType, type InteriorRecord, TypeSet, SLEEP, YIELD_NOW, integerInfo, isFloat, isInteger, isNumeric, redundantBang, bare as bareOf, type Bang, range, type DynType, type HandleType, type BlockType, type SharedType, INTERIORS, type InteriorType, type InterfaceType, type Method, type Typing, TYPED_ARRAYS, isTypedName, typedSize, type TypedName } from "./typing.ts";
import type { DynRecord, Access, ArrayType, FixedType, MapType, GeneratorType, LiteralType, PointerType, VariantType, Bound, Integer, Numeric, UnionType, ClassType, ClosureType, Field, FunctionType, ObjectType, RefType, RegexType, Type } from "./typing.ts";
import type { EnumInfo, EnumInstance } from "./enums.ts";
import { EXPRESSION_FORMS, IMPORT_META_MEMBERS, unsupported } from "./unsupported.ts";
import { isIteratorKey, knownKey, unknownKey } from "./keys.ts";
import { compile as compileRegex, parsePattern, RegexSyntaxError } from "./regex.ts";
import { JSON_VALUE_NAME, STD_BASE } from "./std.ts";
import { parseArgsArgs } from "./parseargs.ts";
import { holesOf, quoted, type Category } from "./quote.ts";
import { holdsNull } from "./defaults.ts";
import { bodyOf, type BodyId, type ClassId, type InstanceId, type LocalId } from "./arenas.ts";
import type { Instance, Local } from "./check.ts";
import { isEmpty, literalValue, typeofTest, type Facts, type Guard } from "./narrow.ts";
import { bothSides, comparable, holdsArgument, objectsMeet, instanceofCheck, intoMember, intoUnion, keyCheck, applyShape, literalShape, typeofComparison, unionComparison, unionField, type Union } from "./unions.ts";
import { forEachChild, nextId, NodeMap, NodeSet, reborrowNode, renumberExpr, respanExpr, someNode, walk, walkWhile, type AnyNode, type Ids, type Rewrites } from "./nodes.ts";
import { cloneExpr, cloneObjectProp, cloneParam, clonePattern, cloneTypeNode, idOfExpr, rebuiltExpr, withIdExpr } from "./rebuild.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;
type Elements = Extract<Expr, { kind: "array" }>["elements"];

const I64_MAX = (1n << 63n) - 1n;

// `String.raw`'s text: the parts as written, each value between two, as a template; a literal
// value is folded into the text, so a template of literals is a constant.
function rawTemplate(parts: Ref<string[]>, values: Ref<Expr[]>, at: Span): Expr {
  let quasis: string[] = [parts.length > 0 ? parts[0]! : ""];
  let exprs: Expr[] = [];
  for (let i = 0; i < values.length; i++) {
    const after = i + 1 < parts.length ? parts[i + 1]! : "";
    const text = literalText(values[i]!);
    if (text === undefined) {
      exprs.push(cloneExpr(values[i]!));
      quasis.push(after);
    } else {
      quasis[quasis.length - 1] += text + after;
    }
  }
  // Parts with no value between them, which only the call form gives, run together.
  quasis[quasis.length - 1] += parts.slice((values.length + 1) as i64).join("");
  const raw = quasis.slice();
  return { id: 0, kind: "template", quasis, raw, exprs, start: at.start, end: at.end };
}

// The text of a literal as a template would splice it in.
function literalText(x: Ref<Expr>): string | undefined {
  if (x.kind === "string") return x.value;
  if (x.kind === "bool") return String(x.value);
  if (x.kind === "int" && x.value <= I64_MAX) return x.value.toString();
  if (x.kind === "template" && x.exprs.length === 0) return x.quasis[0];
  return undefined;
}

const isConstAssertion = (e: Expr) => e.kind === "as" && e.type.kind === "ref" && e.type.name === "const" && e.type.args.length === 0;

// The operators an expression of only literals may use and still take its type from context.
const LITERAL_OPERATORS = new Set<string>(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"]);
const BITWISE_OPERATORS = new Set<string>(["&", "|", "^", "<<", ">>", ">>>"]);

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && (callee.name === "log" || callee.name === "error" || callee.name === "warn") &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

// Where a print writes: stdout, or stderr for `console.error` and `console.warn`.
export const printStream = (callee: Expr): 1 | 2 => (callee.kind === "member" && callee.name !== "log" ? 2 : 1);

// Whether a value of the type can hold a float anywhere inside it.
function holdsFloat(typing: Ref<Typing>, start: Type): boolean {
  let seen = new TypeSet<Type>();
  let stack: Type[] = [start];
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (typeof t === "string") {
      if (isFloat(t)) return true;
    } else if (!seen.has(t)) {
      heldTypes(typing, t, stack);
      seen.add(t);
    }
  }
  return false;
}

// What `holdsFloat` looks into from a type: what it holds, and its fields.
function heldTypes(typing: Ref<Typing>, t: Exclude<Type, string>, stack: Mut<Type[]>): void {
  const r = typing.rec(t);
  if (r.kind === "ref" || r.kind === "pointer") stack.push(r.to);
  else if (r.kind === "interior" || r.kind === "shared" || r.kind === "block" || r.kind === "dyn" || r.kind === "recursive") stack.push(r.of);
  else if (r.kind === "param" && r.concrete !== undefined) stack.push(r.concrete);
  else if (r.kind === "array" || r.kind === "fixed") stack.push(r.element);
  else if (r.kind === "map") {
    stack.push(r.key);
    stack.push(r.value);
  }
  else if (r.kind === "class" && r.base !== undefined) stack.push(r.base);
  else if (r.kind === "brand") stack.push(r.base);
  else if (r.kind === "union") for (const m of r.members) stack.push(m);
  for (const f of typing.fieldsOf(t)) stack.push(f.type);
}


// The name a place is read through: `a` for `a`, `a.b` and `a[i]`, and `this` for `this.x`.
function placeRoot(x: Ref<Expr>): string | undefined {
  if (x.kind === "ident") return x.name;
  if (x.kind === "this") return "this";
  if (x.kind === "member" || x.kind === "index") return placeRoot(x.object);
  return undefined;
}

// The type names of a generic function's scope with those a call binds, the call's winning.
function joinedScope(scope: Ref<Map<string, Type>>, bindings: Ref<Map<string, Type>>): Map<string, Type> {
  let out = new Map<string, Type>();
  for (const [k, v] of scope) out.set(k, v);
  for (const [k, v] of bindings) out.set(k, v);
  return out;
}

// Whether a place is a name or `this`, or fields read from one without `?.`.
function namedPlace(x: Ref<Expr>): boolean {
  if (x.kind === "member" && !x.optional) return namedPlace(x.object);
  return x.kind === "this" || x.kind === "ident";
}

// What expression checking needs from the program and the function it is in.
export interface Context {
  tables: Tables;
  decls: Ref<Declarations>;
  types: NodeMap<Expr, Type>;
  locals: NodeMap<Expr | Stmt | Param | ObjectProp, LocalId>;
  coercions: NodeMap<Expr, Type>;
  calls: NodeMap<Expr, InstanceId>;
  setters: NodeMap<Expr, InstanceId>;
  byName: Map<string, BodyId>;
  classes: Map<string, ClassId>;
  enums: Map<string, EnumInfo>;
  // A C-like enum's member, and its members' names, read once the enum is settled.
  /** @throws {CompileError} */
  enumMember(this: Mut<this>, name: string, member: string): LiteralType | undefined;
  /** @throws {CompileError} */
  enumMemberNames(this: Mut<this>, name: string): string[];
  // A data-carrying enum made with these type arguments.
  /** @throws {CompileError} */
  enumInstance(this: Mut<this>, name: string, args: Type[], at: Ref<Span>): EnumInstance;
  /** @throws {CompileError} */
  construct(this: Mut<this>, name: string, typeArgs: Ref<TypeNode[]>, argTypes: Type[], at: Ref<Span>): ClassId | undefined;
  // A generic class's constructor parameters as written.
  templateParams(name: string): Param[] | undefined;
  // A generic class as its definition is checked, whose statics every instance shares.
  definedClass(this: Mut<this>, name: string): ClassId | undefined;
  members(): Members;
  exprsState: ExpressionsState;
  /** @throws {CompileError} */
  returnOf(this: Mut<this>, instance: InstanceId, at: Ref<Span>): Type;
  // What a call returns as the calling body sees it: in terms of the calling instance's own
  // type parameters, where it passed them.
  /** @throws {CompileError} */
  resultOf(this: Mut<this>, instance: InstanceId, at: Ref<Span>): Type;
  // What a call's returned reference borrows from, and the record of it for each call.
  /** @throws {CompileError} */
  sourcesOf(this: Mut<this>, instance: InstanceId, args: Ref<Expr[]>, receiver: Ref<Expr> | undefined, at: Ref<Span>, lent: Ref<boolean[]>): Expr[];
  borrowsFrom: NodeMap<Expr, Expr[]>;
  /** @throws {CompileError} */
  classOf(this: Mut<this>, t: ClassType): ClassId;
  /** @throws {CompileError} */
  instanceOf(this: Mut<this>, f: BodyId, bindings: Map<string, Type> | undefined): InstanceId;
  /** @throws {CompileError} */
  instantiate(this: Mut<this>, f: BodyId, typeArgs: Ref<TypeNode[]>, args: Ref<Expr[]>, argTypes: Type[], at: Ref<Span>): InstanceId;
  /** @throws {CompileError} */
  paramTypes(this: Mut<this>, instance: InstanceId): Type[];
  // The binding a name refers to; `at`, the use, is where a closure first captures it.
  lookup(this: Mut<this>, name: string, at: Ref<Expr | ObjectProp> | undefined): LocalId | undefined;
  // The binding a name refers to, without capturing it, and this body's binding for a variable
  // of a body around it, captured if need be.
  peek(name: string): LocalId | undefined;
  reach(this: Mut<this>, l: LocalId, at: Ref<Expr | ObjectProp> | undefined): LocalId;
  // The names a use at `at` reaches, its bindings in scope then top-level values, for suggesting one.
  names(at: usize): string[];
  // The names of the classes, generic ones included, a use at `at` reaches.
  classNames(at: usize): string[];
  // Records the bindings a call of a nested function builds its environment from.
  envOf(this: Mut<this>, e: Ref<Expr>, of: InstanceId, env: LocalId[]): void;
  dynOf(this: Mut<this>, e: Ref<Expr>, table: DynTable): void;
  // Whether a binding is the one a sync nested function's declaration makes.
  nestedLocal(l: LocalId): boolean;
  // Whether this is a closure owning what it captures: async, or `move`.
  owning: boolean;
  // Notes a closure's use of `this`, which it captures.
  noteThis(this: Mut<this>, e: Ref<Expr>): void;
  self: Body["self"];
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  // A derived constructor's `super(...)`, the one place a base constructor may be called.
  superCall: Expr | undefined;
  // A nested function calling itself by name, typed by its own signature.
  /** @throws {CompileError} */
  selfCall(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } | undefined;
  // Whether this `this` may be used: a constructor's can't until every field is assigned.
  thisReady(this: Mut<this>, e: Ref<Expr>): boolean;
  // Narrowing: what a condition proves, checking under what was proven, and a variable's
  // type where something narrowed it.
  /** @throws {CompileError} */
  proves(this: Mut<this>, e: Ref<Expr>): Guard;
  // Checks under facts proven, until `forgetFacts` is called.
  assumeFacts(this: Mut<this>, proven: Facts): void;
  forgetFacts(this: Mut<this>): void;
  // Runs a match arm in a scope of its own, holding the names its pattern binds.
  enterArm(this: Mut<this>): void;
  leaveArm(this: Mut<this>): void;
  // Checks a match arm's block, whose `return`s give the arm its value: each value and its type.
  /** @throws {CompileError} */
  block(this: Mut<this>, arm: Ref<Extract<Stmt, { kind: "block" }>>, wanted: boolean): [Expr, Type][];
  // What each match pattern tests, for codegen.
  patterns: NodeMap<Pattern, PatternInfo>;
  copiesOut: NodeSet<Expr>;
  // Declares a name a pattern binds, read-only, in the arm's scope.
  /** @throws {CompileError} */
  bind(this: Mut<this>, name: string, type: Type, node: Ref<Expr>): LocalId;
  narrowed(this: Mut<this>, l: LocalId): Type | undefined;
  forget(this: Mut<this>, l: LocalId, at: Ref<Span>): void;
  /** @throws {CompileError} */
  lendsWhole(this: Mut<this>, l: LocalId, at: Ref<Expr>): void;
  // Notes a read of a variable as narrowed.
  narrowRead(this: Mut<this>, l: LocalId, at: Ref<Expr>): void;
  // A field's type where a check narrowed its path, noting the read; and a change at a path
  // inside a binding or `this`, which forgets what was known below it.
  narrowedField(this: Mut<this>, e: Ref<Expr>): Type | undefined;
  // Whether a check proved an interface's optional method there on a value.
  present(this: Mut<this>, object: Ref<Expr>, name: string): boolean;
  /** @throws {CompileError} */
  changesPath(this: Mut<this>, root: LocalId | "this", path: string, action: string, at: Ref<Expr>): void;
  // The instance being checked.
  instance: Instance;
  // False for a binding declared in another case of a switch, which entering this case skips.
  reachable(l: LocalId): boolean;
  // Records an error a call raises, and what the instance called may throw.
  /** @throws {CompileError} */
  raise(this: Mut<this>, at: Ref<Expr>, type: Type, what: string): void;
  // Checks comptime code, which may throw any error: one it doesn't catch is a compile error.
  enterComptime(this: Mut<this>): void;
  leaveComptime(this: Mut<this>): void;
  // Checks what a `throw` raises.
  /** @throws {CompileError} */
  thrown(this: Mut<this>, at: Ref<Expr>, value: Ref<Expr>): void;
  /** @throws {CompileError} */
  errorOf(this: Mut<this>, instance: InstanceId): Type | undefined;
  // What the body's function declares it throws.
  throwsDeclared(): Type | undefined;
  // Checks the body as written first, when this is an instance of a generic one, so what that
  // check decides holds for every instance.
  /** @throws {CompileError} */
  asWritten(this: Mut<this>): void;
  // Whether the body is a sync `main` run as an async one, as a program setting timers does.
  syncMain: boolean;
  // Whether a binding stands for a variable a closure captures, and whether this is a closure;
  // and a change to a capture, `this` when undefined, which makes it mutable.
  captured(l: LocalId): boolean;
  closing: boolean;
  // The body's parameters it changes.
  changedParams: Set<LocalId>;
  // Whether the body is a generator's.
  generator: boolean;
  // Whether the program runs on the async runtime: its `main` is async.
  runtime: boolean;
  // The method holding a lock while the body runs as its callback, and whether that lock is a
  // shared value's.
  locked: string | undefined;
  sharing: boolean;
  // Whether that value is an Rc's, which only this thread reaches.
  counting: boolean;
  // Whether the body is an async function's, and the awaits written where it can stop at them.
  async: boolean;
  awaitable: NodeSet<Expr>;
  // The yields whose value is used where the generator can stop at them, and checking one.
  yieldable: NodeSet<Expr>;
  /** @throws {CompileError} */
  yielding(this: Mut<this>, e: Ref<Extract<Expr, { kind: "yield" }>>): Type;
  // Whether the body is a closure written inside `unsafe`.
  unsafe: boolean;
  /** @throws {CompileError} */
  changesCapture(this: Mut<this>, l: LocalId | undefined, path: string, action: string, target: Ref<Expr>, throughMut: boolean): void;
  // Records a whole write through a narrowed mutable reference that may change its member.
  /** @throws {CompileError} */
  rewritten(this: Mut<this>, l: LocalId, at: Ref<Expr>): void;
  // How deeply nested the scope declaring a binding is.
  depthOf(l: LocalId): usize;
  // A written type, as this body sees it.
  /** @throws {CompileError} */
  resolveType(this: Mut<this>, t: Ref<TypeNode>): Type;
  // An arrow function's type, its body checked; and the instance a closure type runs.
  // A closure written inside `unsafe` is checked inside it too.
  /** @throws {CompileError} */
  closure(this: Mut<this>, e: Ref<Extract<Expr, { kind: "arrow" }>>, expected: FunctionType | undefined, unsafe: boolean | undefined, owning: boolean | undefined): ClosureType;
  // Makes a generic arrow written as a value a generic function of its own, the arrow its name.
  /** @throws {CompileError} */
  liftArrow(this: Mut<this>, e: Ref<Extract<Expr, { kind: "arrow" }>>): Expr;
  // A type node resolved with type parameters bound, as a generic function type's for a call.
  /** @throws {CompileError} */
  resolveWith(this: Mut<this>, t: Ref<TypeNode>, scope: Map<string, Type>): Type;
  closureBody(this: Mut<this>, t: ClosureType): InstanceId;
  // The bounds of a body's implicit type parameters, by parameter index.
  /** @throws {CompileError} */
  implicitOf(this: Mut<this>, f: BodyId): Map<usize, Bound>;
  // The type an arrow argument of a generic body is checked against, once the others are known.
  /** @throws {CompileError} */
  callbackType(this: Mut<this>, f: BodyId, typeArgs: Ref<TypeNode[]>, argTypes: (Type | undefined)[], i: usize, at: Ref<Span>): FunctionType | undefined;
  // Rejects a constructor call lending a value mutably as a type parameter that would let its
  // read-only fields be written.
  /** @throws {CompileError} */
  constructs(this: Mut<this>, f: BodyId, args: Ref<Expr[]>, argTypes: Type[]): void;
  // Whether a variable whose type is still open takes `to`, for a use needing it.
  infer(this: Mut<this>, e: Ref<Expr>, to: Type): boolean;
}

// The ways several Promises are awaited at once.
type Combiner = "all" | "race" | "allSettled" | "any";
const COMBINERS: string[] = ["all", "race", "allSettled", "any"];
// The timer globals, Node's and the browser's.
const TIMER_CALLS = new Set(["setTimeout", "setInterval", "clearTimeout", "clearInterval"]);

// What a literal format does with the arguments after it, as the runtime's routine reads it:
// the specifier each one it takes is given to, and where those left, appended, start.
export function formatPlan(format: string, count: usize): { specs: string[]; rest: usize } {
  let specs: string[] = [];
  let taken: usize = 0;
  let last: usize = 0;
  for (let i: usize = 0; i + 1 < format.length; i++) {
    if (format[i] !== "%") continue;
    const next = format[++i]!;
    if (next === "%") {
      last = i + 1;
      continue;
    }
    if (taken + 1 === count || !"sdifoOcj".includes(next)) continue;
    specs.push(next);
    taken++;
    last = i + 1;
  }
  return { specs, rest: last === 0 ? 0 : taken + 1 };
}
// The string methods that may take a regex, and the calls that did, by method.
const REGEX_METHODS = new Set(["replace", "replaceAll", "split", "match", "matchAll", "search"]);

// What a string method given a regex gives, from the regex: one whose captures aren't known may
// have one that takes no part. Each instance of a generic body works it out from its own regex.
export function regexStringType(typing: Mut<Typing>, name: string, rx: RegexType, unknown: boolean): Type {
  if (name === "search") return "i64";
  if (name === "match") {
    const each: Type = typing.rec(rx).flags.includes("g") ? typing.arrayType("string") : typing.matchType(rx);
    return typing.unionType([each, "null"]);
  }
  if (name === "matchAll") {
    const each = typing.matchType(rx);
    return typing.arrayType(each);
  }
  if (name === "split") {
    const each: Type = typing.rec(rx).captures.some((c) => c.optional) || unknown ? typing.unionType(["string", "null"]) : "string";
    return typing.arrayType(each);
  }
  return "string";
}
// A regex's flag properties, by the flag each reads.
export const REGEX_FLAGS: Record<string, string> = { hasIndices: "d", global: "g", ignoreCase: "i", multiline: "m", dotAll: "s", unicode: "u", unicodeSets: "v", sticky: "y" };
// The integer methods named for how they overflow, as Rust's are: `checkedAdd`, `wrappingShl`,
// `saturatingPow`, `overflowingMul` and the rest, by family then operation.
const INTEGER_METHODS: Record<string, string[]> = {
  checked: ["Add", "Sub", "Mul", "Div", "Rem", "Neg", "Shl", "Shr", "Pow"],
  wrapping: ["Add", "Sub", "Mul", "Div", "Rem", "Neg", "Shl", "Shr", "Pow"],
  saturating: ["Add", "Sub", "Mul", "Div", "Neg", "Pow"],
  overflowing: ["Add", "Sub", "Mul"],
};
// A method name as its family and operation, when it is one of them.
export function integerMethod(name: string): [string, string] | undefined {
  for (const family of Object.keys(INTEGER_METHODS)) {
    if (!name.startsWith(family)) continue;
    const operation = name.slice(family.length as i64);
    return INTEGER_METHODS[family]!.includes(operation) ? [family, operation] : undefined;
  }
  return undefined;
}
// `Math`'s functions on f64, by how many numbers each takes.
export const MATH_FLOAT: Record<string, usize> = {
  floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, cbrt: 1, exp: 1, expm1: 1, log: 1, log1p: 1, log2: 1, log10: 1,
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1, asinh: 1, acosh: 1, atanh: 1,
  pow: 2, atan2: 2, hypot: 2,
};
export const MATH_CONSTANTS: Record<string, f64> = {
  PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
};


// How a rest tuple's element or its array reads in a message, as written: `t[2]` and `t[1...]`,
// the tuple read printed before `restSuffix`. Callers test `e` with the same two conditions,
// `t.rest[0]` reading its base `t` from `e.object.object` and `t.rest` from `e.object`.
export function restSuffix(restStarts: Ref<Tables["restStarts"]>, e: Ref<Expr>): string {
  if (e.kind === "index" && e.index.kind === "int") return `[${BigInt(restStarts.get(e.object)!) + e.index.value}]`;
  return `[${restStarts.get(e)!}...]`;
}

// What a type's Dyn runs: each method's instance, each field's getter (none for a field), and
// what '.clone()' runs: the class's own `clone`, the compiler's copy, or nothing when the type
// can't be cloned.
export type DynTable = { methods: (InstanceId | undefined)[]; fields: (InstanceId | undefined)[]; clone: InstanceId | "copy" | undefined };

// A class's static property, `C.x`: a `static readonly` field, the const `C.x`, or a static
// accessor, the static methods `get x` and `set x`. Reads and writes of one are rewritten in
// place into a read of that const or a call of those methods, forms the rest of the compiler knows.
type Static = { field?: FieldDecl; declaring: ClassInfo; getter?: Body; setter?: Body };

// What checking a body's expressions keeps between uses of its expression checker.
export class ExpressionsState {
  // The function type each arrow is given to, which types the parameters it leaves unwritten.
  expecting = new NodeMap<Expr, FunctionType>();
  // The type each generic enum's member is expected to have, by the member expression.
  wanted = new NodeMap<Expr, Type>();
  // The T a `new Promise` or `Promise.resolve` is awaited where a T is wanted for.
  awaitedAs = new NodeMap<Expr, Type>();
  // The pairs of JS shapes being compared, each taken to fit while it is.
  comparing = new TypeMap<Type, TypeSet<Type>>();
  // Arrows checked to own what they capture, being stored.
  owning = new NodeSet<Expr>();
  // Array literals written where a tuple is expected, which are that tuple, and those passed where
  // a generic function takes a tuple, which are a tuple of their own elements' types.
  tuples = new NodeMap<Expr, ObjectType>();
  shaped = new NodeSet<Expr>();
  // Those passed where the tuple has optional or rest elements take its shape, by its type node.
  shapedBy = new NodeMap<Expr, Extract<TypeNode, { kind: "tuple" }>>();
  fixedLiterals = new NodeMap<Expr, FixedType>();
  // The place an assignment is checking as its target, while it does.
  writing: usize | undefined = undefined;
  // That place, when the write reads it first, as `+=` and `++` do, keeping its member.
  updating: usize | undefined = undefined;
  // The assignment an expression statement is, whose value nothing uses.
  statementAssign: usize | undefined = undefined;
  // Objects of index expressions already checked, which their next read takes as checked.
  once = new NodeSet<Expr>();
  // A typed array's `subarray` calls, each by the place it copies, which a write can't reach.
  subarrays = new NodeMap<Expr, string>();
  // Variables read as declared, whatever a check or assignment narrowed them to.
  asDeclared = new NodeSet<Expr>();
  // Names used as the object of a field read, an index or a method call.
  objects = new NodeSet<Expr>();
  oversized: Extract<Expr, { kind: "int" }>[] = [];
  // How many \`unsafe\` blocks enclose the code being checked.
  unsafeDepth: usize;
  // Literals found to fit the type they were given, `-9223372036854775808` among them.
  fitted = new NodeSet<Expr>();
  // Powers of literals whose exponent no u32 holds, unless they became floats.
  powers: [Expr, Expr][] = [];

  constructor(unsafe: boolean) {
    this.unsafeDepth = unsafe ? 1 : 0;
  }
}

export class Expressions<C extends Context> implements Union<C> {
  ctx: Mut<C>;

  constructor(ctx: Mut<C>) {
    this.ctx = ctx;
  }
  private recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.ctx.tables.typing.rec(t as Exclude<T, string>);
  }
  private isRefType(t: Type): t is RefType {
    return this.recOf(t)?.kind === "ref";
  }
  private isArray(t: Type): t is ArrayType {
    return this.recOf(t)?.kind === "array";
  }
  private isFixed(t: Type): t is FixedType {
    return this.recOf(t)?.kind === "fixed";
  }
  private printable(t: Type): boolean {
    const r = this.recOf(t);
    return r === undefined || r.kind === "literal" || r.kind === "pattern" || (r.kind === "union" && r.members.every((m) => this.printable(m)));
  }
  // The function type a type parameter is bounded by, if it is.
  private boundFunction(t: Type) {
    const r = this.recOf(t);
    const bound = r?.kind === "param" ? r.bound : undefined;
    return this.recOf(bound)?.kind === "function" ? (bound as FunctionType) : undefined;
  }
  // A type parameter no instance has given a type yet, as a generic body's definition holds.
  private placeholder(t: Type) {
    const r = this.recOf(t);
    return r?.kind === "param" && r.concrete === undefined;
  }
  private isCallable(t: Type) {
    const r = this.recOf(t);
    return r?.kind === "dyn" && this.ctx.tables.typing.callableOf.has(r.of);
  }
  // Whether a value holds a future, which an array element or a sort's order can't be.
  private holdsFuture(t: Type): boolean {
    return typeof t !== "string" && (this.ctx.tables.typing.rec(t).kind === "future" || this.ctx.tables.typing.promiseElement(t) !== undefined);
  }
  private localAt(n: Expr | Stmt | Param | ObjectProp) {
    return this.ctx.tables.arenas.localOf(this.ctx.locals.get(n));
  }
  // An expression as checking has it so far, its redundant `!`s taken off.
  private bare(e: Ref<Expr>): Expr {
    const now = this.ctx.tables.rewrites.rewritten(e);
    return this.bareOwned(now !== undefined ? now : cloneExpr(e));
  }
  private bareOwned(now: Expr): Expr {
    const id = now.id;
    const off = bareOf(now);
    return off.id === id ? off : this.bare(off);
  }
  // An expression's value checked under what a condition proved: its value, or as an operand.
  /** @throws {CompileError} */
  private valueAssuming(this: Mut<this>, proven: Facts, e: Ref<Expr>, operand: boolean): Type {
    this.ctx.assumeFacts(proven);
    try {
      return operand ? this.operand(e) : this.value(e);
    } finally {
      this.ctx.forgetFacts();
    }
  }
  // What a value is, through a reference to it, lowered.
  private heldBy(this: Mut<this>, t: Type | undefined): Type | undefined {
    if (t === undefined) return undefined;
    const to = this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t;
    return this.ctx.tables.typing.lower(to);
  }
  // The body a class or a base it embeds declares under `name` in one of its tables.
  /** @throws {CompileError} */
  private inheritedOf(this: Mut<this>, t: ClassType, table: "methods" | "statics" | "getters" | "setters", name: string): Ref<Body> | undefined {
    const id = this.ctx.classOf(t);
    return inherited(this.ctx.tables.arenas, this.ctx.tables.arenas.classOf(id), table, name);
  }
  private inst(id: InstanceId): Ref<Instance> {
    return this.ctx.tables.arenas.instanceOf(id);
  }
  // Which of a call's arguments each lends to it.
  private lent(this: Mut<this>, args: Ref<Expr[]>): boolean[] {
    let out: boolean[] = [];
    for (const a of args) out.push(this.lends(a));
    return out;
  }
  // The generic function a local stands for, when it is one lifted from a body.
  private localGeneric(this: Mut<this>, name: string): Ref<Body> | undefined {
    const local = this.ctx.lookup(name, undefined);
    if (local === undefined) return undefined;
    const generic = this.lc(local).generic;
    return generic === undefined ? undefined : this.ctx.tables.arenas.bodyOf(generic);
  }
  private lc(id: LocalId): Ref<Local> {
    return this.ctx.tables.arenas.localOf(id);
  }
  // A class's record, made first if it hasn't been.
  /** @throws {CompileError} */
  private cls(this: Mut<this>, t: ClassType): Ref<ClassInfo> {
    const id = this.ctx.classOf(t);
    return this.ctx.tables.arenas.classOf(id);
  }
  private bodyNamed(name: string) {
    return this.ctx.tables.arenas.bodyOf(this.ctx.byName.get(name));
  }

  // Runs a check inside \`unsafe\`, where raw pointers can be used.
  /** @throws {CompileError} */
  unsafely<T>(this: Mut<this>, check: InScope<T>): T {
    this.ctx.exprsState.unsafeDepth++;
    try {
      return check();
    } finally {
      this.ctx.exprsState.unsafeDepth--;
    }
  }

  // Refuses an operation outside \`unsafe\`.
  /** @throws {CompileError} */
  private needsUnsafe(what: string, at: Ref<Span>, why = "the compiler can't check what a raw pointer points to") {
    if (this.ctx.exprsState.unsafeDepth === 0) throw new CompileError("E1001", `${what} can only happen inside 'unsafe { }': ${why}, so you vouch for it there`, at.start, at.end);
  }

  // Literals too large for an i64 that nothing gave a wider type.
  /** @throws {CompileError} */
  finish() {
    for (const [power, exponent] of this.ctx.exprsState.powers) {
      if (isInteger(this.ctx.types.get(power)!)) throw new CompileError("E0110", "the exponent of '**' on an integer is a 'u32', which can't hold this; write the power as a float, like '2.0 ** -1'", exponent.start, exponent.end);
    }
    for (const e of this.ctx.exprsState.oversized) {
      if (this.ctx.types.get(e) === "i64" && !this.ctx.exprsState.fitted.has(e)) throw new CompileError("E0110", "integer literal does not fit in i64", e.start, e.end);
    }
  }

  // An expression of only number literals and operators takes the number type it meets where
  // it is written, as `1` does in `let a: u8 = 1` or `a + 1`.
  // A float literal only becomes a float type.
  /** @throws {CompileError} */
  adapt(this: Mut<this>, given: Ref<Expr>, to: Type): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.adaptNow(now, to) : this.adaptNow(given, to);
  }
  /** @throws {CompileError} */
  private adaptNow(this: Mut<this>, e: Ref<Expr>, to: Type): boolean {
    // A loose brand takes its base's literals, which fit it.
    const brand = this.recOf(to);
    if (brand?.kind === "brand" && brand.loose === true) to = brand.base;
    if (!isNumeric(to)) return false;
    if (e.kind === "unsafe" || e.kind === "comptime") {
      if (!this.adapt(e.expr, to)) return false;
      this.ctx.types.set(cloneExpr(e), to);
      return true;
    }
    // A `?:` or match whose every branch is a number literal gives the number type it meets.
    if (e.kind === "conditional") {
      const floats = isFloat(to);
      const then = this.ctx.types.has(e.then);
      const otherwise = this.ctx.types.has(e.else);
      if ((then && !this.literalOnly(e.then, floats)) || (otherwise && !this.literalOnly(e.else, floats))) return false;
      if (then) this.retype(e.then, to, false);
      if (otherwise) this.retype(e.else, to, false);
      this.ctx.types.set(cloneExpr(e), to);
      return true;
    }
    if (e.kind === "match") {
      const floats = isFloat(to);
      for (const a of e.arms) if (!this.literalArm(a, floats)) return false;
      for (const a of e.arms) this.retypeArm(a, to);
      this.ctx.types.set(cloneExpr(e), to);
      return true;
    }
    if (!this.literalOnly(e, isFloat(to))) return this.ctx.infer(e, to);
    this.retype(e, to, false);
    return true;
  }

  literalOnly(given: Ref<Expr>, floats: boolean): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.literalOnlyNow(now, floats) : this.literalOnlyNow(given, floats);
  }
  private literalOnlyNow(e: Ref<Expr>, floats: boolean): boolean {
    if (e.kind === "unsafe" || e.kind === "comptime") return this.literalOnly(e.expr, floats);
    if (e.kind === "int" || (e.kind === "float" && floats)) return true;
    if (e.kind === "unary") return (e.op === "-" || (e.op === "~" && !floats)) && this.literalOnly(e.operand, floats);
    return e.kind === "binary" && LITERAL_OPERATORS.has(e.op) && (!floats || !BITWISE_OPERATORS.has(e.op)) && this.literalOnly(e.left, floats) && this.literalOnly(e.right, floats);
  }

  // A match arm's body as `adapt` reads it: a block is never only literals.
  private literalArm(arm: Ref<MatchArm>, floats: boolean): boolean {
    return arm.body.kind !== "block" && this.literalOnly(arm.body, floats);
  }
  /** @throws {CompileError} */
  private retypeArm(this: Mut<this>, arm: Ref<MatchArm>, to: Numeric): void {
    if (arm.body.kind !== "block") this.retype(arm.body, to, false);
  }

  /** @throws {CompileError} */
  private retype(this: Mut<this>, given: Ref<Expr>, to: Numeric, negated: boolean): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.retypeNow(now, to, negated);
    else this.retypeNow(given, to, negated);
  }
  /** @throws {CompileError} */
  private retypeNow(this: Mut<this>, e: Ref<Expr>, to: Numeric, negated: boolean): void {
    this.ctx.types.set(cloneExpr(e), to);
    if (e.kind === "unary") {
      if (e.op === "-" && isInteger(to) && !integerInfo(to).signed) {
        throw new CompileError("E0110", `'${this.ctx.tables.typing.show(to)}' is unsigned, so it can't be negative; use a signed type like 'i64'`, e.start, e.end);
      }
      this.retype(e.operand, to, e.op === "-" && !negated);
      return;
    }
    if (e.kind === "binary") {
      this.retype(e.left, to, false);
      // An integer's exponent stays a `u32`.
      this.retype(e.right, e.op === "**" && isInteger(to) ? "u32" : to, false);
      return;
    }
    if (e.kind !== "int" || !isInteger(to)) return;
    const [min, max] = range(to);
    const value = negated ? -e.value : e.value;
    if (value < min || value > max) {
      throw new CompileError("E0110", `'${negated ? "-" : ""}${e.value}' doesn't fit in '${this.ctx.tables.typing.show(to)}', which holds ${min} to ${max}`, e.start, e.end);
    }
    this.ctx.exprsState.fitted.add(cloneExpr(e));
  }

  // What a closure or a generic enum's member is expected to be, from where it goes, since
  // neither can always tell its own type: a closure its parameters', an enum its type arguments.
  /** @throws {CompileError} */
  expect(this: Mut<this>, given: Ref<Expr>, t: Type): void {
    // Callers pass what a parameter list has, which may run out.
    if ((t as Type | undefined) === undefined) return;
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.expectKeyed(now, t);
    else this.expectKeyed(given, t);
  }

  // An object literal's computed keys are known first.
  /** @throws {CompileError} */
  private expectKeyed(this: Mut<this>, e: Ref<Expr>, t: Type): void {
    if (e.kind === "object" && this.computesKeys(e)) {
      const keyed = this.keyed(e);
      this.expectNow(keyed, t);
    } else this.expectNow(e, t);
  }

  /** @throws {CompileError} */
  private expectNow(this: Mut<this>, e: Ref<Expr>, given: Type): void {
    let t = this.ctx.tables.typing.unfolded(given);
    // A literal lent to a reference is a temporary of the type it refers to.
    if ((e.kind === "object" || e.kind === "array") && this.isRefType(t)) t = this.ctx.tables.typing.unfolded(this.ctx.tables.typing.rec(t).to);
    if (e.kind === "object") {
      const dict = this.dictOf(t);
      if (dict !== undefined) return this.dictLiteral(e, dict);
      // An optional field's dictionary, too.
      const optional = this.optionalDict(t);
      if (optional !== undefined) return this.dictLiteral(e, optional);
    }
    // A generic function value meeting a function type that isn't generic is the one instance
    // that type gives it: an arrow calling it, its parameters typed from there.
    const r = this.recOf(t);
    let instance = r?.kind === "function" && r.generic === undefined;
    if (r?.kind === "dyn" && this.isCallable(t)) {
      const callable = this.recOf(this.ctx.tables.typing.callableOf.get(r.of));
      instance = callable === undefined || callable.generic === undefined;
    }
    const made = instance ? this.instanceArrow(e) : undefined;
    if (made !== undefined) this.expectMade(made, t);
    else this.expectMade(e, t);
  }

  /** @throws {CompileError} */
  private expectMade(this: Mut<this>, e: Ref<Expr>, given: Type): void {
    let t = given;
    const r = this.recOf(t);
    if (e.kind === "arrow" && r?.kind === "function") this.ctx.exprsState.expecting.set(cloneExpr(e), t as FunctionType);
    // An object literal meeting a JS shape, or an Option of one, takes the types of its fields.
    if (e.kind === "object") {
      let shapes: (InterfaceType | ObjectType)[] = [];
      if (r?.kind === "union") {
        for (const m of r.members) {
          const shape = this.ctx.tables.typing.jsShape(m);
          if (shape !== undefined) shapes.push(shape);
        }
      } else {
        const shape = this.ctx.tables.typing.jsShape(t);
        if (shape !== undefined) shapes.push(shape);
      }
      if (shapes.length === 1) {
        for (const p of e.props) {
          if (p.kind !== "property") continue;
          const declared = this.ctx.tables.typing.rec(shapes[0]!).fields.find((f) => f.name === keyText(p.key));
          if (declared !== undefined) this.expect(p.value, declared.type);
        }
      }
    }
    // A `new Promise`, `Promise.resolve` or `Promise.reject` meeting a `Promise<T>`, or awaited
    // where a T is wanted, takes its T from there.
    if (makesPromise(e) && this.promiseMet(t) !== undefined) this.ctx.exprsState.wanted.set(cloneExpr(e), t);
    if (e.kind === "unary" && e.op === "await" && makesPromise(e.operand)) this.ctx.exprsState.awaitedAs.set(cloneExpr(e.operand), t);
    // An arrow for a union holding one callable, like an optional callback, is stored as that
    // callable.
    if (e.kind === "arrow" && r?.kind === "union") {
      let callables: Type[] = [];
      for (const m of r.members) if (this.isCallable(m)) callables.push(m);
      if (callables.length === 1) t = callables[0]!;
    }
    // A value written where a Dyn is wanted, as an object literal's field, is boxed into it there.
    const box = this.boxedIn(t);
    if (e.kind !== "arrow" && box !== undefined) this.ctx.exprsState.wanted.set(cloneExpr(e), box);
    // An arrow written where a callable is stored captures by move: the callable owns it all.
    const stored = this.recOf(t);
    if (e.kind === "arrow" && stored?.kind === "dyn" && this.ctx.tables.typing.callableOf.has(stored.of)) {
      this.ctx.exprsState.expecting.set(cloneExpr(e), this.ctx.tables.typing.callableOf.get(stored.of)!);
      this.ctx.exprsState.owning.add(cloneExpr(e));
      this.ctx.exprsState.wanted.set(cloneExpr(e), t);
    }
    // An array literal where a union is expected is expected to be its one array, tuple or fixed
    // array member of a length the literal could have.
    const union = this.recOf(t);
    if (e.kind === "array" && union?.kind === "union") {
      let fitting: Type[] = [];
      for (const m of union.members) if (this.couldHold(m, e)) fitting.push(m);
      if (fitting.length === 1) t = fitting[0]!;
    }
    // An array literal's elements are expected to be its element type, and an object literal's
    // properties their fields'.
    if (e.kind === "array" && this.isArray(t)) {
      const element = this.ctx.tables.typing.rec(t as ArrayType).element;
      this.ctx.exprsState.wanted.set(cloneExpr(e), element);
      for (const x of e.elements) {
        if (x === undefined) continue;
        if (x.kind === "spread") this.expect(x.value, t);
        else this.expect(x, element);
      }
    }
    // A literal where a fixed array is expected is that fixed array; an Option or union holding
    // one fixed array expects that one.
    const holdingFixed = this.recOf(t);
    if ((e.kind === "array" || e.kind === "call") && holdingFixed?.kind === "union") {
      let fixed: Type[] = [];
      for (const m of holdingFixed.members) if (this.isFixed(m)) fixed.push(m);
      if (fixed.length === 1) t = fixed[0]!;
    }
    if (e.kind === "array" && this.isFixed(t)) {
      this.ctx.exprsState.fixedLiterals.set(cloneExpr(e), t as FixedType);
      const element = this.ctx.tables.typing.rec(t as FixedType).element;
      for (const x of e.elements) if (x !== undefined) this.expect(x, element);
    }
    if (e.kind === "call" && this.isFixed(t)) this.ctx.exprsState.wanted.set(cloneExpr(e), t);
    // A literal where a tuple is expected is that tuple, each element expected to be its own; an
    // Option or union holding one tuple expects that tuple.
    const tupled = e.kind === "array" || this.ctx.tables.tupleLiterals.has(e);
    const holdingTuple = this.recOf(t);
    if (tupled && holdingTuple?.kind === "union") {
      let tuples: Type[] = [];
      for (const m of holdingTuple.members) if (this.ctx.tables.typing.isTuple(m)) tuples.push(m);
      if (tuples.length === 1) t = tuples[0]!;
    }
    if (tupled && this.ctx.tables.typing.isTuple(t)) {
      this.ctx.exprsState.tuples.set(cloneExpr(e), t as ObjectType);
      const elements = this.ctx.tables.typing.elementsOf(t as ObjectType);
      this.expectParts(e, elements);
    }
    if (e.kind === "conditional") {
      this.expect(e.then, t);
      this.expect(e.else, t);
    }
    if (e.kind === "unsafe") this.expect(e.expr, t);
    if (e.kind === "match") for (const arm of e.arms) this.expectArm(arm, t);
    if (e.kind === "pipe") this.expect(e.body, t);
    // An object literal where a union is expected is expected to be the member it names: the one
    // with all its names whose literal fields its literals match.
    if (e.kind === "object") {
      const named = this.memberNamed(e, t);
      if (named !== undefined) t = named;
      if (typeof t !== "string" && (this.ctx.tables.typing.rec(t).kind === "object" || this.ctx.tables.typing.rec(t).kind === "class")) {
        for (const p of e.props) {
          if (p.kind !== "property" || typeof p.key !== "string") continue;
          const f = this.ctx.tables.typing.field(t, p.key);
          if (f !== undefined) this.expect(p.value, f.type);
        }
      }
    }
    const held = this.recOf(t)?.kind;
    if (e.kind === "new" && (held === "interior" || held === "block" || held === "map" || held === "shared")) this.ctx.exprsState.wanted.set(cloneExpr(e), t);
    if (e.kind === "call" && e.callee.kind === "ident" && e.callee.name === "shared" && held === "shared") this.ctx.exprsState.wanted.set(cloneExpr(e), t);
    if (e.kind === "call") this.expectEnumBuilt(e.callee, t);
    else this.expectEnumBuilt(e, t);
  }

  // A data-carrying enum's member, written or called, takes its type arguments from `t`.
  private expectEnumBuilt(this: Mut<this>, built: Ref<Expr>, t: Type): void {
    if (built.kind !== "member" || built.object.kind !== "ident" || this.ctx.lookup(built.object.name, undefined) !== undefined) return;
    const named = this.ctx.enums.get(built.object.name);
    if (named !== undefined && named.data !== undefined) this.ctx.exprsState.wanted.set(cloneExpr(built), t);
  }

  // The elements of a tuple literal, written as an array or an object, each expected to be its own.
  /** @throws {CompileError} */
  private expectParts(this: Mut<this>, given: Ref<Expr>, elements: Ref<Type[]>): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.expectPartsNow(now, elements);
    else this.expectPartsNow(given, elements);
  }
  /** @throws {CompileError} */
  private expectPartsNow(this: Mut<this>, e: Ref<Expr>, elements: Ref<Type[]>): void {
    if (e.kind === "array") {
      let i: usize = 0;
      for (const x of e.elements) {
        if (x !== undefined && i < elements.length) this.expect(x, elements[i]!);
        i++;
      }
    } else if (e.kind === "object") {
      let i: usize = 0;
      for (const p of e.props) {
        if (p.kind === "property" && i < elements.length) this.expect(p.value, elements[i]!);
        i++;
      }
    }
  }

  // Each value a match arm gives is expected to be `t`: its body, or each `return` in its block,
  // leaving out those of the functions and arrows inside it.
  /** @throws {CompileError} */
  private expectArm(this: Mut<this>, arm: Ref<MatchArm>, t: Type): void {
    if (arm.body.kind === "block") this.expectReturns(arm.body.body, t);
    else this.expect(arm.body, t);
  }
  /** @throws {CompileError} */
  private expectReturns(this: Mut<this>, list: Ref<Stmt[]>, t: Type): void {
    for (const s of list) this.expectReturn(s, t);
  }
  /** @throws {CompileError} */
  private expectReturn(this: Mut<this>, s: Ref<Stmt>, t: Type): void {
    switch (s.kind) {
      case "return":
        if (s.value !== undefined) this.expect(s.value, t);
        return;
      case "if":
        this.expectReturns(s.then, t);
        if (s.else !== undefined) this.expectReturns(s.else, t);
        return;
      case "while":
      case "doWhile":
      case "forIn":
      case "forOf":
      case "block":
      case "comptime":
      case "unsafe":
        this.expectReturns(s.body, t);
        return;
      case "for":
        this.expectReturns(s.body, t);
        return;
      case "labeled":
        this.expectReturn(s.body, t);
        return;
      case "try":
        this.expectReturns(s.block, t);
        if (s.handler !== undefined) this.expectReturns(s.handler, t);
        if (s.finalizer !== undefined) this.expectReturns(s.finalizer, t);
        return;
      case "switch":
        for (const c of s.cases) this.expectReturns(c.body, t);
        return;
      default:
        return;
    }
  }

  // The member of a union an object literal names: the one with all its names whose literal
  // fields its literals match.
  private memberNamed(e: Ref<Extract<Expr, { kind: "object" }>>, t: Type): ObjectType | undefined {
    const union = this.recOf(t);
    if (union?.kind !== "union") return undefined;
    let matching: ObjectType[] = [];
    for (const member of union.members) {
      const m = this.ctx.tables.typing.unfold(member);
      if (this.recOf(m)?.kind === "object" && this.namesMember(e, m as ObjectType)) matching.push(m as ObjectType);
    }
    return matching.length === 1 ? matching[0] : undefined;
  }

  // Whether an object literal's string-keyed properties are all fields of `m`, each literal field
  // matching: a field of one literal, or of a union of literals as `kind: "as" | "satisfies"` is,
  // names the member only for a string among them.
  private namesMember(e: Ref<Extract<Expr, { kind: "object" }>>, m: ObjectType): boolean {
    for (const p of e.props) {
      if (p.kind !== "property" || typeof p.key !== "string") continue;
      if (this.ctx.tables.typing.field(m, p.key) === undefined) return false;
    }
    for (const p of e.props) {
      if (p.kind !== "property" || typeof p.key !== "string") continue;
      const f = this.ctx.tables.typing.field(m, p.key)!.type;
      let literals: LiteralType[] = [];
      const r = this.recOf(f);
      if (r?.kind === "literal") literals.push(f as LiteralType);
      else if (r?.kind === "union") {
        let all = true;
        for (const u of r.members) if (this.recOf(u)?.kind !== "literal") all = false;
        if (all) for (const u of r.members) literals.push(u as LiteralType);
      }
      if (literals.length === 0) continue;
      const value = p.value.kind === "string" ? p.value.value : undefined;
      let some = false;
      for (const l of literals) if (this.ctx.tables.typing.rec(l).value === value) some = true;
      if (!some) return false;
    }
    return true;
  }

  // Whether an array literal's length suits `t`: any array's, or a tuple's or fixed array's count.
  private couldHold(t: Type, e: Ref<Extract<Expr, { kind: "array" }>>): boolean {
    if (this.isArray(t)) return true;
    const n = e.elements.length;
    let spread = false;
    for (const x of e.elements) if (x !== undefined && x.kind === "spread") spread = true;
    if (this.isFixed(t)) return spread || n === this.ctx.tables.typing.rec(t).size;
    if (!this.ctx.tables.typing.isTuple(t)) return false;
    const tuple = t as ObjectType;
    const count = this.ctx.tables.typing.elementsOf(tuple).length;
    return spread || (n >= (this.ctx.tables.typing.rec(tuple).required ?? count) && (this.ctx.tables.typing.rec(tuple).rest !== undefined || n <= count));
  }

  // A call's type, `void` included, or any other expression's.
  /** @throws {CompileError} */
  result(this: Mut<this>, given: Ref<Expr>): Type {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.resultNow(now) : this.resultNow(given);
  }
  /** @throws {CompileError} */
  private resultNow(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind === "tagged" && !this.isQuote(e)) {
      const untagged = this.untag(e);
      return this.resultUntagged(untagged);
    }
    return this.resultUntagged(e);
  }
  /** @throws {CompileError} */
  private resultUntagged(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind !== "call") return this.value(e);
    // A call returning a value records it, as reading any other value does.
    const { type } = this.call(e);
    if (type !== "void") this.ctx.types.set(cloneExpr(e), type);
    return type;
  }

  // Only a statement may call a function that returns nothing.
  /** @throws {CompileError} */
  effect(this: Mut<this>, given: Ref<Expr>): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.effectNow(now);
    else this.effectNow(given);
  }
  /** @throws {CompileError} */
  private effectNow(this: Mut<this>, e: Ref<Expr>): void {
    if (e.kind === "tagged" && !this.isQuote(e)) {
      const untagged = this.untag(e);
      this.effectUntagged(untagged);
    } else this.effectUntagged(e);
  }
  /** @throws {CompileError} */
  private effectUntagged(this: Mut<this>, e: Ref<Expr>): void {
    if ((e.kind === "assign" || e.kind === "update") && this.staticWrite(e)) {
      const written = this.ctx.tables.rewrites.rewritten(e);
      if (written !== undefined) {
        this.effectWritten(written);
        return;
      }
    }
    this.effectWritten(e);
  }
  /** @throws {CompileError} */
  private effectWritten(this: Mut<this>, e: Ref<Expr>): void {
    if (e.kind === "call") {
      const { type } = this.call(e);
      // A parse read only to check the text still makes its value, which is then dropped.
      if (this.ctx.tables.jsonCalls.get(e) === "parse") this.ctx.types.set(cloneExpr(e), type);
      const r = this.recOf(type);
      if (r?.kind === "future" && this.ctx.tables.typing.leafOf.has(type as FutureType)) {
        throw new CompileError("E0302", "this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'", e.start, e.end);
      }
    } else if (e.kind === "match") this.match(e, false);
    else if (e.kind === "pipe") this.pipe(e, false);
    else if (e.kind === "unary" && e.op === "await") {
      const gives = this.awaited(e);
      if (gives !== "void") this.ctx.types.set(cloneExpr(e), gives);
    }
    else {
      if (e.kind === "assign") this.ctx.exprsState.statementAssign = e.id;
      this.value(e);
    }
  }

  // `match`: the subject is read once, then each arm's pattern is tried in order, binding names
  // in the arm's own scope, then its guard. Every value of the subject's type must be covered.
  // Used as a statement, its arms may give nothing. Matching a value just made, the bindings own
  // its parts; matching a place, they borrow them. A block arm gives what its `return`s do.
  /** @throws {CompileError} */
  private match(this: Mut<this>, e: Ref<Extract<Expr, { kind: "match" }>>, wanted: boolean): Type {
    const subject = this.read(e.subject);
    const owning = made(e.subject);
    let given: [Expr, Type][] = [];
    for (const arm of e.arms) {
      this.ctx.enterArm();
      try {
        this.pattern(arm.pattern, subject, !owning);
        if (arm.guard !== undefined) this.condition(arm.guard);
        if (arm.body.kind === "block") {
          let gives = this.ctx.block(arm.body, wanted);
          while (gives.length > 0) given.push(gives.shift()!);
        } else {
          const body = cloneExpr(arm.body);
          given.push([body, wanted ? this.value(arm.body) : this.result(arm.body)]);
        }
      } finally {
        this.ctx.leaveArm();
      }
    }
    let rows: Pattern[][] = [];
    for (const a of e.arms) if (a.guard === undefined) rows.push([clonePattern(a.pattern)]);
    const example = uncovered(this.ctx.tables.typing, this.ctx.tables.ids, rows, [subject], this.ctx.patterns);
    if (example !== undefined) throw new CompileError("E0607", missing(this.ctx.tables.typing, example[0]!, subject), e.start, e.subject.end + 1);
    if (!wanted) return "void";
    // Arms that only throw give nothing, so some other arm has to.
    if (given.length === 0) throw new CompileError("E0601", "no arm of this match gives a value; 'return' one from an arm", e.start, e.subject.end + 1);
    // Number literals in an arm take the number type another arm gives, as a conditional's do.
    let types: Type[] = [];
    for (const [, t] of given) types.push(t);
    let numeric: Type | undefined = undefined;
    for (const t of types) {
      if (numeric !== undefined || !isNumeric(t)) continue;
      let all = true;
      for (const [v, u] of given) if (u !== t && !this.literalOnly(v, isFloat(t))) all = false;
      if (all) numeric = t;
    }
    if (numeric !== undefined) {
      for (let i = 0; i < given.length; i++) if (given[i]![1] !== numeric && this.adapt(given[i]![0], numeric)) types[i] = numeric;
    }
    for (let i = 0; i < given.length; i++) given[i]![1] = types[i]!;
    let same = true;
    for (const t of types) if (t !== types[0]) same = false;
    const type = same ? types[0]! : this.ctx.tables.typing.unionType(types);
    let closures = false;
    for (const t of types) if (typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "closure") closures = true;
    if (type !== types[0] && closures) throw unsupported("unions holding functions", e);
    if (this.ctx.tables.typing.holdsRef(type)) throw new CompileError("E0801", `a match can't give a reference it binds yet; ${this.ctx.tables.typing.holdsHandle(type, true) ? "match on a value just made to move its parts out" : "give a copy with '.clone()', or a field of it"}`, e.start, e.subject.end + 1);
    for (const [v, t] of given) if (t !== type) this.coerce(v, t, type, `this arm's '${this.ctx.tables.typing.show(t)}' doesn't fit the match's '${this.ctx.tables.typing.show(type)}'`);
    return type;
  }

  // `x |> f(%)`. Over a place, the pipe means its right side with the place written for each
  // `%`, so it reads, borrows and moves as that would: the node becomes that expression, and
  // later stages never see a pipe. Over anything else, or a place the right side assigns, the
  // value is made once, as JavaScript reads it, and kept in a hidden read-only binding each `%`
  // names, dropped when the pipe ends unless moved out.
  /** @throws {CompileError} */
  private pipe(this: Mut<this>, e: Ref<Extract<Expr, { kind: "pipe" }>>, wanted: boolean): Type {
    const type = this.value(e.value);
    const hidden = this.steady(e.value) ? this.hides(e.body, e.value) : undefined;
    if (hidden?.kind === "ident") {
      throw new CompileError("E0004", `this '${hidden.name}' hides the '${hidden.name}' the pipe reads for '%'; rename it`, hidden.start, hidden.end);
    }
    if (!this.steady(e.value) || this.assigns(e.body, e.value)) {
      // A place the right side writes is read once, as JavaScript reads it: a copy, or else a
      // shared borrow, so the write must wait until the topic's last use.
      const borrowed = this.steady(e.value) && !this.ctx.tables.typing.isCopy(type);
      const topic = borrowed ? this.ctx.tables.typing.refType(type, false) : type;
      if (borrowed) this.coerce(e.value, type, topic, "");
      this.ctx.enterArm();
      try {
        this.ctx.bind("%", topic, e);
        const body = this.pipeBody(e, undefined);
        if (!wanted) {
          this.effect(body);
          return "void";
        }
        const given = this.value(body);
        if (this.ctx.tables.typing.holdsRef(given)) throw new CompileError("E0801", "a pipe over a value can't give a reference yet, since the value is dropped once the pipe ends; give a copy with '.clone()'", e.start, e.end);
        return given;
      } finally {
        this.ctx.leaveArm();
      }
    }
    const body = this.pipeBody(e, e.value);
    const became = this.ctx.tables.rewrites.replace(e, body);
    if (wanted) return this.value(became);
    this.effect(became);
    return "void";
  }

  // A place as a path: its variable or `this`, then its fields, cut where an element is read,
  // since writing any element of an array may change any other. A redundant `!` is no step.
  private path(e: Ref<Expr>): string[] | undefined {
    let steps: PlaceStep[] = [];
    const root = this.placeRoot(e, steps);
    if (root.kind !== "ident" && root.kind !== "this") return undefined;
    let all: string[] = [root.kind === "this" ? "this" : root.name];
    for (let i = steps.length; i > 0; i--) {
      const name = steps[i - 1]!.name;
      if (name === "[]") break;
      all.push(name);
    }
    return all;
  }

  // The steps from a place to its root, a rewrite followed and a redundant `!` read through at
  // each: `steps` gets each field or element read, outermost first. Gives the root.
  private placeRoot(given: Ref<Expr>, steps: Mut<PlaceStep[]>): PlaceRoot {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.placeRootNow(now, steps) : this.placeRootNow(given, steps);
  }
  private placeRootNow(e: Ref<Expr>, steps: Mut<PlaceStep[]>): PlaceRoot {
    if (e.kind === "nonNull" && e.redundant === true) return this.placeRoot(e.expr, steps);
    if (e.kind === "member") {
      steps.push({ name: e.name, index: "", indexName: "" });
      return this.placeRoot(e.object, steps);
    }
    if (e.kind === "index") {
      steps.push({ name: "[]", index: e.index.kind, indexName: e.index.kind === "ident" ? e.index.name : "" });
      return this.placeRoot(e.object, steps);
    }
    return { kind: e.kind, name: e.kind === "ident" ? e.name : "" };
  }

  // The names an index in a place reads.
  private indexNames(place: Ref<Expr>): Set<string> {
    let names = new Set<string>();
    let steps: PlaceStep[] = [];
    this.placeRoot(place, steps);
    for (const step of steps) if (step.indexName !== "") names.add(step.indexName);
    return names;
  }

  // Whether an expression assigns something the place is, holds or is held in, or an index name.
  private assigns(body: Ref<Expr>, place: Ref<Expr>): boolean {
    const own = this.path(place)!;
    const names = this.indexNames(place);
    return someNode({ of: "expr", node: body }, (n) => n.of === "expr" && ((n.node.kind === "assign" && this.overlaps(n.node.target, own, names)) || (n.node.kind === "update" && this.overlaps(n.node.operand, own, names))));
  }

  // Whether an assignment's target is the place at `own`, holds it or is held in it, or is one of
  // the index names it reads.
  private overlaps(target: Ref<Expr>, own: Ref<string[]>, names: Ref<Set<string>>): boolean {
    const p = this.path(target);
    if (p === undefined) return false;
    if (p.length === 1 && names.has(p[0]!)) return true;
    const n = Math.min(own.length, p.length);
    for (let i = 0; i < n; i++) if (own[i] !== p[i]) return false;
    return true;
  }

  // A binding the right side declares with a name the place reads, which would capture the
  // place written in for `%`.
  private hides(body: Ref<Expr>, place: Ref<Expr>): Expr | undefined {
    const root = this.path(place)![0]!;
    let names = this.indexNames(place);
    if (root !== "this") names.add(root);
    let found: Expr[] = [];
    this.hidesIn({ of: "expr", node: body }, { of: "expr", node: body }, names, found);
    return found.length > 0 ? found.shift() : undefined;
  }

  // A declaration's scope is the closest arrow, match arm, block, loop or `try` around it; it
  // captures the place only where a `%` is inside that scope.
  private hidesIn(n: AnyNode, scope: AnyNode, names: Ref<Set<string>>, found: Mut<Expr[]>): void {
    if (found.length > 0) return;
    const kind = n.of === "stmt" ? n.node.kind : n.of === "expr" ? n.node.kind : "";
    const opens = n.of === "matchArm" || (n.of === "expr" && kind === "arrow") || (n.of === "stmt" && (kind === "block" || kind === "for" || kind === "forOf" || kind === "forIn" || kind === "try"));
    const within = opens ? reborrowNode(n) : reborrowNode(scope);
    // Parameters, `let` declarators, match patterns, catch parameters and destructuring declare names.
    const declares = n.of === "param" || n.of === "matchArm" || n.of === "declarator" || (n.of === "stmt" && kind === "try") || (n.of === "expr" && kind === "destructure");
    const topical = n.of !== "stmts" && declares && someNode(reborrowNode(within), (c) => c.of === "expr" && c.node.kind === "topic");
    forEachChild(reborrowNode(n), (c) => {
      if (declares && c.of === "pattern") {
        if (topical) declaredIn(c.node, names, found);
      } else this.hidesIn(c, reborrowNode(within), names, found);
    });
  }

  // A place reading it again reads the same value: no part of it runs code.
  private steady(this: Mut<this>, e: Ref<Expr>): boolean {
    if (!this.place(e)) return false;
    let steps: PlaceStep[] = [];
    this.placeRoot(e, steps);
    for (const step of steps) if (step.index !== "" && step.index !== "int" && step.index !== "ident") return false;
    return true;
  }

  // Replaces a pipe's every `%`, in its right side and in the left side of a pipe inside it, whose
  // own right side has a topic of its own: with a name `%` the pipe binds, or with a fresh copy of
  // `place`, whose fields are noted as substituted. As in TC39, the topic itself is never assigned.
  // Replacements are made in the order the topics are written, nested pipes where they stand.
  /** @throws {CompileError} */
  private topics(this: Mut<this>, body: Ref<Expr>, place: Ref<Expr> | undefined): void {
    const events = topicEvents(body, this.ctx.tables.rewrites);
    for (const event of events) {
      if (event.assigned) throw new CompileError("E0004", "'%' can't be assigned; it stands for the pipe's value, so assign to what you piped instead", event.node.start, event.node.end);
      if (event.walk) this.topics(event.node, place);
      else if (place === undefined) this.ctx.tables.rewrites.replaceAt(idOfExpr(event.node), { id: nextId(this.ctx.tables.ids), kind: "ident", name: "%", start: event.node.start, end: event.node.end });
      else {
        const fresh = this.freshCopy(place);
        const copy = this.spanned(fresh, event.node);
        const placed = this.ctx.tables.rewrites.replaceAt(idOfExpr(event.node), copy);
        this.substitutedIn(placed);
      }
    }
  }

  // Notes each field read of a copy standing for `%`, down to its root.
  private substitutedIn(this: Mut<this>, m: Ref<Expr>): void {
    if (m.kind === "member") {
      this.ctx.tables.substituted.add(cloneExpr(m));
      this.substitutedIn(m.object);
    } else if (m.kind === "index") this.substitutedIn(m.object);
  }

  // A pipe's right side with each `%` replaced: a copy, made once, each node of which replaces the
  // node it copies, so the checker reads the right side whole, as it does any other node.
  /** @throws {CompileError} */
  private pipeBody(this: Mut<this>, e: Ref<Extract<Expr, { kind: "pipe" }>>, place: Ref<Expr> | undefined): Expr {
    const made = this.ctx.tables.rewrites.rewritten(e.body);
    if (made !== undefined) return made;
    this.topics(e.body, place);
    const body = rebuiltExpr(cloneExpr(e.body), this.ctx.tables.rewrites);
    return this.ctx.tables.rewrites.replaceAt(idOfExpr(e.body), body);
  }

  // A copy of `e` with fresh ids, as checking has left it so far.
  private freshCopy(this: Mut<this>, e: Ref<Expr>): Expr {
    return renumbered(cloneExpr(rebuiltExpr(cloneExpr(e), this.ctx.tables.rewrites)), this.ctx.tables.ids);
  }

  // A copy of an expression standing where `at` was, for messages and for keys by position.
  private spanned(e: Expr, at: Ref<Expr>): Expr {
    return respanExpr(e, { start: at.start, end: at.end });
  }

  // Records what a match pattern tests, for codegen.
  private recordPattern(this: Mut<this>, p: Ref<Pattern>, type: Type, test: PatternTest): void {
    this.ctx.patterns.set(clonePattern(p), infoOf(type, test));
  }
  private neverMatches(this: Mut<this>, p: Ref<Pattern>, type: Type): CompileError {
    return new CompileError("E0607", `this pattern can never match a '${this.ctx.tables.typing.show(type)}'`, p.start, p.end);
  }

  // Checks a pattern against the type of the value it meets, declaring what it binds and
  // recording what it tests. A name is a unit member of the matched enum, or an Option's
  // `None`, before it is a binding. A borrowing binding of a part that isn't Copy is a shared
  // reference to it.
  /** @throws {CompileError} */
  private pattern(this: Mut<this>, p: Ref<Pattern>, type: Type, borrowing: boolean): void {
    const whole = this.recOf(type);
    const members = whole?.kind === "union" ? whole.members : [type];
    const optional = members.includes("null");
    switch (p.kind) {
      case "wildcard":
        { this.recordPattern(p, type, { kind: "any" }); return; }
      case "ident": {
        const unit = this.variantNamed(members, p.name);
        if (unit !== undefined && this.ctx.tables.typing.rec(unit).fields.length === 0) { this.recordPattern(p, type, { kind: "variant", variant: unit, args: [] }); return; }
        if (p.name === "None" && optional) { this.recordPattern(p, type, { kind: "none" }); return; }
        // A C-like enum's member may be named bare too, as a data enum's unit member may.
        let named: LiteralType[] = [];
        for (const m of members) {
          const r = this.recOf(m);
          if (r?.kind === "literal" && r.owner?.member === p.name) named.push(m as LiteralType);
        }
        if (named.length > 1) {
          throw new CompileError("E0607", `'${p.name}' is a member of ${named.map((m) => `'${this.ctx.tables.typing.rec(m).owner!.enum}'`).join(" and ")}; name which, as '${this.ctx.tables.typing.rec(named[0]!).owner!.enum}.${p.name}'`, p.start, p.end);
        }
        if (named.length > 0) { this.recordPattern(p, type, { kind: "literal", value: this.ctx.tables.typing.rec(named[0]!).value, member: named[0]! }); return; }
        this.ctx.bind(p.name, borrowing && !this.ctx.tables.typing.isCopy(type) ? this.ctx.tables.typing.refType(type, false) : type, { id: p.id, kind: "ident", name: p.name, start: p.start, end: p.end });
        { this.recordPattern(p, type, { kind: "any" }); return; }
      }
      case "literal": {
        if (p.value.kind === "null") {
          if (!optional) throw this.neverMatches(p, type);
          this.value(p.value);
          { this.recordPattern(p, type, { kind: "none" }); return; }
        }
        let t = this.value(p.value);
        // A number takes the matched type's number type, as a literal operand does.
        const numeric = members.find(isNumeric);
        if (isNumeric(t) && members.filter(isNumeric).length > 1) {
          throw new CompileError("E0607", `a number can't be matched against '${this.ctx.tables.typing.show(type)}', which holds several number types; convert the value with 'as' first`, p.start, p.end);
        }
        if (isNumeric(t) && (numeric !== undefined) && t !== numeric) {
          this.coerce(p.value, t, numeric, `'${this.ctx.tables.typing.show(t)}' can't match a '${this.ctx.tables.typing.show(numeric)}'`);
          t = numeric;
        }
        if (!comparable(this.ctx.tables.typing, type, t)) throw this.neverMatches(p, type);
        { this.recordPattern(p, type, { kind: "literal", value: literalOf(p.value) }); return; }
      }
      case "variant": {
        if (p.name === "Some" && optional && p.args?.length === 1) {
          const inner = this.ctx.tables.typing.unionType(members.filter((m) => m !== "null"));
          this.pattern(p.args[0]!, inner, borrowing);
          { this.recordPattern(p, type, { kind: "some", inner, arg: clonePattern(p.args[0]!) }); return; }
        }
        const member = this.enumMember(p);
        if ((member !== undefined)) {
          if (!comparable(this.ctx.tables.typing, type, member)) throw this.neverMatches(p, type);
          { this.recordPattern(p, type, { kind: "literal", value: this.ctx.tables.typing.rec(member).value, member }); return; }
        }
        const v = this.variantNamed(members, p.name);
        if (v === undefined) throw this.neverMatches(p, type);
        const count: usize = p.args !== undefined ? p.args.length : 0;
        if (count !== this.ctx.tables.typing.rec(v).fields.length) {
          throw new CompileError("E0607", `'${this.ctx.tables.typing.rec(v).name}' holds ${this.ctx.tables.typing.rec(v).fields.length} value${this.ctx.tables.typing.rec(v).fields.length === 1 ? "" : "s"}, so its pattern takes ${this.ctx.tables.typing.rec(v).fields.length}`, p.start, p.end);
        }
        let args: Pattern[] = [];
        if (p.args !== undefined) {
          for (let i: usize = 0; i < p.args.length; i++) {
            this.pattern(p.args[i]!, this.ctx.tables.typing.rec(v).fields[i]!.type, borrowing);
            args.push(clonePattern(p.args[i]!));
          }
        }
        { this.recordPattern(p, type, { kind: "variant", variant: v, args }); return; }
      }
      // An object pattern tests the members that hold every field it names; each field's pattern
      // meets that field's type across them.
      case "object": {
        if (p.rest) throw unsupported("rest patterns", p.rest);
        const keys = p.props.map((prop) => {
          if (typeof prop.key !== "string") throw unsupported("computed keys in patterns", prop);
          return prop.key;
        });
        // A member is ruled out by a field it lacks, or by a literal field the pattern's literal
        // contradicts, as a discriminant does.
        const shapes = members.filter((m): m is Shape => {
          const r = this.recOf(m);
          const bound = r?.kind === "param" ? this.recOf(r.bound) : undefined;
          const boxed = r?.kind === "recursive" ? this.recOf(r.of) : undefined;
          if (!(r?.kind === "object" || r?.kind === "class" || bound?.kind === "object" || bound?.kind === "interface" || boxed?.kind === "object" || boxed?.kind === "class")) return false;
          return p.props.every((prop, i) => {
            const field = objectFields(this.ctx.tables.typing, m as Shape).find((f) => f.name === keys[i]);
            const r = field ? this.recOf(field.type) : undefined;
            const known = r?.kind === "literal" ? r : undefined;
            return field && !(known && prop.value.kind === "literal" && literalOf(prop.value.value) !== known.value);
          });
        });
        if (shapes.length === 0) throw this.neverMatches(p, type);
        const fields = p.props.map((prop, i): [string, Pattern, Type] => {
          const ft = this.ctx.tables.typing.unionType(shapes.map((m) => objectFields(this.ctx.tables.typing, m).find((f) => f.name === keys[i])!.type));
          this.pattern(prop.value, ft, borrowing);
          return [keys[i]!, prop.value, ft];
        });
        { this.recordPattern(p, type, { kind: "object", shapes, fields }); return; }
      }
      case "array": {
        if (p.rest) throw unsupported("rest patterns", p.rest);
        if (p.elements.some((x) => x === undefined)) throw unsupported("holes in array patterns", p);
        const array = members.find((m): m is ArrayType => this.isArray(m));
        if (members.some((t) => this.ctx.tables.typing.isTuple(t))) throw new CompileError("E0801", "array patterns over tuples in 'match' are not supported yet; take the tuple apart first, as in 'const [a, b] = t'", p.start, p.end);
        if (!array || members.length > 1) throw this.neverMatches(p, type);
        const items = p.elements as Pattern[];
        const { element } = this.ctx.tables.typing.rec(array);
        for (const item of items) this.pattern(item, element, borrowing);
        { this.recordPattern(p, type, { kind: "array", element, items }); return; }
      }
      case "or":
        for (const alt of p.patterns) this.pattern(alt, type, borrowing);
        if (p.patterns.some((alt) => bindings(alt).some((b) => this.ctx.locals.has(b as Expr)))) throw unsupported("alternatives binding names", p);
        { this.recordPattern(p, type, { kind: "or", alternatives: p.patterns }); return; }
      default:
        throw unsupported(`${p.kind} patterns`, p);
    }
  }

  // A C-like enum's member named by a pattern, `Color.Red`.
  /** @throws {CompileError} */
  private enumMember(this: Mut<this>, p: Ref<Extract<Pattern, { kind: "variant" }>>): LiteralType | undefined {
    const parts = p.name.split(".");
    if (p.args !== undefined || parts.length < 2) return undefined;
    const owner = parts[0]!;
    return this.ctx.lookup(owner, undefined) === undefined && this.ctx.enums.has(owner) ? this.ctx.enumMember(owner, parts[1]!) : undefined;
  }

  // The variant among a type's members that a pattern names: `Circle`, or `Shape.Circle`.
  private variantNamed(members: Type[], name: string): VariantType | undefined {
    const parts = name.split(".");
    const member = parts.at(-1)!;
    const owner = parts.length > 1 ? parts.slice(0, -1).join(".") : undefined;
    for (const m of members) {
      const r = this.recOf(m);
      if (r?.kind === "variant" && r.member === member && (owner === undefined || r.enum === owner)) return m as VariantType;
    }
    return undefined;
  }

  // Checks a call: what it returns, and how a message names what it calls. A method called in
  // an optional chain gives an Option.
  /** @throws {CompileError} */
  private call(this: Mut<this>, given: Ref<Call>): { type: Type; what: string } {
    const spread = this.spreadTuples(given);
    if (spread !== undefined && spread.kind === "call") return this.callSpread(spread);
    return this.callSpread(given);
  }
  /** @throws {CompileError} */
  private callSpread(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    const variant = this.ctx.tables.promiseVariants.get(e);
    if (variant !== undefined) {
      const nothing = this.ctx.tables.typing.lower(this.ctx.resolveType(variant.typeArgs[0]!)) === "void";
      const named = this.ctx.tables.rewrites.replaceAt(idOfExpr(e.callee), { id: 0, kind: "ident", name: nothing ? `${variant.name} void` : variant.name, start: e.callee.start, end: e.callee.end });
      const made = this.ctx.tables.rewrites.replace(e, { ...callNode(e), callee: named, typeArgs: nothing ? variant.typeArgs.slice(1) : variant.typeArgs });
      if (made.kind === "call") return this.callNamed(made);
    }
    return this.callNamed(e);
  }
  /** @throws {CompileError} */
  private callNamed(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    const result = this.callee(e);
    // A call checked as another form, as `isDeepStrictEqual` is, has its own type already.
    const now = this.ctx.tables.rewrites.rewritten(e);
    if (now === undefined) return this.callResult(e, result);
    return now.kind === "call" ? this.callResult(now, result) : result;
  }
  /** @throws {CompileError} */
  private callResult(this: Mut<this>, e: Ref<Call>, result: { type: Type; what: string }): { type: Type; what: string } {
    if (e.optional && !this.ctx.tables.optionalCalls.has(e)) throw unsupported("optional calls", e);
    return e.callee.kind === "member" && (this.linked(e.callee) || e.optional) && result.type !== "void" ? { type: this.optional(result.type, e), what: result.what } : result;
  }

  // `super(...)`: the base class's constructor run on this object.
  /** @throws {CompileError} */
  private superCalled(this: Mut<this>, e: Ref<Call>, constructor: BodyId): { type: Type; what: string } {
    this.expectFrom(constructor, e.args);
    let argTypes: Type[] = [];
    for (const a of e.args) argTypes.push(this.value(a));
    const instance = this.ctx.instantiate(constructor, [], e.args, argTypes.slice(), e);
    this.args(e.args, argTypes, instance, e);
    this.ctx.calls.set(cloneExpr(e), instance);
    const error = this.ctx.errorOf(instance);
    if (error !== undefined) this.ctx.raise(e, error, "'super'");
    return { type: "void", what: "'super'" };
  }

  // The call `spawnBlocking` makes of a function it was given by name or value must take no
  // arguments and give no Promise.
  /** @throws {CompileError} */
  private blockingRun(this: Mut<this>, callee: Ref<Extract<Expr, { kind: "ident" }>>): void {
    const sync = "'spawnBlocking' runs a synchronous function on a thread of its own; run async work with 'spawn' instead";
    const declared = (this.ctx.lookup(callee.name, undefined) === undefined) ? this.bodyNamed(callee.name) : undefined;
    let wrong: string | undefined;
    if ((declared !== undefined)) {
      let needed: usize = 0;
      for (const p of declared.params) if (!p.optional && p.default === undefined && !p.rest) needed++;
      wrong = declared.async === true ? sync : needed > 0 ? `'spawnBlocking' calls its function with no arguments, but this one takes ${needed}; wrap it, as in 'spawnBlocking(() => f(x))'` : undefined;
    } else {
      const t = this.value(callee);
      const through = this.heldBy(t)!;
      const r = this.recOf(through);
      const fn = this.isCallable(through) ? this.recOf(this.ctx.tables.typing.callableOf.get((r as DynRecord).of)) : r?.kind === "closure" || r?.kind === "function" ? r : undefined;
      wrong = fn?.kind !== "closure" && fn?.kind !== "function" ? `'spawnBlocking' needs a function taking no arguments, like 'spawnBlocking(() => work())', not '${this.ctx.tables.typing.show(t)}'`
        : fn.params.length > 0 ? `'spawnBlocking' calls its function with no arguments, but this one takes ${fn.params.length}; wrap it, as in 'spawnBlocking(() => f(x))'`
        : this.recOf(fn.returns)?.kind === "future" ? sync
        : undefined;
    }
    if (wrong !== undefined) throw new CompileError("E0305", wrong, callee.start, callee.end);
  }

  /** @throws {CompileError} */
  private callee(this: Mut<this>, given: Ref<Call>): { type: Type; what: string } {
    // `c[Symbol.iterator]()` calls the method that key names.
    const now = this.ctx.tables.rewrites.rewritten(given.callee);
    const keyed = now !== undefined ? this.iteratorCallee(given, now) : this.iteratorCallee(given, given.callee);
    if (keyed !== undefined && keyed.kind === "call") return this.calleeKeyed(keyed);
    return this.calleeKeyed(given);
  }
  // A call whose callee is `c[Symbol.iterator]`, made a call of the method that key names.
  private iteratorCallee(this: Mut<this>, e: Ref<Call>, key: Ref<Expr>): Expr | undefined {
    if (key.kind !== "index" || !isIteratorKey(key.index)) return undefined;
    const member = this.ctx.tables.rewrites.replace(key, { id: 0, kind: "member", object: cloneExpr(key.object), name: ITERATOR, optional: key.optional, start: key.start, end: key.end });
    return this.ctx.tables.rewrites.replace(e, { ...callNode(e), callee: member });
  }
  /** @throws {CompileError} */
  private calleeKeyed(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    // `t[0](x)` calls a tuple's element, as a field holding a callable is called.
    this.untuple(e.callee);
    const now = this.ctx.tables.rewrites.rewritten(e.callee);
    if (now !== undefined) {
      const made = this.ctx.tables.rewrites.replace(e, { ...callNode(e), callee: now });
      if (made.kind === "call") return this.calleeNow(made);
    }
    return this.calleeNow(e);
  }
  /** @throws {CompileError} */
  private calleeNow(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    const callee = e.callee;
    if (this.ctx.tables.blockingRuns.has(e) && callee.kind === "ident") this.blockingRun(callee);
    if (e.optional && callee.kind !== "member") throw unsupported("optional calls", e);
    if (callee.kind === "super") {
      const superCall = this.ctx.superCall;
      if (superCall === undefined || idOfExpr(superCall) !== e.id) throw new CompileError("E0703", "'super(...)' can only be the first statement of a derived class's constructor", e.start, e.end);
      const base = this.cls(this.ctx.tables.typing.rec(this.ctx.self!.type).base!);
      const constructor = base.constructor;
      this.ctx.types.set(cloneExpr(callee), base.type);
      const params = this.ctx.tables.arenas.bodyOf(constructor).params;
      if (params.length > 0 && params[params.length - 1]!.rest) {
        const packed = this.packRest(e, e.args, params);
        if (packed !== undefined && packed.kind === "call") return this.superCalled(packed, constructor);
      } else this.refuseSpread(e.args);
      return this.superCalled(e, constructor);
    }
    // A program's own `console` or `print` keeps its meaning.
    const printer = callee.kind === "ident" ? callee.name : callee.kind === "member" && callee.object.kind === "ident" ? callee.object.name : "";
    if (isPrint(callee) && (this.ctx.lookup(printer, undefined) === undefined) && !this.ctx.classes.has(printer) && !this.ctx.byName.has(printer) && !this.ctx.byName.has(`const ${printer}`) && !this.ctx.enums.has(printer)) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError("E0505", `'${printer}' is always there, so it is called without '?.'`, e.start, e.end);
      this.ctx.tables.printCalls.add(e);
      this.shown(e.args);
      this.unformattable(e.args);
      return { type: "void", what: "printing" };
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && COMBINERS.includes(callee.name) && (this.ctx.lookup("Promise", undefined) === undefined) && !this.ctx.classes.has("Promise")) {
      return this.combined(e, callee.name as Combiner);
    }
    // A static method of a package's class.
    const jsClass = callee.kind === "member" && callee.object.kind === "ident" && (this.ctx.lookup(callee.object.name, undefined) === undefined) ? this.ctx.tables.jsClasses.get(callee.object.name) : undefined;
    if (jsClass && callee.kind === "member") {
      const m = this.jsStatic(jsClass, callee.name, e);
      if (m.kind !== "method") throw new CompileError("E0503", `'${callee.name}' is a property of '${jsClass.name}', not a method`, callee.start, callee.end);
      if (m.typeParams.length > 0) throw unsupported("generic methods of a package's types", callee);
      const params = this.jsParams(m.params);
      params.forEach((p) => this.crossing(p, `'${jsClass.name}.${callee.name}' takes a`, e));
      this.jsArgs(e, params, m.params.map((p) => p.optional));
      const returns = m.returns ? this.ctx.resolveType(m.returns) : this.ctx.tables.typing.blockType("JsValue");
      return { type: this.crossing(returns === "void" ? "void" : this.ctx.tables.typing.jsView(returns), `'${jsClass.name}.${callee.name}' gives a`, e), what: `'${callee.name}'` };
    }
    if (callee.kind === "ident" && TIMER_CALLS.has(callee.name) && (this.ctx.lookup(callee.name, undefined) === undefined) && !this.ctx.byName.has(callee.name)) {
      return this.call(this.timerCall(e, callee.name));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && callee.name === "withResolvers" && (this.ctx.lookup("Promise", undefined) === undefined) && !this.ctx.classes.has("Promise")) {
      return this.call(this.promiseResolvers(e));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && (callee.name === "resolve" || callee.name === "reject") && (this.ctx.lookup("Promise", undefined) === undefined) && !this.ctx.classes.has("Promise")) {
      return this.call(this.promiseSettled(e, callee.name));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "AbortSignal" && (this.ctx.lookup("AbortSignal", undefined) === undefined) && !this.ctx.classes.has("AbortSignal")) {
      return this.signalStatic(e, callee);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && (callee.object.name === "TcpListener" || callee.object.name === "TcpStream" || callee.object.name === "UnixListener" || callee.object.name === "UnixStream" || callee.object.name === "UdpSocket") && (this.ctx.lookup(callee.object.name, undefined) === undefined) && !this.ctx.classes.has(callee.object.name)) {
      return this.socketStatic(e, callee, callee.object.name);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "FixedArray" && (this.ctx.lookup("FixedArray", undefined) === undefined) && !this.ctx.classes.has("FixedArray")) return this.filled(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Array" && (this.ctx.lookup("Array", undefined) === undefined) && !this.ctx.classes.has("Array")) return this.arrayStatic(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && isTypedName(callee.object.name) && (this.ctx.lookup(callee.object.name, undefined) === undefined) && !this.ctx.classes.has(callee.object.name)) return this.typedStatic(e, callee, callee.object.name);
    // `u8.fromBase64(s, options?)` and `u8.fromHex(s)`, TC39's Uint8Array statics on the byte type.
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "u8" && (this.ctx.lookup("u8", undefined) === undefined) && !this.ctx.byName.has("u8") && !this.ctx.byName.has("const u8")) {
      const helper = Object.hasOwn(BYTE_DECODERS, callee.name) ? BYTE_DECODERS[callee.name] : undefined;
      if (!helper) throw new CompileError("E0502", `'u8' has no static '${callee.name}'; decode text into a 'u8[]' with 'u8.fromBase64' or 'u8.fromHex'`, callee.start, callee.end);
      if (callee.optional || e.optional) throw new CompileError("E0505", `'u8.${callee.name}' is always there, so it is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError("E0106", `'u8.${callee.name}' takes no type arguments`, e.start, e.end);
      const most = callee.name === "fromBase64" ? 2 : 1;
      if (e.args.length < 1 || e.args.length > most) throw new CompileError("E0504", most === 1 ? "'u8.fromHex' takes one string of hex digits" : "'u8.fromBase64' takes a string and an optional options object, as in '{ alphabet: \"base64url\" }'", e.start, e.end);
      return this.callMade(this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: helper, start: callee.start, end: callee.end } }));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Object" && (this.ctx.lookup("Object", undefined) === undefined) && !this.ctx.classes.has("Object") && !this.ctx.byName.has("Object") && !this.ctx.byName.has("const Object") && !this.ctx.enums.has("Object")) return this.objectStatic(e, callee);
    if (callee.kind === "member" && this.isString(callee.object)) return this.stringStatic(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Rc" && (this.ctx.lookup("Rc", undefined) === undefined) && !this.ctx.classes.has("Rc") && !this.ctx.byName.has("Rc")) return this.ptrEq(e, callee);
    if (callee.kind === "member" && this.isMath(callee.object)) {
      if (callee.optional || e.optional) throw new CompileError("E0505", "'Math' is always there, so its functions are called without '?.'", e.start, e.end);
      return this.mathCall(e, callee.name);
    }
    const clock = this.clockOf(callee);
    if (clock) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError("E0505", `'${clock.split(".")[0]}' is always there, so '${clock}()' is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${clock}' takes no type arguments`, e.start, e.end);
      if (e.args.length > 0) throw new CompileError("E0504", `'${clock}' takes no arguments`, e.start, e.end);
      this.ctx.tables.clocks.set(e, clock);
      return { type: clock === "Date.now" ? "i64" : "f64", what: `'${clock}'` };
    }
    const json = this.jsonOf(callee);
    if (json && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError("E0505", "'JSON' is always there, so its functions are called without '?.'", e.start, e.end);
    if (json === "stringify") return this.stringify(e);
    if (json === "parse") return this.jsonParse(e);
    const parser = this.parserOf(callee);
    if (parser && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError("E0505", `'${parser}' is always there, so it is called without '?.'`, e.start, e.end);
    if (parser) return this.parse(e, parser);
    if (callee.kind === "ident" && callee.name === "assert" && (e.start >= STD_BASE || ((this.ctx.lookup("assert", undefined) === undefined) && !this.ctx.classes.has("assert") && !this.ctx.byName.has("assert") && !this.ctx.byName.has("const assert")))) return this.assertion(e);
    // `new Array(n).fill(x)`: n copies of x, the only form `new Array(n)` takes.
    if (callee.kind === "member" && callee.name === "fill" && callee.object.kind === "new" && callee.object.callee.kind === "ident" && callee.object.callee.name === "Array" && (this.ctx.lookup("Array", undefined) === undefined) && !this.ctx.classes.has("Array")) {
      const made = callee.object;
      if (e.typeArgs.length > 0) throw new CompileError("E0106", "'fill' takes no type argument; write the element type on the array, as in 'new Array<u8>(n).fill(0)'", e.start, e.end);
      if (made.args?.length !== 1 || e.args.length !== 1) throw new CompileError("E0504", "'new Array(n).fill(x)' makes n copies of x; it takes one length and one value", e.start, e.end);
      const [n, x] = [made.args[0]!, e.args[0]!];
      const filled = this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "array filled", start: callee.start, end: callee.end }, args: [this.arrayLength(n, true), x], typeArgs: made.typeArgs }) as Call;
      this.ctx.tables.fills.add(filled);
      return this.call(filled);
    }
    // The rewritten fill, checked again in each generic instance: what the prelude can't do with
    // the value is said at the value, not inside the prelude.
    if (this.ctx.tables.fills.has(e) && !this.ctx.tables.filling.has(e)) {
      const x = e.args[1]!;
      this.ctx.tables.filling.add(e);
      let result;
      try {
        result = this.call(e);
      } catch (err) {
        if (err instanceof CompileError && err.start >= STD_BASE) throw new CompileError(err.code, `'new Array(n).fill(x)' can't be made from this value: ${err.message}`, x.start, x.end);
        throw err;
      } finally {
        this.ctx.tables.filling.delete(e);
      }
      const t = this.ctx.tables.typing.lower(this.ctx.types.get(x)!);
      if (typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "generator") throw new CompileError("E0213", "'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once", x.start, x.end);
      this.clonable(t, x);
      return result;
    }
    // A length the user wrote, an `i64` or a `usize`; a fill's panics when negative, as JavaScript throws.
    if (callee.kind === "ident" && callee.name === "fill length") {
      const t = this.read(e.args[0]!);
      if (t !== "i64" && t !== "usize") throw new CompileError("E0504", `an array's length is an 'i64' or a 'usize', not '${this.ctx.tables.typing.show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      return { type: "i64", what: "an array length" };
    }
    // `super.m(...)` the bases don't declare runs on the Map or Set the class embeds.
    if (callee.kind === "member" && callee.object.kind === "super" && this.superDelegated(callee.name)) return this.callMade(this.become(e, { ...e, callee: this.throughEmbedded(callee) }));
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? this.receiverType(callee) : undefined;
    // A method a class extending Map or Set doesn't declare is the embedded collection's.
    if (callee.kind === "member" && this.delegated(receiver, callee.name)) return this.callMade(this.become(e, { ...e, callee: this.throughEmbedded(callee) }));
    if (callee.kind === "member" && callee.name === "clone" && receiver && this.copies(receiver)) return this.cloned(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && stringLike(this.ctx.tables.typing, receiver)) return this.stringCall(e, callee, receiver);
    // A bigint's digits, in base 10 or the radix given.
    if (callee.kind === "member" && receiver === "bigint") {
      if (callee.name !== "toString") throw new CompileError("E0502", `'bigint' has no method '${callee.name}'`, callee.start, callee.end);
      if (e.args.length > 1) throw new CompileError("E0504", "'toString' takes at most a radix", e.start, e.end);
      if (e.args[0]) this.coerce(e.args[0], this.value(e.args[0]), "i64", "a radix is an 'i64' from 2 to 36");
      return { type: "string", what: "'toString'" };
    }
    if (callee.kind === "member" && receiver !== undefined && this.isArray(receiver)) return this.arrayCall(e, callee, receiver);
    const recv = this.recOf(receiver);
    if (callee.kind === "member" && recv?.kind === "map" && recv.dict && callee.name !== "clone" && !this.ctx.tables.dictCalls.has(e)) {
      throw new CompileError("E0502", `a dictionary has no methods, as a plain object has none; its keys are read as properties, like '${this.placeText(callee.object)}[k]'`, callee.start, callee.end);
    }
    if (callee.kind === "member" && recv?.kind === "map" && callee.name !== "clone") {
      const result = this.mapCall(e, callee, receiver as MapType);
      // A class extending Map or Set gets itself back from `set` and `add`, as JavaScript's
      // `this`: the collection is its first field, so a pointer to one points at the other.
      const holder = callee.object.kind === "member" && callee.object.name === EMBEDDED ? callee.object.object : undefined;
      if (!holder || (callee.name !== "set" && callee.name !== "add")) return result;
      this.ctx.borrowsFrom.set(e, [holder]);
      const held = this.ctx.types.get(holder)!;
      return { type: this.ctx.tables.typing.refType(this.isRefType(held) ? this.ctx.tables.typing.rec(held).to : held, true), what: result.what };
    }
    if (callee.kind === "member" && receiver !== undefined && this.ctx.tables.typing.yieldsOf(receiver) !== undefined) return this.generatorCall(e, callee, receiver, this.ctx.tables.typing.yieldsOf(receiver)!);
    if (callee.kind === "member" && receiver !== undefined && this.ctx.tables.typing.yieldsOf(receiver, true) !== undefined && recv?.kind !== "dyn") return this.generatorCall(e, callee, receiver, this.ctx.tables.typing.yieldsOf(receiver, true)!, true);
    if (callee.kind === "member" && recv?.kind === "pointer") return this.pointerCall(e, callee, receiver as PointerType);
    if (callee.kind === "member" && recv?.kind === "interior") return this.interiorCall(e, callee, receiver as InteriorType);
    if (callee.kind === "member" && recv?.kind === "shared") return this.sharedCall(e, callee, receiver as SharedType);
    if (callee.kind === "member" && recv?.kind === "block") return this.blockCall(e, callee, receiver as BlockType);
    if (callee.kind === "member" && recv?.kind === "handle" && callee.name !== "clone") return this.handleCall(e, callee, receiver as HandleType);
    if (callee.kind === "member" && callee.name !== "clone" && recv?.kind === "dyn") return this.dynCall(e, callee, receiver as DynType);
    if (callee.kind === "ident" && callee.name === "shared" && (this.ctx.lookup(callee.name, undefined) === undefined) && !this.ctx.byName.has("shared")) return this.sharedNew(e);
    if (callee.kind === "member" && callee.name === "toFixed" && receiver !== undefined && isNumeric(this.ctx.tables.typing.lower(receiver))) {
      const n = this.ctx.tables.typing.lower(receiver);
      if (isInteger(n) && integerInfo(n).bits === 128) throw new CompileError("E0801", `'toFixed' on a 128-bit integer isn't supported yet; convert it with 'as f64' first`, callee.start, callee.end);
      return this.toFixed(e);
    }
    if (callee.kind === "member" && receiver !== undefined && isInteger(this.ctx.tables.typing.lower(receiver)) && integerMethod(callee.name)) return this.integerCall(e, callee, this.ctx.tables.typing.lower(receiver) as Integer);
    const rx = receiver === undefined ? undefined : this.asRegex(receiver);
    if (callee.kind === "member" && rx) return this.regexCall(e, callee, rx, this.ctx.tables.typing.lower(receiver!) !== rx);
    if (callee.kind === "member" && receiver !== undefined && this.isFixed(receiver)) {
      throw new CompileError("E0502", `a FixedArray has no method '${callee.name}' yet; loop over it with 'for...of', or read 'length'`, callee.start, callee.end);
    }
    // A field holding a stored callable, through an object-typed parameter's bound too.
    const bound = recv?.kind === "param" ? this.recOf(recv.bound) : undefined;
    if (callee.kind === "member" && bound?.kind === "object") {
      const stored = this.ctx.tables.typing.field(bound.kind === "object" ? (this.ctx.tables.typing.rec(receiver as ParamType).bound as ObjectType) : (receiver as ObjectType), callee.name);
      const held = (stored === undefined ? undefined : this.heldBy(stored.type));
      if (held && this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
    }
    if (callee.kind === "member" && (recv?.kind === "param" || recv?.kind === "interface")) {
      return this.traitCall(e, callee, receiver as InterfaceType | ParamType);
    }
    // A nested function's call of itself comes before any outer name it shares.
    const itself = callee.kind === "ident" ? this.ctx.selfCall(e) : undefined;
    if (itself) return itself;
    const nested = callee.kind === "ident" ? this.nestedFunction(callee.name) : undefined;
    if (nested !== undefined) return this.nestedCall(e, callee as Extract<Expr, { kind: "ident" }>, nested);
    // A local generic function is called as the generic function it was lifted to, and a generic
    // function value read from a name or a field as the function it names.
    const lifted = (callee.kind === "ident" ? this.localGeneric(callee.name) : undefined) ?? this.genericTarget(callee, receiver);
    if (callee.kind === "ident" && !lifted && this.ctx.lookup(callee.name, undefined) !== undefined) return this.closureCall(e, callee);
    // A field holding a stored callable, `this.onClick(e)`, when no method has that name.
    if (callee.kind === "member" && receiver !== undefined && (recv?.kind === "class" || recv?.kind === "object")) {
      const stored = this.ctx.tables.typing.field(receiver as ClassType | ObjectType, callee.name);
      const method = recv.kind === "class" && this.inheritedOf(receiver as ClassType, "methods", callee.name);
      const held = (stored === undefined ? undefined : this.heldBy(stored.type));
      if (held && !method && this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
    }
    if (callee.kind !== "ident" && callee.kind !== "member") {
      const given = this.value(callee);
      const held = this.heldBy(given)!;
      if (this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
      if (typeof held !== "string" && this.ctx.tables.typing.rec(held).kind === "closure") return this.closureCall(e, callee, given);
    }
    // `Shape.Circle(1.5)` builds a variant from its payload.
    const named = callee.kind === "member" && callee.object.kind === "ident" && (this.ctx.lookup(callee.object.name, undefined) === undefined) ? this.ctx.enums.get(callee.object.name) : undefined;
    if (named?.data && callee.kind === "member") {
      const ahead = this.expectedVariant(callee, named);
      if (ahead) e.args.forEach((a, i) => this.ctx.tables.typing.rec(ahead).fields[i] && this.expect(a, this.ctx.tables.typing.rec(ahead).fields[i]!.type));
      const given = e.args.map((a) => this.value(a));
      const v = this.variant(callee, named, false, given, e.typeArgs);
      if (e.args.length !== this.ctx.tables.typing.rec(v).fields.length) {
        throw new CompileError("E0501", `'${this.ctx.tables.typing.rec(v).name}' holds ${this.ctx.tables.typing.rec(v).fields.length} value${this.ctx.tables.typing.rec(v).fields.length === 1 ? "" : "s"}, but ${e.args.length} ${e.args.length === 1 ? "was" : "were"} given`, e.start, e.end);
      }
      e.args.forEach((a, i) => {
        const t = given[i]!;
        this.coerce(a, t, this.ctx.tables.typing.rec(v).fields[i]!.type, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to '${this.ctx.tables.typing.rec(v).name}', which holds '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(v).fields[i]!.type)}'`);
      });
      this.ctx.types.set(callee, v);
      return { type: v, what: `'${this.ctx.tables.typing.rec(v).name}'` };
    }
    // `ptrOf(r)` and `mutPtrOf(m)`: a raw pointer to what a reference, or a place, holds. Making
    // one is safe; the borrow lasts only for the call.
    if (callee.kind === "ident" && (callee.name === "ptrOf" || callee.name === "mutPtrOf") && !this.ctx.byName.has(callee.name)) {
      const mutable = callee.name === "mutPtrOf";
      if (e.args.length !== 1) throw new CompileError("E0504", `'${callee.name}' takes 1 argument`, e.start, e.end);
      const a = e.args[0]!;
      const t = this.value(a);
      // A type parameter may stand for a reference in one instance and a value in another, and
      // the two point at different things.
      if (typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "param") throw unsupported(`'${callee.name}' calls on values whose type is a type parameter`, a);
      if (this.isRefType(t)) {
        if (mutable && !this.ctx.tables.typing.rec(t).mutable) throw new CompileError("E1006", "'mutPtrOf' needs a 'Mut' reference, or a place that may change", a.start, a.end);
        return { type: this.ctx.tables.typing.pointerType(this.ctx.tables.typing.rec(t).to, mutable), what: `'${callee.name}'` };
      }
      if (!this.place(a)) throw new CompileError("E1006", `'${callee.name}' needs a variable or a field to point at; a temporary is gone once its statement ends`, a.start, a.end);
      if (mutable) this.changeable(a, "point mutably at");
      this.coerce(a, t, this.ctx.tables.typing.refType(t, mutable), "");
      return { type: this.ctx.tables.typing.pointerType(t, mutable), what: `'${callee.name}'` };
    }
    // `spawn(p)`: the future runs as a task of its own, on any thread, and its handle awaits it.
    // The std library's code calls the built-ins, whatever a program names its own functions.
    const inStd = e.start >= STD_BASE;
    // `spawnBlocking(f)` is `spawn(async () => f())` with the task polled on the blocking pool, so
    // f may block or compute for long without holding up the async workers. An `f` that is neither
    // an arrow nor a name is made here, on the caller's thread, as `f |> spawn(async () => %())`.
    if (callee.kind === "ident" && callee.name === "spawnBlocking" && (!this.ctx.byName.has("spawnBlocking") || inStd)) {
      if (!this.ctx.async) throw new CompileError("E0301", "'spawnBlocking' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      const f = e.args[0];
      if (e.args.length !== 1 || !f) throw new CompileError("E0305", "'spawnBlocking' takes the function to run, like 'spawnBlocking(() => hash(data))'", e.start, e.end);
      if (f.kind === "arrow" && f.async) throw new CompileError("E0305", "'spawnBlocking' runs a synchronous function on a thread of its own; run async work with 'spawn' instead", f.start, f.end);
      if (f.kind === "arrow" && f.params.length > 0) throw new CompileError("E0305", "'spawnBlocking' calls its function with no arguments, so it can't take parameters; capture what it needs instead", f.start, f.end);
      const made = f.kind !== "arrow" && f.kind !== "ident";
      const fn: Expr = made ? { id: nextId(this.ctx.tables.ids), kind: "topic", start: f.start, end: f.end } : f;
      const run: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: fn, typeArgs: [], args: [], optional: false, start: f.start, end: f.end };
      if (f.kind !== "arrow") this.ctx.tables.blockingRuns.add(run);
      const arrow: Expr = { id: nextId(this.ctx.tables.ids), kind: "arrow", move: false, async: true, typeParams: [], params: [], returnType: undefined, body: run, start: f.start, end: f.end };
      const task: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: arrow, typeArgs: [], args: [], optional: false, start: f.start, end: f.end };
      const spawned: Expr = made ? { id: nextId(this.ctx.tables.ids), kind: "pipe", value: f, body: task, start: f.start, end: f.end } : arrow;
      return this.callMade(this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "blocking spawn", start: callee.start, end: callee.end }, args: [spawned] }));
    }
    // std's `timer spawn` is `spawn` with the task's first poll run at once; `blocking spawn` is
    // what `spawnBlocking` becomes.
    const spawning = callee.kind === "ident" && callee.name === "blocking spawn" ? "spawnBlocking" : "spawn";
    if (callee.kind === "ident" && ((callee.name === "spawn" && (!this.ctx.byName.has("spawn") || inStd)) || (callee.name === "timer spawn" && inStd) || callee.name === "blocking spawn")) {
      if (!this.ctx.async) throw new CompileError("E0301", "'spawn' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      if (e.args.length !== 1) throw new CompileError("E0305", "'spawn' takes the Promise to run, like 'spawn(save(user))'", e.start, e.end);
      // `spawn(async () => ...)` runs the arrow's body as the task: its call is what is spawned.
      const given = e.args[0]!;
      if (given.kind === "arrow" && given.async && given.params.length === 0) {
        e = this.ctx.tables.rewrites.replace(e, { ...e, args: [{ id: nextId(this.ctx.tables.ids), kind: "call", callee: given, typeArgs: [], args: [], optional: false, start: given.start, end: given.end }] }) as Call;
      }
      const t = this.value(e.args[0]!);
      const r = this.recOf(t);
      if (r?.kind !== "future" || t === YIELD_NOW || t === SLEEP || this.ctx.tables.typing.leafOf.has(t as FutureType)) throw new CompileError("E0305", `'spawn' needs a Promise from an async function's call, not '${this.ctx.tables.typing.show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      const blocker = this.unsent(t);
      if (blocker) {
        throw new CompileError("E0303", `'${spawning}' runs this ${spawning === "spawn" ? "Promise" : "function"} on another thread, so it must own everything it uses; it holds a '${this.ctx.tables.typing.show(blocker)}', which ${typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "pointer" ? "is a raw pointer no thread can vouch for; pass an owned value, or a clone" : typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "interior" ? "changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead" : typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "shared" ? COUNTED_UNLOCKED : "borrows from this function; pass an owned value, or a clone"}`, e.args[0]!.start, e.args[0]!.end);
      }
      return { type: this.ctx.tables.typing.handleType(r.gives, r.throws), what: "'spawn'" };
    }
    // `sleep(ms)`: a future done once that many milliseconds have passed, holding no thread.
    if (callee.kind === "ident" && callee.name === "sleep" && (!this.ctx.byName.has("sleep") || inStd)) {
      if (e.args.length !== 1 && e.args.length !== 2) throw new CompileError("E0504", "'sleep' takes how many milliseconds to wait, like 'sleep(250)', and may take an AbortSignal", e.start, e.end);
      this.expect(e.args[0]!, "i64");
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, "i64", `'sleep' takes milliseconds as an 'i64', not '${this.ctx.tables.typing.show(t)}'`);
      if (e.args.length === 1) return { type: SLEEP, what: "'sleep'" };
      this.signalArgument(e.args[1]!, "'sleep'");
      return { type: this.ctx.tables.typing.leafFuture("sleep", "void", this.abortError(), true), what: "'sleep'" };
    }
    // `fileRead(path)` and `fileWrite(path, bytes)`: the futures node:fs/promises is written over,
    // each a job on the runtime's blocking pool.
    if (callee.kind === "ident" && (callee.name === "fileRead" || callee.name === "fileWrite") && (inStd || stdModuleAt(this.ctx.tables.files, e.start) !== undefined)) {
      const reading = callee.name === "fileRead";
      if (e.args.length !== (reading ? 1 : 2)) throw new CompileError("E0504", `'${callee.name}' takes ${reading ? "a path" : "a path and the bytes"}`, e.start, e.end);
      const path = this.value(e.args[0]!);
      this.coerce(e.args[0]!, path, "string", `a path is a 'string', not '${this.ctx.tables.typing.show(path)}'`);
      if (!reading) {
        const bytes = this.value(e.args[1]!);
        this.coerce(e.args[1]!, bytes, this.ctx.tables.typing.arrayType("u8"), `the bytes are a 'u8[]', not '${this.ctx.tables.typing.show(bytes)}'`);
      }
      this.ctx.tables.fileCalls.add(e);
      return { type: this.ctx.tables.typing.leafFuture(reading ? "readFile" : "writeFile", "void", this.ioError()), what: `'${callee.name}'` };
    }
    // The blocking calls node:fs is written over, as `fileReadSync(path)`, run on the calling
    // thread.
    const sync = callee.kind === "ident" && (inStd || stdModuleAt(this.ctx.tables.files, e.start) !== undefined) ? syncFileSignatures(this.ctx.tables.typing)[callee.name] : undefined;
    if (sync) {
      const [params, returns, throws] = sync;
      const name = (callee as Extract<Expr, { kind: "ident" }>).name;
      if (e.args.length !== params.length) throw new CompileError("E0504", `'${name}' takes ${params.length} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
      e.args.forEach((a, i) => {
        const t = this.value(a);
        this.coerce(a, t, params[i]!, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(params[i]!)}'`);
      });
      if (throws) this.ctx.raise(e, this.ioError(), `'${name}'`);
      this.ctx.tables.syncFileCalls.set(e, name);
      return { type: returns, what: `'${name}'` };
    }
    // The std's timers: `timerSet(callback, ms, repeat, loop)` hands a callable to the runtime,
    // starting the timer task `loop` once; `timerNext()` waits for the next one due, and
    // `timerClear(id)` drops one.
    if (callee.kind === "ident" && (inStd || this.ctx.tables.timerSets.has(e)) && (callee.name === "timerSet" || callee.name === "timerNext" || callee.name === "timerClear")) {
      this.ctx.tables.timerCalls.set(e, callee.name);
      if (callee.name === "timerNext") return { type: this.ctx.tables.typing.leafFuture("timerNext", this.ctx.tables.typing.timerCallback()), what: "'timerNext'" };
      if (callee.name === "timerClear") {
        this.coerce(e.args[0]!, this.value(e.args[0]!), "i64", "a timer's id is an 'i64'");
        return { type: "void", what: "'timerClear'" };
      }
      this.expect(e.args[0]!, this.ctx.tables.typing.timerCallback());
      this.coerce(e.args[0]!, this.value(e.args[0]!), this.ctx.tables.typing.timerCallback(), "a timer runs an async function");
      const delay = this.value(e.args[1]!);
      this.coerce(e.args[1]!, delay, "i64", `a delay is milliseconds as an 'i64', not '${this.ctx.tables.typing.show(delay)}'`);
      this.coerce(e.args[2]!, this.value(e.args[2]!), "boolean", "whether it repeats is a 'boolean'");
      this.value(e.args[3]!);
      return { type: "i64", what: "'timerSet'" };
    }
    if (callee.kind === "ident" && callee.name === "jsEvaluate" && stdModuleAt(this.ctx.tables.files, e.start) === "fish:engine") {
      this.coerce(e.args[0]!, this.value(e.args[0]!), "string", "a module's source is a 'string'");
      this.ctx.tables.jsEvaluations.add(e);
      return { type: this.ctx.tables.typing.blockType("JsValue"), what: "'jsEvaluate'" };
    }
    // `yieldNow()`: a future that is pending once, letting other tasks run.
    if (callee.kind === "ident" && callee.name === "yieldNow" && (!this.ctx.byName.has("yieldNow") || inStd)) {
      if (e.args.length > 0) throw new CompileError("E0504", "'yieldNow' takes no arguments", e.start, e.end);
      return { type: YIELD_NOW, what: "'yieldNow'" };
    }
    // `cString(s)`: a pointer to a NUL-terminated copy of `s` for C, which the enclosing block
    // owns and frees when it ends.
    if (callee.kind === "ident" && callee.name === "cString" && !this.ctx.byName.has("cString")) {
      if (e.args.length !== 1) throw new CompileError("E1006", "'cString' takes 1 argument", e.start, e.end);
      if (this.ctx.generator) throw unsupported("'cString' inside generators", callee);
      if (this.ctx.async) throw unsupported("'cString' inside async functions", callee);
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, "string", `'cString' takes a string, not '${this.ctx.tables.typing.show(t)}'`);
      return { type: this.ctx.tables.typing.pointerType("u8", false), what: "'cString'" };
    }
    // `fromCString(p)`: a new string from a C string's bytes, read up to its NUL.
    if (callee.kind === "ident" && callee.name === "fromCString" && !this.ctx.byName.has("fromCString")) {
      this.needsUnsafe("'fromCString'", callee);
      if (e.args.length !== 1) throw new CompileError("E1006", "'fromCString' takes 1 argument", e.start, e.end);
      const want = this.ctx.tables.typing.pointerType("u8", false);
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, want, `'fromCString' takes a 'Ptr<u8>', not '${this.ctx.tables.typing.show(t)}'`);
      return { type: "string", what: "'fromCString'" };
    }
    // The time as an HTTP Date header gives it, for the std HTTP server alone.
    if (callee.kind === "ident" && callee.name === "httpDate" && e.start >= STD_BASE && e.args.length === 0) return { type: "string", what: "'httpDate'" };
    // Removes serve's socket file once it stops listening.
    if (callee.kind === "ident" && callee.name === "unixUnlink" && e.start >= STD_BASE && e.args.length === 1) {
      this.value(e.args[0]!);
      return { type: "void", what: "'unixUnlink'" };
    }
    // Milliseconds on a clock that only goes forward, for the std HTTP server's deadlines.
    if (callee.kind === "ident" && callee.name === "nowMs" && e.start >= STD_BASE && e.args.length === 0) return { type: "i64", what: "'nowMs'" };
    // The signal the first SIGINT or SIGTERM aborts, for node:process's 'shutdown' and the HTTP server.
    if (callee.kind === "ident" && callee.name === "shutdownSignal" && (e.start >= STD_BASE || stdModuleAt(this.ctx.tables.files, e.start) !== undefined) && e.args.length === 0) return { type: this.ctx.tables.typing.blockType("AbortSignal"), what: "'shutdownSignal'" };
    // The UTF-8 conversions behind the prelude's TextEncoder and TextDecoder, which only they call.
    if (callee.kind === "ident" && (callee.name === "utf8Encode" || callee.name === "utf8Decode") && this.ctx.owner !== undefined && this.ctx.tables.typing.rec(this.ctx.owner).name === (callee.name === "utf8Encode" ? "TextEncoder" : "TextDecoder")) {
      this.value(e.args[0]!);
      return { type: callee.name === "utf8Encode" ? this.ctx.tables.typing.arrayType("u8") : "string", what: `'${callee.name}'` };
    }
    // `nullPtr<T>()`: a pointer to nothing, which may be used as either kind.
    if (callee.kind === "ident" && callee.name === "nullPtr" && !this.ctx.byName.has("nullPtr")) {
      this.needsUnsafe("'nullPtr'", callee);
      if (e.typeArgs.length !== 1 || e.args.length > 0) throw new CompileError("E1006", "'nullPtr' takes the type it points to, like 'nullPtr<u8>()'", e.start, e.end);
      return { type: this.ctx.tables.typing.pointerType(this.ctx.resolveType(e.typeArgs[0]!), true), what: "'nullPtr'" };
    }
    // `BigInt(x)`: an integer of any size as a bigint. A float is refused rather than checked
    // for a fraction while the program runs.
    if (callee.kind === "ident" && callee.name === "BigInt" && !this.ctx.byName.has("BigInt")) {
      if (e.args.length !== 1) throw new CompileError("E0504", "'BigInt' takes 1 argument", e.start, e.end);
      const t = this.operand(e.args[0]!);
      if (t !== "bigint" && !isInteger(t)) throw new CompileError("E0504", `'BigInt' takes an integer, not '${this.ctx.tables.typing.show(t)}'${isFloat(t) ? "; convert the float with 'as i64' first" : ""}`, e.args[0]!.start, e.args[0]!.end);
      return { type: "bigint", what: "'BigInt'" };
    }
    // `String(x)`: a string, number or boolean written as JavaScript writes it.
    if (callee.kind === "ident" && callee.name === "String" && (!this.ctx.byName.has("String") || inStd)) {
      if (e.args.length !== 1) throw new CompileError("E0504", "'String' takes 1 argument", e.start, e.end);
      this.joined(e.args[0]!, this.operand(e.args[0]!), "'String'");
      return { type: "string", what: "'String'" };
    }
    const found = lifted ?? (callee.kind === "ident" ? this.bodyNamed(callee.name) : callee.kind === "member" ? this.method(callee, receiver) : undefined);
    return this.calleeFound(e, found?.bodyId);
  }

  /** @throws {CompileError} */
  private calleeFound(this: Mut<this>, e: Ref<Call>, foundId: BodyId | undefined): { type: Type; what: string } {
    const callee = e.callee;
    const found = this.ctx.tables.arenas.bodyOf(foundId);
    // A package's function declared with several signatures is checked against the first that
    // takes the arguments, as TypeScript picks one.
    const targetId = this.targetFor(e, foundId);
    const target = this.ctx.tables.arenas.bodyOf(targetId);
    // A package's const is a value; one holding a function would be a function crossing from JS.
    if (target !== undefined && target.js?.const === true) {
      const held = this.ctx.resolveType(target.returnType!);
      const kind = this.recOf(held)?.kind;
      const callable = kind === "function" || kind === "closure" || this.boundFunction(held) !== undefined;
      throw new CompileError(callable ? "E1005" : "E0503", callable ? `'${target.js.name}' from '${target.js.module}' holds a function, and functions crossing between Fish and JS aren't supported yet` : `this expression is not callable: type '${this.ctx.tables.typing.show(this.ctx.tables.typing.jsView(held))}' has no call signatures`, e.start, e.end);
    }
    if (target !== undefined && target.name.replace(/-fsh\d+$/, "") === "ok" && stdModuleAt(this.ctx.tables.files, target.start) === "node:assert") return this.assertion(e);
    // node:util's functions that take any values, as Node's do, given their meaning here.
    const util = target !== undefined && callee.kind === "ident" && stdModuleAt(this.ctx.tables.files, target.start) === "node:util" ? target.name.replace(/-fsh\d+$/, "") : undefined;
    if (util === "format") {
      if (e.optional) throw new CompileError("E0505", "'format' is always there, so it is called without '?.'", e.start, e.end);
      this.refuseSpread(e.args);
      this.shown(e.args);
      this.unformattable(e.args);
      this.ctx.tables.formatCalls.add(e);
      return { type: "string", what: "'format'" };
    }
    if (util === "inspect") {
      if (e.args.length !== 1 || e.args[0]!.kind === "spread") throw new CompileError(e.args.length > 1 ? "E0801" : "E0504", e.args.length > 1 ? "'inspect' takes the value alone; its options aren't supported yet" : "'inspect' takes 1 argument", e.start, e.end);
      this.shown(e.args);
      this.ctx.tables.inspectCalls.add(e);
      return { type: "string", what: "'inspect'" };
    }
    // `parseArgs(config)` calls std's port with the arguments its literal says, once.
    if (util === "parseArgs" && !this.ctx.tables.parsedArgs.has(e)) {
      if (e.optional) throw new CompileError("E0505", "'parseArgs' is always there, so it is called without '?.'", e.start, e.end);
      this.refuseSpread(e.args);
      const made = this.ctx.tables.rewrites.replace(e, withArgs(e, parseArgsArgs(this.ctx.tables.ids, e)));
      this.ctx.tables.parsedArgs.add(cloneExpr(made));
      if (made.kind === "call") return this.calleeUtil(made, target?.bodyId, util);
    }
    return this.calleeUtil(e, target?.bodyId, util);
  }

  // A package's function declared with several signatures is checked against the first that
  // takes the arguments, as TypeScript picks one; an overloaded function against its overloads.
  /** @throws {CompileError} */
  private targetFor(this: Mut<this>, e: Ref<Call>, foundId: BodyId | undefined): BodyId | undefined {
    if (foundId === undefined) return undefined;
    if (this.ctx.tables.arenas.bodyOf(foundId).js?.overloads !== undefined) return this.jsOverload(e, this.ctx.tables.arenas.bodyOf(foundId)).bodyId;
    if (this.ctx.tables.arenas.bodyOf(foundId).overloads !== undefined && e.implementation !== true) return this.overload(e, this.ctx.tables.arenas.bodyOf(foundId)).bodyId;
    return foundId;
  }

  /** @throws {CompileError} */
  private calleeUtil(this: Mut<this>, e: Ref<Call>, targetId: BodyId | undefined, util: string | undefined): { type: Type; what: string } {
    const callee = e.callee;
    const target = this.ctx.tables.arenas.bodyOf(targetId);
    // Fish's value equality, which `===` already is.
    if (util === "isDeepStrictEqual") {
      if (e.args.length !== 2) throw new CompileError("E0504", "'isDeepStrictEqual' takes 2 arguments", e.start, e.end);
      this.refuseSpread(e.args);
      const [left, right] = e.args as [Expr, Expr];
      const equality = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "binary", op: "===", left, right, start: e.start, end: e.end });
      this.ctx.tables.deepEqualities.add(equality);
      return { type: this.value(equality), what: "'isDeepStrictEqual'" };
    }
    if (target && (target as { macro?: boolean }).macro) throw new CompileError("E0503", `'${target.name}' is a macro, applied to a declaration as '@${target.name}'; it isn't called as a function`, e.start, e.end);
    // The prelude holds std's TLS helper, so a program would otherwise reach it; only std calls it.
    const stdOnly = callee.kind === "ident" && callee.name === "__tlsClient" && e.start < STD_BASE && stdModuleAt(this.ctx.tables.files, e.start) === undefined;
    if (!target || stdOnly) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      if (callee.kind === "ident" && this.ctx.byName.has(`const ${callee.name}`)) throw new CompileError("E0801", `'${callee.name}' is a top-level const, and calling a function value one holds isn't supported yet; write its value as an arrow, as in 'const ${callee.name} = (x: i64) => ...', or declare it with 'function'`, callee.start, callee.end);
      throw new CompileError("E0401", `unknown function ${name}${callee.kind === "ident" ? didYouMean(callee.name, this.ctx.names(callee.start)) : ""}`, callee.start, callee.end);
    }
    if (target.foreign && !target.rust) this.needsUnsafe(`calling the C function '${target.name}'`, callee, "the compiler can't check what C code does");
    if (target.js) this.ctx.tables.jsCalls.set(e, target.js);
    if (target.params.length > 0 && target.params[target.params.length - 1]!.rest && !this.ctx.tables.tagCalls.has(e)) {
      const packed = this.packRest(e, e.args, target.params);
      if (packed !== undefined && packed.kind === "call") return this.calleeArgs(packed, target.bodyId);
    } else this.refuseSpread(e.args);
    return this.calleeArgs(e, target.bodyId);
  }

  /** @throws {CompileError} */
  private calleeArgs(this: Mut<this>, e: Ref<Call>, targetId: BodyId): { type: Type; what: string } {
    this.expectFrom(targetId, e.args);
    // An arrow given to a generic body is checked once the other arguments decide its types.
    let given: (Type | undefined)[] = [];
    for (const a of e.args) given.push(this.isArrowNow(a) ? undefined : this.value(a));
    const bounds = this.ctx.implicitOf(targetId);
    for (let i: usize = 0; i < e.args.length; i++) {
      // A function named as a value became an arrow as it was checked.
      if (!this.isArrowNow(e.args[i]!)) continue;
      // A generic function type's parameter takes the arrow as the family it is.
      const r = this.recOf(bounds.get(i));
      const want = r?.kind === "function" && r.generic !== undefined ? undefined : this.ctx.callbackType(targetId, e.typeArgs, given.slice(), i, e);
      given[i] = this.arrowArg(e.args[i]!, want);
    }
    let argTypes: Type[] = [];
    for (const t of given) argTypes.push(t!);
    const target = { name: this.ctx.tables.arenas.bodyOf(targetId).name, js: this.ctx.tables.arenas.bodyOf(targetId).js !== undefined, async: this.ctx.tables.arenas.bodyOf(targetId).async === true, generator: this.ctx.tables.arenas.bodyOf(targetId).generator === true };
    // The array iterators clone elements: a generic body's instance checks the real element.
    if ((target.name === "array entries" || target.name === "array values") && argTypes.length > 0) {
      const array = this.ctx.tables.typing.lower(this.isRefType(argTypes[0]!) ? this.ctx.tables.typing.rec(argTypes[0] as RefType).to : argTypes[0]!);
      if (this.isArray(array)) this.clonable(this.ctx.tables.typing.rec(array as ArrayType).element, e, target.name.slice("array ".length as i64));
    }
    if (target.js) this.ctx.tables.jsCrossings.add(cloneExpr(e));
    if (target.js && !this.ctx.tables.jsCalledAt.has(targetId)) this.ctx.tables.jsCalledAt.set(targetId, cloneExpr(e));
    // Its declaration was refused before a call reached it: this call is where that counts.
    let refused = target.js ? this.ctx.tables.typing.jsUncalled.get(this.ctx.tables.arenas.bodyOf(targetId)) : undefined;
    if (refused !== undefined) {
      if (refused.note === undefined) refused.note = { message: `'${this.ctx.tables.arenas.bodyOf(targetId).js!.name}' is called here`, start: e.start, end: e.end };
      throw refused;
    }
    const instance = this.ctx.instantiate(targetId, e.typeArgs, e.args, argTypes.slice(), e);
    this.args(e.args, argTypes, instance, e);
    this.ctx.calls.set(cloneExpr(e), instance);
    if (target.js) for (const a of e.args) this.givenToJs(a, this.ctx.types.get(a)!);
    // An async function's call only makes its future; its error comes at the `await`.
    // The error a call raises is the implementation's own, since that is what it gives, or what
    // an abstract declaration says it may.
    const declared = e.callee.kind === "member" ? this.abstractDeclaration(e.callee, "methods")?.bodyId : undefined;
    const error = this.ctx.errorOf(instance) ?? (declared !== undefined ? this.ctx.errorOf(this.ctx.instanceOf(declared, undefined)) : undefined);
    if (error !== undefined && !target.async && !target.generator) this.ctx.raise(e, error, `'${target.name}'`);
    const type = this.ctx.resultOf(declared !== undefined ? this.ctx.instanceOf(declared, undefined) : instance, e);
    // A returned reference borrows what its lifetime says; a value holding references, what
    // was lent to the call, its receiver included.
    if (this.ctx.tables.typing.holdsRef(type)) {
      const lent = this.lent(e.args);
      const self = bodyOf(this.ctx.tables.arenas, this.inst(instance)).self !== undefined;
      const sources = e.callee.kind === "member" && self ? this.ctx.sourcesOf(instance, e.args, e.callee.object, e, lent) : this.ctx.sourcesOf(instance, e.args, undefined, e, lent);
      this.ctx.borrowsFrom.set(cloneExpr(e), sources);
    }
    return { type, what: `'${target.name}'` };
  }

  // Whether an expression, as checking has it so far, is an arrow.
  private isArrowNow(this: Mut<this>, e: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(e);
    return now !== undefined ? now.kind === "arrow" : e.kind === "arrow";
  }

  // An arrow argument's type, checked against the callback type it is given for, if any.
  /** @throws {CompileError} */
  private arrowArg(this: Mut<this>, written: Ref<Expr>, want: FunctionType | undefined): Type {
    const now = this.ctx.tables.rewrites.rewritten(written);
    if (now !== undefined) return this.arrowArgNow(now, want);
    return this.arrowArgNow(written, want);
  }
  /** @throws {CompileError} */
  private arrowArgNow(this: Mut<this>, a: Ref<Expr>, want: FunctionType | undefined): Type {
    if (want !== undefined) this.expect(a, want);
    return this.value(a);
  }

  // Whether a tagged template is a quote rather than a call of a tag the program declares.
  private isQuote(this: Mut<this>, e: Ref<Extract<Expr, { kind: "tagged" }>>): boolean {
    return e.tag.kind === "ident" && (e.tag.name === "quote" || e.tag.name === "quoteType") && (this.ctx.lookup(e.tag.name, undefined) === undefined) && !this.ctx.byName.has(e.tag.name);
  }

  // `` quote`a + ${x}` ``: the Ast value of the text, an expression's or a statement's, and of
  // `quoteType`, a type's; each splice takes a node of the category its place holds.
  /** @throws {CompileError} */
  private quote(this: Mut<this>, e: Ref<Extract<Expr, { kind: "tagged" }>>, asType: boolean): Type {
    if (e.typeArgs.length > 0) throw new CompileError("E1105", "a quote takes no type arguments", e.start, e.end);
    let q = quoted(this.ctx.tables, e, asType);
    q.asExpressions.clear();
    q.names.clear();
    const astExpr = this.astType("AstExpr", e);
    const astStmt = this.astType("AstStmt", e);
    const astType = this.astType("AstType", e);
    const types: Record<Category, Type> = { AstExpr: astExpr, AstStmt: astStmt, AstType: astType };
    const categories = holesOf(this.ctx.tables.typing, q, types, { start: e.start, end: e.end });
    for (let i: usize = 0; i < categories.length; i++) {
      let category = categories[i]!;
      const t = this.value(q.holes[i]!);
      // An expression where a statement goes is the statement `e;`.
      if (category === "AstStmt" && !this.ctx.tables.typing.fits(t, astStmt) && this.ctx.tables.typing.fits(t, astExpr)) {
        q.asExpressions.add(i);
        category = "AstExpr";
      }
      const wanted = category === "AstExpr" ? astExpr : category === "AstStmt" ? astStmt : astType;
      this.coerce(q.holes[i]!, t, wanted, `a splice where ${category === "AstExpr" ? "an expression" : category === "AstStmt" ? "a statement" : "a type"} goes takes an '${category}', not '${this.ctx.tables.typing.show(t)}'`);
    }
    this.ctx.tables.quotes.set(cloneExpr(e), { AstExpr: astExpr, AstStmt: astStmt, AstType: astType });
    return q.category === "AstExpr" ? astExpr : q.category === "AstStmt" ? astStmt : astType;
  }

  // One of the Ast types a quote's splices take, as std declares it.
  /** @throws {CompileError} */
  private astType(this: Mut<this>, name: Category, at: Ref<Span>): Type {
    return this.ctx.resolveType({ id: nextId(this.ctx.tables.ids), kind: "ref", name, args: [], start: at.start, end: at.end });
  }

  // `` tag`a ${x} b` `` calls the tag with the template's text, known while compiling, then an
  // array of its values for the tag's rest parameter.
  /** @throws {CompileError} */
  private untag(this: Mut<this>, e: Ref<Extract<Expr, { kind: "tagged" }>>): Expr {
    if (e.tag.kind === "member" && e.tag.name === "raw" && this.isString(e.tag.object)) {
      if (e.typeArgs.length > 0) throw new CompileError("E0106", "'String.raw' takes no type arguments", e.start, e.end);
      if (e.template.kind !== "template") throw new CompileError("E1107", "a tag is followed by a template literal", e.template.start, e.template.end);
      return this.ctx.tables.rewrites.replace(e, rawTemplate(e.template.raw, e.template.exprs, { start: e.start, end: e.end }));
    }
    const target = e.tag.kind === "ident" && (this.ctx.lookup(e.tag.name, undefined) === undefined) ? this.bodyNamed(e.tag.name) : undefined;
    if (e.tag.kind === "ident" && target === undefined && (this.ctx.lookup(e.tag.name, undefined) === undefined)) throw new CompileError("E0401", `unknown function '${e.tag.name}'${didYouMean(e.tag.name, this.ctx.names(e.tag.start))}`, e.tag.start, e.tag.end);
    if (target === undefined || e.tag.kind !== "ident") throw new CompileError("E1107", "a tag has to be the name of a top-level function; methods, closures and other values as tags aren't supported yet", e.tag.start, e.tag.end);
    const shape = `'comptime strings: TemplateStringsArray, ...values: T[]'`;
    if (!tagStrings(target.params[0])) {
      throw new CompileError("E1107", `'${e.tag.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, e.tag.start, e.tag.end);
    }
    if (target.params.length !== 2 || !target.params[1]!.rest) throw new CompileError("E1107", `'${e.tag.name}' can't be a tag: a tag takes ${shape}`, e.tag.start, e.tag.end);
    if (e.template.kind !== "template") throw new CompileError("E1107", "a tag is followed by a template literal", e.template.start, e.template.end);
    const at = { start: e.template.start, end: e.template.end };
    const stringsId = nextId(this.ctx.tables.ids);
    let texts: Elements = [];
    for (const value of e.template.quasis) texts.push({ id: nextId(this.ctx.tables.ids), kind: "string", value, start: at.start, end: at.end });
    const strings: Expr = { id: stringsId, kind: "array", elements: texts, start: at.start, end: at.end };
    let given: Elements = [];
    for (const x of e.template.exprs) given.push(cloneExpr(x));
    const values: Expr = { id: nextId(this.ctx.tables.ids), kind: "array", elements: given, start: at.start, end: at.end };
    const called = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "call", callee: cloneExpr(e.tag), typeArgs: cloneTypeNodes(e.typeArgs), args: [strings, values], optional: false, start: e.start, end: e.end });
    this.ctx.tables.tagCalls.add(cloneExpr(called));
    return called;
  }

  // Whether `e` names the global `String`, which nothing in the program shadows.
  private isString(this: Mut<this>, e: Ref<Expr>): boolean {
    return e.kind === "ident" && e.name === "String" && (this.ctx.lookup("String", undefined) === undefined) && !this.ctx.classes.has("String") && !this.ctx.byName.has("String") && !this.ctx.byName.has("const String") && !this.ctx.enums.has("String");
  }

  // An arrow passed where a function type is declared takes its parameter types from it.
  /** @throws {CompileError} */
  private expectFrom(this: Mut<this>, target: BodyId, list: Ref<Expr[]>): void {
    const bounds = this.ctx.implicitOf(target);
    const f = this.ctx.tables.arenas.bodyOf(target);
    let generic = (f.typeParams?.length ?? 0) > 0 || (f.scope?.size ?? 0) > 0 || bounds.size > 0;
    for (const p of f.params) if (p.comptime) generic = true;
    const known: Type[] = generic ? [] : this.ctx.paramTypes(this.ctx.instanceOf(target, undefined));
    for (let i: usize = 0; i < list.length; i++) this.expectArg(target, list[i]!, i, bounds, known, !generic);
  }

  // What `expectFrom` expects of the argument at `i`.
  /** @throws {CompileError} */
  private expectArg(this: Mut<this>, target: BodyId, a: Ref<Expr>, i: usize, bounds: Ref<Map<usize, Bound>>, known: Ref<Type[]>, isKnown: boolean): void {
    const js = this.ctx.tables.arenas.bodyOf(target).js !== undefined;
    const t = bounds.get(i);
    const r = this.recOf(t);
    if (r?.kind === "function") {
      const want = js ? this.ctx.tables.typing.jsTakes(t as FunctionType) : t!;
      this.expect(a, want);
    }
    // A `new Promise` given for a `Promise<T>` parameter takes its T from there.
    if (r?.kind === "interface" && this.ctx.tables.typing.promiseElement(t as InterfaceType) !== undefined) this.expect(a, t as InterfaceType);
    // An arrow in an object literal given for an object-typed parameter takes its field's type,
    // and a value for a Dyn field is boxed into it.
    if (t !== undefined && r?.kind === "object" && a.kind === "object") {
      for (const p of a.props) {
        if (p.kind !== "property") continue;
        const declared = this.ctx.tables.typing.field(t as ObjectType, keyText(p.key))?.type;
        const boxes = declared !== undefined && this.boxedIn(declared) !== undefined;
        const dict = p.value.kind === "object" && declared !== undefined && (this.dictOf(declared) !== undefined || this.optionalDict(declared) !== undefined);
        if (declared !== undefined && (p.value.kind === "arrow" || boxes || dict)) this.expect(p.value, declared);
      }
    }
    // A parameter of a function that isn't generic has its type before the call; an arrow
    // given to a package is a callback JS keeps, so it owns what it captures.
    const param = isKnown && i < known.length ? known[i] : undefined;
    if (a.kind !== "arrow" && param !== undefined) {
      const want = js ? this.ctx.tables.typing.jsTakes(param) : param;
      this.expect(a, want);
    }
    if (a.kind === "arrow" && param !== undefined && js) {
      const want = this.ctx.tables.typing.jsTakes(param);
      this.expect(a, want);
    }
    // A literal for a tuple parameter is a tuple of its parts, in the parameter's shape.
    if (!isKnown && (a.kind === "array" || this.ctx.tables.tupleLiterals.has(a))) {
      const params = this.ctx.tables.arenas.bodyOf(target).params;
      if (i < params.length) {
        const written = params[i]!.type;
        if (written !== undefined) this.expectShaped(a, written);
      }
    }
  }

  // A literal given for a parameter written as a tuple, `readonly` or not, takes its shape.
  private expectShaped(this: Mut<this>, a: Ref<Expr>, written: Ref<TypeNode>): void {
    if (written.kind === "operator" && written.op === "readonly") {
      this.expectShaped(a, written.type);
      return;
    }
    if (written.kind !== "tuple") return;
    this.ctx.exprsState.shaped.add(cloneExpr(a));
    let odd = false;
    for (const n of written.elements) if (n.optional || n.rest) odd = true;
    if (odd) this.ctx.exprsState.shapedBy.set(cloneExpr(a), { id: written.id, kind: "tuple", elements: cloneElements(written.elements), start: written.start, end: written.end });
  }

  // A call gives every parameter but the optional ones it leaves out, which come last.
  /** @throws {CompileError} */
  private arity(given: usize, params: Ref<Param[]>, at: Ref<Span>) {
    // A rest parameter's array is packed from what follows the others, when they are all given.
    let required: usize = 0;
    for (const p of params) if (!p.optional && !p.rest) required++;
    if (params.length > 0 && params[params.length - 1]!.rest && given + 1 < params.length) {
      if (given < required) throw new CompileError("E0501", `expected at least ${required} argument${required === 1 ? "" : "s"}, but got ${given}`, at.start, at.end);
    }
    if (given >= required && given <= params.length) return;
    const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
    throw new CompileError("E0501", `expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${given}`, at.start, at.end);
  }

  // A callback given as a declared function's name becomes the closure calling it. A local
  // function given by name isn't converted yet.
  /** @throws {CompileError} */
  private namedFunction(this: Mut<this>, callback: Ref<Expr>): Expr | undefined {
    if (callback.kind !== "ident") return undefined;
    const local = this.ctx.lookup(callback.name, undefined);
    if (local !== undefined) {
      const written = this.lc(local).type;
      const held = this.ctx.tables.typing.lower(written);
      const kind = this.recOf(held)?.kind;
      if (kind === "closure" || kind === "function" || this.isCallable(held) || this.boundFunction(held) !== undefined) {
        throw new CompileError("E0801", `a local function passed by name isn't supported yet; write an arrow calling it, as in '(x) => ${callback.name}(x)'`, callback.start, callback.end);
      }
      return undefined;
    }
    const declared = this.bodyNamed(callback.name);
    return declared !== undefined && declared.comptime === undefined ? this.functionValue(callback, declared.bodyId) : undefined;
  }

  // A call through a generic function type, in a body checked before it knows the function: its
  // type parameters are inferred from the arguments, or written, and its signature resolved
  // with them.
  /** @throws {CompileError} */
  private familyCall(this: Mut<this>, e: Ref<Call>, type: Pick<FunctionRecord, "generic">, name: string): { type: Type; throws: Type | undefined; what: string } {
    const { names, node: written, scope } = type.generic!;
    if (e.args.length !== written.params.length) throw new CompileError("E0501", `expected ${written.params.length} argument${written.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    let argTypes: Type[] = [];
    for (const a of e.args) argTypes.push(this.value(a));
    let bindings = new Map<string, Type>();
    if (e.typeArgs.length > 0) {
      if (e.typeArgs.length !== names.length) throw new CompileError("E0106", `expected ${names.length} type argument${names.length === 1 ? "" : "s"}, but got ${e.typeArgs.length}`, e.start, e.end);
      for (let i: usize = 0; i < names.length; i++) bindings.set(names[i]!, this.ctx.resolveType(e.typeArgs[i]!));
    } else {
      for (let i: usize = 0; i < written.params.length; i++) {
        const p = written.params[i]!;
        if (p.type !== undefined) infer(this.ctx.tables, this.ctx.decls, p.type, argTypes[i]!, new Set(names), bindings, { start: e.args[i]!.start, end: e.args[i]!.end });
      }
    }
    for (let i: usize = 0; i < names.length; i++) {
      const n = names[i]!;
      const bound = bindings.get(n);
      if ((bound === undefined)) throw new CompileError("E0104", `can't infer a type for '${n}' in this call of ${name}; pass it, as in '${(e.callee as { name?: string }).name ?? "f"}<i64>(...)'`, e.start, e.end);
      const constraint = written.typeParams[i]!.constraint;
      if (constraint !== undefined) {
        const limit = this.ctx.resolveWith(constraint, joinedScope(scope, bindings));
        const reason = typeof limit !== "string" && this.ctx.tables.typing.rec(limit).kind === "interface" ? unsatisfied(bound, limit as InterfaceType, this.ctx.members(), e) : this.ctx.tables.typing.fits(bound, limit) ? undefined : `'${this.ctx.tables.typing.show(bound)}' is not a '${this.ctx.tables.typing.show(limit)}'`;
        if (reason !== undefined) throw new CompileError("E0107", `type '${this.ctx.tables.typing.show(bound)}' does not satisfy the constraint '${this.ctx.tables.typing.show(limit)}' of '${n}' in ${name}: ${reason}`, e.start, e.end);
      }
    }
    for (let i: usize = 0; i < e.args.length; i++) {
      const declared = this.ctx.resolveWith(written.params[i]!.type!, joinedScope(scope, bindings));
      // An optional parameter is an Option, as a call may leave it empty.
      const want = written.params[i]!.optional ? this.ctx.tables.typing.unionType([declared, "null"]) : declared;
      this.coerce(e.args[i]!, argTypes[i]!, want, `argument of type '${this.ctx.tables.typing.show(argTypes[i]!)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(want)}'`);
    }
    const full = joinedScope(scope, bindings);
    const returns = this.ctx.resolveWith(written.returns, full);
    const throws = written.throws !== undefined ? this.ctx.resolveWith(written.throws, full) : undefined;
    return { type: returns, throws, what: name };
  }

  // A generic function value, or a generic arrow, rewritten as an arrow calling it with its
  // arguments: given a function type, its parameters take that type's, and the call inside
  // infers the generic function's types from them.
  /** @throws {CompileError} */
  private instanceArrow(this: Mut<this>, e: Ref<Expr>): Expr | undefined {
    if (e.kind === "arrow" && e.typeParams.some((p) => !isLifetime(p))) {
      const lifted = this.ctx.liftArrow(e);
      return this.identArrow(lifted) ?? lifted;
    }
    return this.identArrow(e);
  }
  /** @throws {CompileError} */
  private identArrow(this: Mut<this>, e: Ref<Expr>): Expr | undefined {
    if (e.kind !== "ident") return undefined;
    const local = this.ctx.lookup(e.name, undefined);
    const written = local === undefined ? undefined : this.lc(local).type;
    const held = this.heldBy(written);
    const r = this.recOf(held);
    let name: string | undefined = local !== undefined ? this.ctx.tables.arenas.bodyOf(this.lc(local).generic)?.name : undefined;
    if (name === undefined && r?.kind === "closure") name = r.generic;
    if (name === undefined && local === undefined && genericIn(this.bodyNamed(e.name))) name = e.name;
    const f = name === undefined ? undefined : this.bodyNamed(name);
    if (f === undefined) return undefined;
    const at = { start: e.start, end: e.end };
    const odd = f.params.find((p) => this.ctx.tables.defaulted.has(p) || p.comptime || p.rest);
    if ((odd !== undefined)) throw unsupported(odd.comptime ? "generic functions with comptime parameters used as values" : odd.rest ? "generic functions with rest parameters used as values" : "generic functions with defaulted parameters used as values", e);
    // Its parameters keep the names it declares, unless one would hide it.
    const names = f.params.map((p, i) => (p.pattern.kind === "ident" && p.pattern.name !== name ? p.pattern.name : `arg${i}`));
    const params: Param[] = names.map((n): Param => ({ ...at, id: nextId(this.ctx.tables.ids), pattern: { id: nextId(this.ctx.tables.ids), kind: "ident", name: n, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false }));
    const call: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: name!, ...at }, typeArgs: [], args: names.map((n): Expr => ({ id: nextId(this.ctx.tables.ids), kind: "ident", name: n, ...at })), optional: false, ...at };
    const arrow = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call, ...at });
    this.ctx.tables.madeArrows.add(cloneExpr(arrow));
    return arrow;
  }

  // The Dyn of an interface a value meeting `t` is boxed into: `t` itself, or the one in an
  // Option, as an optional field's.
  private boxedIn(t: Type): DynType | undefined {
    const dyn = (u: Type) => {
      const r = this.recOf(u);
      return r?.kind === "dyn" && !this.ctx.tables.typing.callableOf.has(r.of) && this.ctx.tables.typing.promiseElement(r.of) === undefined;
    };
    if (dyn(t)) return t as DynType;
    const r = this.recOf(t);
    if (r?.kind === "union" && r.members.length === 2 && r.members.includes("null")) {
      const other = r.members.find((m) => m !== "null")!;
      return dyn(other) ? (other as DynType) : undefined;
    }
    return undefined;
  }

  // A generic function named as a value: its own type, each call of which instantiates it.
  /** @throws {CompileError} */
  private genericValue(this: Mut<this>, f: Ref<Body>, e: Ref<Expr>): Type {
    if ((f.foreign === true)) throw unsupported(`${(f.rust !== undefined) ? "Rust" : "C"} functions used as values`, e);
    return this.ctx.tables.typing.genericFunctionType(f.name, "a generic function");
  }

  // The generic function a generic function value names, when the callee is a local or a field
  // holding one; read for nothing else, it is called directly, in this instance.
  /** @throws {CompileError} */
  private genericTarget(this: Mut<this>, callee: Ref<Expr>, receiver: Type | undefined): Ref<Body> | undefined {
    let held: Type | undefined = undefined;
    if (callee.kind === "ident") {
      const localId = this.ctx.lookup(callee.name, undefined);
      const local = localId === undefined ? undefined : this.lc(localId);
      if ((local === undefined)) return undefined;
      held = local.type;
      this.ctx.locals.set(cloneExpr(callee), local.localId);
    } else if (callee.kind === "member" && this.pure(callee) && receiver !== undefined && (this.recOf(receiver)?.kind === "class" || this.recOf(receiver)?.kind === "object")) {
      if (this.ctx.tables.typing.rec(receiver as ClassType).kind === "class" && (this.inheritedOf(receiver as ClassType as ClassType, "methods", callee.name) !== undefined)) return undefined;
      held = this.ctx.tables.typing.field(receiver as ObjectType | ClassType as ClassType | ObjectType, callee.name)?.type;
      // A getter on the way runs code the direct call would skip.
      const t = this.heldBy(held);
      const r = this.recOf(t);
      if (r?.kind === "closure" && (r.generic !== undefined) && this.throughGetter(callee)) throw unsupported("calls of a generic function value read through a getter", callee);
    }
    if (held === undefined) return undefined;
    const t = this.heldBy(held)!;
    const r = this.recOf(t);
    return r?.kind === "closure" && (r.generic !== undefined) ? this.bodyNamed(r.generic) : undefined;
  }

  // A name or `this`, or fields read from one, which reading has no effect of its own unless a
  // getter is on the way.
  private pure(given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.pureNow(now) : this.pureNow(given);
  }
  private pureNow(e: Ref<Expr>): boolean {
    return e.kind === "ident" || e.kind === "this" || (e.kind === "member" && !e.optional && this.pure(e.object));
  }

  /** @throws {CompileError} */
  private throughGetter(this: Mut<this>, given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.throughGetterNow(now) : this.throughGetterNow(given);
  }
  /** @throws {CompileError} */
  private throughGetterNow(this: Mut<this>, e: Ref<Expr>): boolean {
    if (e.kind !== "member") return false;
    const object = this.ctx.types.get(e.object);
    const held = this.heldBy(object);
    const getter = this.recOf(held)?.kind === "class" && this.inheritedOf(held as ClassType, "getters", e.name) !== undefined;
    return getter || this.throughGetter(e.object);
  }

  // `double` named where a value is wanted becomes `(x) => double(x)`, its parameters and their
  // types its declaration's, capturing nothing, so it passes, stores and boxes as any closure.
  /** @throws {CompileError} */
  private functionValue(this: Mut<this>, e: Ref<Extract<Expr, { kind: "ident" }>>, fId: BodyId): Expr | undefined {
    const written = e.name;
    const f = this.ctx.tables.arenas.bodyOf(fId);
    // A generic one given as a callback is the instance the callback's types make.
    if (genericIn(f)) return this.instanceArrow(e);
    if (f.foreign === true) throw unsupported(`${f.rust !== undefined ? "Rust" : "C"} functions used as values`, e);
    // A package's function Fish couldn't type is refused where it is used as a value too.
    let refused = f.js !== undefined ? this.ctx.tables.typing.jsUncalled.get(f) : undefined;
    if (refused !== undefined) {
      if (refused.note === undefined) refused.note = { message: `'${f.js!.name}' is used here`, start: e.start, end: e.end };
      throw refused;
    }
    if (f.throws !== undefined) throw unsupported("functions that throw used as values", e);
    for (const p of f.params) {
      if (this.ctx.tables.defaulted.has(p) || p.comptime || p.rest) throw unsupported(p.comptime ? "functions with comptime parameters used as values" : p.rest ? "functions with rest parameters used as values" : "functions with defaulted parameters used as values", e);
    }
    // Typed where it is declared, so a type name means what it means there.
    // A function it takes is a stored callable, as a function type's parameters are.
    let types: Type[] = [];
    for (const t of this.ctx.paramTypes(this.ctx.instanceOf(fId, undefined))) {
      const bound = this.boundFunction(t);
      const fn = bound !== undefined ? bound : t;
      const r = this.recOf(fn);
      const stored = r?.kind === "function" && r.generic === undefined ? this.ctx.tables.typing.stored(fn as FunctionType) : t;
      if (this.recOf(stored)?.kind === "function" || this.recOf(stored)?.kind === "closure" || this.boundFunction(stored) !== undefined) throw unsupported("functions taking functions used as values", e);
      types.push(stored);
    }
    const at = { start: e.start, end: e.end };
    // A parameter keeps its name unless it would hide the function, or has none of its own.
    const declared = this.ctx.tables.arenas.bodyOf(fId);
    let names: string[] = [];
    let optional: boolean[] = [];
    for (let i: usize = 0; i < declared.params.length; i++) {
      const p = declared.params[i]!;
      names.push(p.pattern.kind === "ident" && p.pattern.name !== written && p.pattern.name !== declared.name ? p.pattern.name : `${written}-arg${i}`);
      optional.push(p.optional);
    }
    let clones: boolean[] = [];
    for (const t of types) clones.push(!this.ctx.tables.typing.isCopy(t));
    let params: Param[] = [];
    for (let i: usize = 0; i < names.length; i++) {
      const id = nextId(this.ctx.tables.ids);
      const p: Param = { start: at.start, end: at.end, id, pattern: { id: nextId(this.ctx.tables.ids), kind: "ident", name: names[i]!, start: at.start, end: at.end }, type: undefined, optional: optional[i]!, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false };
      this.ctx.tables.presetParams.set(cloneParam(p), types[i]!);
      this.ctx.tables.namedParams.set(cloneParam(p), { fn: written, names: names.slice(), clones: clones.slice() });
      params.push(p);
    }
    let args: Expr[] = [];
    for (const n of names) args.push({ id: nextId(this.ctx.tables.ids), kind: "ident", name: n, start: at.start, end: at.end });
    const callId = nextId(this.ctx.tables.ids);
    const call: Expr = { id: callId, kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: written, start: at.start, end: at.end }, typeArgs: [], args, optional: false, start: at.start, end: at.end };
    const arrow = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call, start: at.start, end: at.end });
    this.ctx.tables.madeArrows.add(cloneExpr(arrow));
    return arrow;
  }

  // The nested function a name calls, unless it is async, whose future holds what it uses. A
  // closure owning what it captures, async or `move`, takes the function as made where it is.
  private nestedFunction(this: Mut<this>, name: string): LocalId | undefined {
    if (this.ctx.owning) return undefined;
    const local = this.ctx.peek(name);
    return local !== undefined && this.ctx.nestedLocal(local) ? local : undefined;
  }

  // `name(...)` on a nested function builds its environment for the call from this body's
  // bindings for what it captures, so a closure calling it captures those, not the function,
  // and changes what the function changes.
  /** @throws {CompileError} */
  private nestedCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "ident" }>>, local: LocalId): { type: Type; what: string } {
    this.nestedEnv(e, local, callee);
    return this.closureCall(e, callee, this.lc(local).type);
  }

  // Records this body's bindings for what a nested function captures, captured if need be,
  // each changing where the function changes it.
  /** @throws {CompileError} */
  private nestedEnv(this: Mut<this>, e: Ref<Expr>, local: LocalId, at: Ref<Extract<Expr, { kind: "ident" }>>): void {
    const written = this.lc(local).type;
    const lowered = this.ctx.tables.typing.lower(written);
    const called = this.ctx.closureBody(lowered as ClosureType);
    const captures = [...this.inst(called).captures!.entries()];
    let env: LocalId[] = [];
    for (const [alias, id] of captures) {
      // A closure captures it here, where the variable is named only through the function.
      const from = id as LocalId;
      const name = this.lc(from).name;
      const mine = this.ctx.reach(from, { id: nextId(this.ctx.tables.ids), kind: "ident", name, start: at.start, end: at.end });
      const changed = this.inst(called).changed;
      if (changed !== undefined && changed.has(alias)) this.changesLocal(mine, "", "change", at, false);
      env.push(mine);
    }
    this.ctx.envOf(e, called, env);
  }

  // A call of a closure held by a variable runs the closure's body.
  /** @throws {CompileError} */
  private closureCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Expr>, known?: Type): { type: Type; what: string } {
    const held = known ?? this.value(callee);
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this function";
    const through = this.heldBy(held)!;
    // A generic function value reached here isn't a name or a field, which `callee` calls.
    const r = this.recOf(through);
    if (r?.kind === "closure" && (r.generic !== undefined)) throw unsupported("calls of a generic function value that isn't a name or a field", callee);
    if (this.isCallable(through)) return this.callableCall(e, callee, through as DynType);
    // A parameter of a function type calls it through its signature; its instance, the
    // closure it was given.
    const bound = this.boundFunction(held);
    const type = this.recOf(bound !== undefined ? bound : held);
    if (type === undefined || (type.kind !== "closure" && type.kind !== "function")) {
      const bound = this.boundFunction(held);
      throw new CompileError("E0503", `this expression is not callable: type '${this.ctx.tables.typing.show(bound !== undefined ? bound : held)}' has no call signatures`, callee.start, callee.end);
    }
    if (type.kind === "function" && (type.generic !== undefined)) {
      const got = this.familyCall(e, type, name);
      if (got.throws !== undefined) this.ctx.raise(e, got.throws, name);
      return got;
    }
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${name} takes no type arguments`, e.start, e.end);
    const params: Type[] = type.params.slice();
    const declaredThrows = type.throws;
    const declaredReturns = type.returns;
    const closure = type.kind === "closure" ? this.ctx.closureBody((bound !== undefined ? bound : held) as ClosureType) : undefined;
    if (closure !== undefined) this.arity(e.args.length, bodyOf(this.ctx.tables.arenas, this.inst(closure)).params, e);
    else if (e.args.length !== params.length) {
      throw new CompileError("E0501", `expected ${params.length} argument${params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    for (let i: usize = 0; i < e.args.length; i++) {
      const a = e.args[i]!;
      if (a.kind !== "arrow" || this.isCallable(params[i]!)) this.expect(a, params[i]!);
      const t = this.value(a);
      let shown: Type = params[i]!;
      if (closure !== undefined) {
        const written = bodyOf(this.ctx.tables.arenas, this.inst(closure)).params;
        const defaulted = i < written.length ? this.defaultedArg(a, t, written[i]!) : undefined;
        if (defaulted !== undefined) shown = defaulted;
      }
      this.coerce(a, t, params[i]!, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(shown)}'`);
    }
    const given = this.ctx.tables.typing.lower(held);
    const run = this.recOf(given);
    if (run?.kind === "closure") {
      const body = this.ctx.closureBody(given as ClosureType);
      this.ctx.calls.set(cloneExpr(e), body);
    }
    // The closure it runs throws what it throws, which its function type may only widen.
    const error = run?.kind === "closure" ? run.throws : declaredThrows;
    if (error !== undefined) this.ctx.raise(e, error, name);
    // Where the signature says `Promise<T>`, the call gives the future of the closure it was given.
    const returns = run?.kind === "closure" && this.ctx.tables.typing.promiseElement(declaredReturns) !== undefined ? run.returns : declaredReturns;
    // An async arrow's future holds a copy of what it captured, references too.
    if (this.recOf(returns)?.kind === "future" && this.ctx.tables.typing.holdsRef(returns)) this.ctx.borrowsFrom.set(e, [callee]);
    return { type: returns, what: name };
  }

  // `String.fromCharCode(...units)` and `String.fromCodePoint(...points)`: the arguments, spreads
  // of arrays among them, become one array of `u16` or `u32`.
  /** @throws {CompileError} */
  private stringStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    if (callee.name === "raw") return this.rawCall(e);
    if (callee.name !== "fromCharCode" && callee.name !== "fromCodePoint") throw new CompileError("E0502", `'String' has no '${callee.name}' yet; it has 'fromCharCode', 'fromCodePoint' and 'raw'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'String.${callee.name}' takes no type arguments`, e.start, e.end);
    if (e.args.length === 1 && this.ctx.tables.stringBuilds.has(e)) return this.stringBuilt(e, callee.name, e.args[0]!);
    const at = e.args.length > 0 ? { start: e.args[0]!.start, end: e.args[e.args.length - 1]!.end } : { start: e.end, end: e.end };
    let elements: Elements = [];
    for (const a of e.args) elements.push(cloneExpr(a));
    const gathered: Expr = { id: nextId(this.ctx.tables.ids), kind: "array", elements, start: at.start, end: at.end };
    return this.stringBuilt(e, callee.name, gathered);
  }

  // `String.fromCharCode` and `fromCodePoint` over the array of units or points they gather.
  /** @throws {CompileError} */
  private stringBuilt(this: Mut<this>, e: Ref<Call>, name: string, gathered: Ref<Expr>): { type: Type; what: string } {
    const each: Type = name === "fromCharCode" ? "u16" : "u32";
    const many = this.ctx.tables.typing.arrayType(each);
    this.expect(gathered, many);
    const t = this.value(gathered);
    this.coerce(gathered, t, many, `'String.${name}' takes ${name === "fromCharCode" ? "u16" : "u32"} values, and these are '${this.ctx.tables.typing.show(t)}'`);
    const made = this.ctx.tables.rewrites.replace(e, { ...e, args: [cloneExpr(gathered)] });
    this.ctx.tables.stringBuilds.set(cloneExpr(made), name === "fromCharCode" ? "units" : "points");
    return { type: "string", what: `'String.${name}'` };
  }

  // `String.raw({ raw: ["a", "b"] }, x)`: the strings with the values between them, as the tag
  // gives them, missing values empty as in JavaScript.
  /** @throws {CompileError} */
  private rawCall(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'String.raw' takes no type arguments", e.start, e.end);
    const strings = e.args.length > 0 ? rawStrings(e.args[0]!) : undefined;
    if (strings === undefined) {
      const at = e.args.length > 0 ? { start: e.args[0]!.start, end: e.args[0]!.end } : { start: e.start, end: e.end };
      throw new CompileError("E0504", "'String.raw' called as a function takes '{ raw: [...] }' holding an array of string literals first, so its text is known while compiling", at.start, at.end);
    }
    // JavaScript evaluates the values it drops, so a value past the last string is refused rather than left out.
    const allowed = strings.length > 0 ? strings.length - 1 : 0;
    if (e.args.length - 1 > allowed) throw new CompileError("E0504", `'String.raw' has ${strings.length} string(s) here, so it takes at most ${allowed} value(s) after them`, e.args[allowed + 1]!.start, e.args[e.args.length - 1]!.end);
    let values: Expr[] = [];
    for (let i: usize = 1; i < e.args.length; i++) {
      if (e.args[i]!.kind === "spread") throw new CompileError("E0504", "'String.raw' takes its values one by one, not spread", e.args[i]!.start, e.args[i]!.end);
      values.push(cloneExpr(e.args[i]!));
    }
    const made = this.ctx.tables.rewrites.replace(e, rawTemplate(strings, values, { start: e.start, end: e.end }));
    return { type: this.typeOf(made), what: "'String.raw'" };
  }

  // A call of one of a string's methods, which takes its arguments as the method's parameters.
  /** @throws {CompileError} */
  private stringCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, receiver: Type): { type: Type; what: string } {
    this.text(callee.object, receiver, this.linked(callee));
    // A method that may take a regex looks at its first argument to see which it was given.
    const first = REGEX_METHODS.has(callee.name) && e.args[0] ? this.value(e.args[0]) : undefined;
    const rx = first === undefined ? undefined : this.asRegex(first);
    if (rx) return this.regexStringCall(e, callee, rx, this.ctx.tables.typing.lower(first!) !== rx);
    if (first !== undefined && !stringMethods(this.ctx.tables.typing)[callee.name]) throw new CompileError("E0508", `'${callee.name}' takes a regex, like '${callee.name}(/x/${callee.name === "matchAll" ? "g" : ""})'; Fish doesn't turn a string into one`, e.args[0]!.start, e.args[0]!.end);
    // `concat` takes any number of strings, as `+` joins them.
    if (callee.name === "concat") {
      for (const a of e.args) {
        if (a.kind === "spread") throw new CompileError("E0801", "a spread into 'concat' isn't supported yet; join the array instead, as in 's + parts.join(\"\")'", a.start, a.end);
        const t = this.value(a);
        if (!stringLike(this.ctx.tables.typing, this.ctx.tables.typing.lower(t))) throw new CompileError("E0504", `'concat' takes strings, and this is '${this.ctx.tables.typing.show(t)}'; convert it with 'String(x)'`, a.start, a.end);
        this.coerce(a, t, "string", "");
      }
      return { type: "string", what: "'concat'" };
    }
    const method = stringMethods(this.ctx.tables.typing)[callee.name];
    if (!method) throw new CompileError("E0502", `strings have no method '${callee.name}' yet${didYouMean(callee.name, Object.keys(stringMethods(this.ctx.tables.typing)))}`, callee.start, callee.end);
    const [params, returns, required] = method;
    if (e.args.length < required || e.args.length > params.length) {
      const count = required === params.length ? `${required}` : `${required} or ${params.length}`;
      throw new CompileError("E0504", `'${callee.name}' takes ${count} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const t = i === 0 && first !== undefined ? first : this.value(a);
      this.coerce(a, t, params[i]!, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(params[i]!)}'`);
    });
    return { type: returns, what: `'${callee.name}'` };
  }

  // A string method taking a regex: `g` decides whether \`replace\`, \`match\` and \`split\` use
  // every match or the first, and \`matchAll\` and \`replaceAll\` need it, as JavaScript requires.
  /** @throws {CompileError} */
  private regexStringCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, rx: RegexType, generic: boolean): { type: Type; what: string } {
    const name = callee.name;
    const what = `'${name}'`;
    const global = this.ctx.tables.typing.rec(rx).flags.includes("g");
    const typed = (this.ctx.tables.typing.rec(rx).any === undefined) || generic;
    const unknown = () => new CompileError("E0508", `${what} types its matches from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    if (e.optional || callee.optional) throw new CompileError("E0508", `${what} with a regex is called without '?.'`, e.start, e.end);
    const most: usize = name === "search" || name === "match" || name === "matchAll" ? 1 : 2;
    if (e.args.length > most || (name.startsWith("replace") && e.args.length < 2)) {
      throw new CompileError("E0508", name.startsWith("replace") ? `${what} takes a regex and what replaces each match: a string, or an arrow function` : name === "split" ? "'split' takes a regex and an optional limit" : `${what} takes one regex`, e.start, e.end);
    }
    // What these give, or whether they may run, depends on the flags, which a 'RegExp' kept here
    // doesn't show.
    if (!typed && (name === "match" || name === "matchAll" || name === "replaceAll")) throw unknown();
    if ((name === "matchAll" || name === "replaceAll") && !global) throw new CompileError("E0508", `${what} needs a regex with the 'g' flag, as JavaScript requires`, e.args[0]!.start, e.args[0]!.end);
    if (name === "matchAll" && !typed) throw unknown();
    if (name === "split" && e.args.length > 1) {
      const t = this.value(e.args[1]!);
      if (t !== "i64" && t !== "usize" && !this.adapt(e.args[1]!, "i64")) throw new CompileError("E0504", `a limit is an 'i64', not '${this.ctx.tables.typing.show(t)}'`, e.args[1]!.start, e.args[1]!.end);
    }
    if (name.startsWith("replace")) this.replacement(e, rx, typed, unknown);
    this.ctx.tables.regexStringCalls.set(cloneExpr(e), name);
    return { type: regexStringType(this.ctx.tables.typing, name, rx, !typed), what };
  }

  // What replaces each match: a string with $ patterns, or an arrow function given the match,
  // each capture, the offset, the string and, when the pattern names them, the groups.
  /** @throws {CompileError} */
  private replacement(this: Mut<this>, e: Ref<Call>, rx: RegexType, typed: boolean, unknown: () => CompileError): Type {
    const given = e.args[1]!;
    if (given.kind !== "arrow") {
      const t = this.read(given);
      if (!stringLike(this.ctx.tables.typing, t)) throw new CompileError("E0508", `what replaces each match is a string or an arrow function, not '${this.ctx.tables.typing.show(t)}'`, given.start, given.end);
      // With named groups, $<name> must name one, as JavaScript's early check would if it had one.
      let names = new Set<string>();
      const captures = this.ctx.tables.typing.rec(rx).captures;
      for (const c of captures) if (c.name !== undefined) names.add(c.name);
      const missing = given.kind === "string" && names.size > 0 ? [...given.value.matchAll(/\$\$|\$<([^>]*)>/g)].find((m) => m[1] !== undefined && !names.has(m[1])) : undefined;
      if (missing) throw new CompileError("E0508", `the regex has no group named '${missing[1]}' for '${missing[0]}'`, given.start, given.end);
      if (t !== "string") this.coerce(given, t, "string", "");
      return "string";
    }
    if (!typed) throw unknown();
    const match = this.ctx.tables.typing.matchType(rx);
    const groups = this.ctx.tables.typing.field(match, "groups")?.type;
    const params: Type[] = ["string", ...this.ctx.tables.typing.elementsOf(match).slice(1), "i64", "string", ...(groups ? [this.ctx.tables.typing.refType(groups, false)] : [])];
    const names = ["match", ...this.ctx.tables.typing.rec(rx).captures.map((_, i) => `p${i + 1}`), "offset", "string", ...(groups ? ["groups"] : [])];
    if (given.params.length > params.length) throw new CompileError("E0508", `the replacing function is given ${names.join(", ")}`, given.params[params.length]!.start, given.params[params.length]!.end);
    this.expect(given, this.ctx.tables.typing.functionType(names, params, "string"));
    const called = this.value(given);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0508", "what replaces each match is a string or an arrow function", given.start, given.end);
    this.runsOften(called as ClosureType, "replace", "its function once per match", given);
    c.params.forEach((p, i) => this.passedExactly("replace", params[i]!, p, given.params[i], given.params[i] ?? given));
    if (!this.ctx.tables.typing.fits(c.returns, "string")) throw new CompileError("E0508", `the replacing function gives the string each match becomes, not '${this.ctx.tables.typing.show(c.returns)}'`, given.start, given.end);
    return "string";
  }

  // An array's method: `push` moves a value in at the end; `pop` takes the last one out, or
  // gives an empty Option. Both change the array.
  /** @throws {CompileError} */
  private arrayCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const typed = this.ctx.tables.typing.typedName(array);
    if ((typed !== undefined) && (callee.name === "subarray" || callee.name === "set")) this.ctx.exprsState.once.add(cloneExpr(callee.object));
    // `subarray` is a copy, as `slice` is: a typed array owns its elements, so a write to it
    // doesn't reach the array it came from.
    // Its positions, like set's offset, may be an `i64` or a `usize`, as JavaScript code holding
    // positions in either ports as written.
    if ((typed !== undefined) && callee.name === "subarray") {
      const id = nextId(this.ctx.tables.ids);
      let args: Expr[] = [];
      for (const a of e.args) args.push(this.arrayLength(a, false));
      const slice: Expr = { ...callee, id, name: "slice" };
      const made = this.become(e, { ...e, callee: slice, args });
      const from = this.placeText(callee.object);
      this.ctx.exprsState.subarrays.set(cloneExpr(made), from);
      return this.callMade(made);
    }
    if (SUBARRAY_WRITES.has(callee.name)) this.readOnlySubarray(callee.object);
    // `set(source, offset?)` copies the source's elements in at the offset. The source comes
    // first, so one made from the target, as in `a.set(a.subarray(0, 3), 1)`, is made before the
    // target is borrowed to change; the target itself as the source is copied first.
    if (typed !== undefined && callee.name === "set") {
      if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'set' takes the array to copy in, and an optional offset", e.start, e.end);
      const at = { start: e.start, end: e.end };
      const written = e.args[0]!;
      const root = placeRoot(written);
      const same = root !== undefined && root === placeRoot(callee.object);
      const source: Expr = same ? { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(written), name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at } : cloneExpr(written);
      this.expect(source, array);
      const helper = `array typed set ${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(array).element)}`;
      const offset = e.args.length > 1 ? this.arrayLength(e.args[1]!, false) : this.intAt(0n, at);
      const bytes = this.intAt(BigInt(typedSize(typed)), at);
      const made = this.become(e, this.typedCall(helper, [source, cloneExpr(callee.object), offset, bytes], at));
      return this.callMade(made);
    }
    if (!ARRAY_METHODS.has(callee.name)) throw new CompileError("E0502", `arrays have no method '${callee.name}' yet${didYouMean(callee.name, [...ARRAY_METHODS])}`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling array methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${callee.name}' takes no type arguments`, e.start, e.end);
    // Methods giving clones of the elements refuse elements that can't be cloned.
    if (["at", "find", "findLast", "filter", "slice", "concat", "fill", "entries", "values", "copyWithin", ...COPYING_METHODS].includes(callee.name) || ((callee.name === "reduce" || callee.name === "reduceRight") && e.args.length === 1)) this.clonable(this.ctx.tables.typing.rec(array).element, callee, callee.name);
    if (callee.name === "flat" && this.isArray(this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(array).element))) this.clonable(this.ctx.tables.typing.rec(this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(array).element) as ArrayType).element, callee, "flat");
    // `entries()`, `keys()` and `values()` call the prelude's generators, which borrow the array
    // while they live and give `[i, element]` pairs, indexes and elements, each element a clone.
    if (Object.hasOwn(ITERATORS, callee.name)) {
      if (e.args.length > 0) throw new CompileError("E0504", `'${callee.name}' takes no arguments`, e.start, e.end);
      return this.callMade(this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: ITERATORS[callee.name]!, start: callee.start, end: callee.end }, args: [callee.object], typeArgs: [] }));
    }
    // `toBase64(options?)` and `toHex()` on bytes call the prelude's encoders, which borrow them.
    if (Object.hasOwn(BYTE_METHODS, callee.name)) {
      if (this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(array).element) !== "u8") throw new CompileError("E0504", `'${callee.name}' encodes bytes, a 'u8[]', not '${this.ctx.tables.typing.show(array)}'`, callee.start, callee.end);
      const most = callee.name === "toBase64" ? 1 : 0;
      if (e.args.length > most) throw new CompileError("E0504", most === 0 ? `'${callee.name}' takes no arguments` : "'toBase64' takes an optional options object, as in '{ alphabet: \"base64url\", omitPadding: true }'", e.start, e.end);
      return this.callMade(this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: BYTE_METHODS[callee.name]!, start: callee.start, end: callee.end }, args: [callee.object, ...e.args], typeArgs: [] }));
    }
    if (this.readCopy(callee.object) && ["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "reserve", "shrinkToFit"].includes(callee.name)) {
      throw new CompileError("E0211", `'${callee.name}' changes its array, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
    }
    const held = this.ctx.types.get(callee.object)!;
    if (this.isRefType(held)) this.ctx.coercions.set(callee.object, array);
    if (CALLBACK_METHODS.has(callee.name)) return this.callbackCall(e, callee, array);
    if (READING_METHODS.has(callee.name)) return this.readingCall(e, callee, array);
    if (callee.name === "sort" || callee.name === "toSorted") return this.sortCall(e, callee, array);
    if (COPYING_METHODS.has(callee.name)) return this.copyingCall(e, callee, array);
    // `at(i)`: a clone of the element at a position counted from either end, or nothing.
    if (callee.name === "at") {
      if (e.args.length !== 1) throw new CompileError("E0504", "'at' takes a position, like 'at(-1)' for the last element", e.start, e.end);
      const i = e.args[0]!;
      this.expect(i, "i64");
      const t = this.value(i);
      this.coerce(i, t, "i64", `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type 'i64'`);
      return { type: this.ctx.tables.typing.unionType([this.ctx.tables.typing.rec(array).element, "null"]), what: "'at'" };
    }
    if (CHANGING_METHODS.has(callee.name)) return this.changingCall(e, callee, array);
    const count = callee.name === "push" ? 1 : 0;
    if (e.args.length !== count) throw new CompileError("E0504", `'${callee.name}' takes ${count === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    if (!this.place(callee.object)) throw new CompileError("E0212", `'${callee.name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    this.changeable(callee.object, callee.name === "push" ? "push to" : "pop from");
    if (callee.name === "pop") return { type: this.ctx.tables.typing.unionType([this.ctx.tables.typing.rec(array).element, "null"]), what: "'pop'" };
    this.expect(e.args[0]!, this.ctx.tables.typing.rec(array).element);
    const t = this.value(e.args[0]!);
    this.coerce(e.args[0]!, t, this.ctx.tables.typing.rec(array).element, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(array).element)}'`);
    return { type: "void", what: "'push'" };
  }

  // `map`, `filter`, `find`, `some`, `every` and `reduce` run the callback on each element in
  // turn, given it as a shared borrow, or a copy when it copies, and its index. `filter` and
  // `find` give clones of what they keep, and `reduce` without an initial value starts from a
  // clone of the first element.
  /** @throws {CompileError} */
  private callbackCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const reducing = name === "reduce" || name === "reduceRight";
    if (reducing ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      throw new CompileError("E0506", `'${name}' takes ${reducing ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'"}`, e.start, e.end);
    }
    const made = this.namedFunction(e.args[0]!);
    if (made !== undefined) return this.callbackWith(e, callee, array, made);
    return this.callbackWith(e, callee, array, e.args[0]!);
  }

  /** @throws {CompileError} */
  private callbackWith(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType, callback: Ref<Expr>): { type: Type; what: string } {
    const name = callee.name;
    const reducing = name === "reduce" || name === "reduceRight";
    if (callback.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const init = e.args.length > 1 ? this.value(e.args[1]!) : undefined;
    const element = this.ctx.tables.typing.isCopy(this.ctx.tables.typing.rec(array).element) ? this.ctx.tables.typing.rec(array).element : this.ctx.tables.typing.refType(this.ctx.tables.typing.rec(array).element, false);
    const acc = !reducing ? undefined : init !== undefined ? this.ctx.tables.typing.widenLet(init) : this.ctx.tables.typing.rec(array).element;
    const params: Type[] = acc !== undefined ? [acc, element, "i64"] : [element, "i64"];
    if (callback.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc !== undefined ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    const signature = this.ctx.tables.typing.functionType(acc !== undefined ? ["accumulator", "value", "index"] : ["value", "index"], params.slice(), "void");
    this.ctx.tables.typing.openThrows.add(signature);
    this.expect(callback, signature);
    const called = this.value(callback);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    if (c.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc !== undefined ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.start, callback.end);
    }
    this.runsOften(called as ClosureType, name, "its callback once per element", callback);
    for (let i: usize = 0; i < c.params.length; i++) {
      const written = i < callback.params.length ? callback.params[i] : undefined;
      const at = written !== undefined ? { start: written.start, end: written.end } : { start: callback.start, end: callback.end };
      this.passedExactly(name, params[i]!, c.params[i]!, written, at, i + 1 !== params.length);
    }
    const gives = c.returns;
    if (this.holdsFuture(gives)) throw new CompileError("E0801", `'${name}' with a callback giving a Promise isn't supported yet; await each value in a 'for...of' loop instead`, callback.start, callback.end);
    if (PREDICATES.has(name) && gives !== "boolean") {
      throw new CompileError("E0506", `'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    }
    if (acc !== undefined && !this.ctx.tables.typing.fits(gives, acc)) throw new CompileError("E0506", `'${name}''s callback gives the next accumulator, a '${this.ctx.tables.typing.show(acc)}', but this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || this.ctx.tables.typing.holdsRef(gives))) throw new CompileError("E0506", `'map''s callback has to give a value to keep, not '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    const many = this.ctx.tables.typing.lower(gives);
    if (name === "flatMap" && (typeof many === "string" || this.ctx.tables.typing.rec(many).kind !== "array")) {
      throw new CompileError("E0506", `'flatMap''s callback gives an array for each element, whose elements make up the result; this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    }
    const type = name === "map" ? this.ctx.tables.typing.arrayType(gives) : name === "flatMap" ? many : name === "filter" ? array : name === "find" || name === "findLast" ? this.ctx.tables.typing.unionType([this.ctx.tables.typing.rec(array).element, "null"])
      : name === "findIndex" || name === "findLastIndex" ? "i64" : name === "forEach" ? "void" : acc ?? "boolean";
    if (c.throws !== undefined) this.ctx.raise(e, c.throws, `'${name}'`);
    return { type, what: `'${name}'` };
  }

  // `sort()` orders numbers numerically and strings by UTF-16 code units; `sort(compare)` by
  // the sign of what the comparator gives for two elements. Stable, and in place, so it gives
  // nothing.
  // `toSorted` checks as `sort` does, and gives the sorted copy.
  /** @throws {CompileError} */
  private sortCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const copying = name === "toSorted";
    if (e.args.length > 1) throw new CompileError("E0506", `'${name}' takes an optional comparator like '(a, b) => a - b'`, e.start, e.end);
    if (!copying && !this.place(callee.object)) throw new CompileError("E0212", "'sort' sorts its array in place, so call it on a variable or a field", callee.start, callee.end);
    if (!copying) this.changeable(callee.object, "sort");
    const gives: { type: Type; what: string } = { type: copying ? array : "void", what: copying ? "'toSorted'" : "'sort', which sorts its array in place," };
    if (e.args.length === 0) {
      const element = this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(array).element);
      if (!isNumeric(element) && element !== "string") {
        throw new CompileError("E0506", `'${name}()' without a comparator orders numbers and strings, not '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(array).element)}'; give a comparator like '(a, b) => a.n - b.n'`, callee.start, callee.end);
      }
      return gives;
    }
    const made = this.namedFunction(e.args[0]!);
    if (made !== undefined) return this.sortWith(name, array, made, gives);
    return this.sortWith(name, array, e.args[0]!, gives);
  }

  /** @throws {CompileError} */
  private sortWith(this: Mut<this>, name: string, array: ArrayType, compare: Ref<Expr>, gives: { type: Type; what: string }): { type: Type; what: string } {
    if (compare.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes a comparator written in place, like '(a, b) => a - b', or a function by name`, compare.start, compare.end);
    if (compare.params.length > 2) throw new CompileError("E0506", `'${name}' passes its comparator two elements`, compare.params[2]!.start, compare.params[2]!.end);
    const held = this.ctx.tables.typing.rec(array).element;
    const element = this.ctx.tables.typing.isCopy(held) ? held : this.ctx.tables.typing.refType(held, false);
    this.expect(compare, this.ctx.tables.typing.functionType(["a", "b"], [element, element], "void"));
    const called = this.value(compare);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a comparator like '(a, b) => a - b'`, compare.start, compare.end);
    this.runsOften(called as ClosureType, name, "its comparator many times", compare);
    for (let i: usize = 0; i < c.params.length; i++) {
      const written = i < compare.params.length ? compare.params[i] : undefined;
      this.passedExactly(name, element, c.params[i]!, written, { start: compare.start, end: compare.end });
    }
    const order = this.ctx.tables.typing.lower(c.returns);
    if (isInteger(order) && !integerInfo(order).signed) {
      throw new CompileError("E0506", `a comparator's number has to be able to be negative, and '${this.ctx.tables.typing.show(c.returns)}' can't; convert with 'as i64', or compare: 'a < b ? -1 : a > b ? 1 : 0'`, compare.start, compare.end);
    }
    if (!isNumeric(order)) {
      throw new CompileError("E0506", `a comparator gives a number: negative when 'a' comes first, positive when 'b' does, zero to keep their order; this one gives '${this.ctx.tables.typing.show(c.returns)}'`, compare.start, compare.end);
    }
    return gives;
  }

  // `toReversed()`, `toSpliced(start?, count?, ...items)` and `with(i, v)` give a copy of the
  // array changed as `reverse`, `splice` and a write at `i` change theirs; values given move in.
  /** @throws {CompileError} */
  private copyingCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const element = this.ctx.tables.typing.rec(array).element;
    const wrong = name === "toReversed" ? e.args.length !== 0 : name === "with" ? e.args.length !== 2 : false;
    const takes = name === "toReversed" ? "no arguments" : name === "toSpliced" ? "an optional start, an optional count to remove and the values to put in their place" : "a position, like 'with(-1, x)' for the last element, and the value to put there";
    if (wrong) throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    for (let i: usize = 0; i < e.args.length; i++) {
      const target: Type = i === 0 || (i === 1 && name === "toSpliced") ? "i64" : element;
      this.expect(e.args[i]!, target);
      const given = this.value(e.args[i]!);
      this.coerce(e.args[i]!, given, target, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(target)}'`);
    }
    return { type: array, what: `'${name}'` };
  }

  // `shift` moves the first element out; `unshift` moves values in at the front; `splice`
  // moves a run out and values in where it was; `reverse`, `fill` and `copyWithin` change the
  // array in place.
  // What they give, JavaScript's new length for `unshift` and the array itself for `reverse`
  // and `fill`, they don't.
  /** @throws {CompileError} */
  private changingCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (!this.place(callee.object)) throw new CompileError("E0212", `'${name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    this.changeable(callee.object, name);
    const element = (a: Expr) => {
      this.expect(a, this.ctx.tables.typing.rec(array).element);
      const t = this.value(a);
      this.coerce(a, t, this.ctx.tables.typing.rec(array).element, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(array).element)}'`);
    };
    const position = (a: Expr) => {
      this.expect(a, "i64");
      const t = this.value(a);
      this.coerce(a, t, "i64", `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type 'i64'`);
    };
    const counts: Record<string, [usize, usize, string]> = {
      shift: [0, 0, "no arguments"], reverse: [0, 0, "no arguments"], unshift: [0, Infinity, "the values to put at the front"],
      splice: [1, Infinity, "a start, an optional count to remove and the values to put in their place"], fill: [1, 3, "a value and an optional start and end"],
      copyWithin: [2, 3, "a position to copy to, a start and an optional end"],
      reserve: [1, 1, "a count of elements to make room for"], shrinkToFit: [0, 0, "no arguments"],
    };
    const [least, most, takes] = counts[name]!;
    if (e.args.length < least || e.args.length > most) throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    if (name === "unshift") e.args.forEach(element);
    if (name === "splice") e.args.forEach((a, i) => (i < 2 ? position(a) : element(a)));
    if (name === "fill") e.args.forEach((a, i) => (i === 0 ? element(a) : position(a)));
    if (name === "reserve" || name === "copyWithin") e.args.forEach(position);
    const what = `'${name}', which changes its array in place,`;
    if (name === "shift") return { type: this.ctx.tables.typing.unionType([this.ctx.tables.typing.rec(array).element, "null"]), what: "'shift'" };
    if (name === "splice") return { type: array, what: "'splice'" };
    return { type: "void", what };
  }

  // `x as const`: a literal checked as its literal type, deeply, as TypeScript gives it.
  /** @throws {CompileError} */
  private constAssertion(this: Mut<this>, given: Ref<Expr>): Type {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.constAssertionNow(now) : this.constAssertionNow(given);
  }
  /** @throws {CompileError} */
  private constAssertionNow(this: Mut<this>, x: Ref<Expr>): Type {
    const enumMember = x.kind === "member" && x.object.kind === "ident" && (this.ctx.lookup(x.object.name, undefined) === undefined) && this.ctx.enums.has(x.object.name);
    const literal = x.kind === "string" || x.kind === "template" || x.kind === "int" || x.kind === "float" || x.kind === "bool" || x.kind === "array" || x.kind === "object" || (x.kind === "unary" && x.op === "-" && (x.operand.kind === "int" || x.operand.kind === "float")) || enumMember;
    if (!literal) throw new CompileError("E0111", "a 'const' assertion can only be applied to an enum member, or a string, number, boolean, array or object literal", x.start, x.end);
    const t = this.constType(x);
    this.expect(x, t);
    const given = this.value(x);
    this.coerce(x, given, t, `type '${this.ctx.tables.typing.show(this.ctx.types.get(x) ?? t)}' is not assignable to type '${this.ctx.tables.typing.show(t)}'`);
    return t;
  }

  // The type `as const` gives an expression: a literal's own, an array of strings the array of
  // their union, a mixed array a tuple, and an object's fields readonly. Anything else is
  // checked here, once, and keeps its type.
  /** @throws {CompileError} */
  private constType(this: Mut<this>, given: Ref<Expr>): Type {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.constKeyed(now) : this.constKeyed(given);
  }
  /** @throws {CompileError} */
  private constKeyed(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind === "object" && this.computesKeys(e)) {
      const keyed = this.keyed(e);
      return this.constTypeNow(keyed);
    }
    return this.constTypeNow(e);
  }
  /** @throws {CompileError} */
  private constTypeNow(this: Mut<this>, x: Ref<Expr>): Type {
    if (x.kind === "string") return this.ctx.tables.typing.literalType(x.value);
    if (x.kind === "template" && x.exprs.length === 0) return this.ctx.tables.typing.literalType(x.quasis[0]!);
    if (x.kind === "int" && x.value <= I64_MAX) return this.ctx.tables.typing.literalType(x.value);
    if (x.kind === "unary" && x.op === "-" && x.operand.kind === "int" && x.operand.value <= I64_MAX) return this.ctx.tables.typing.literalType(-x.operand.value);
    if (x.kind === "bool") return this.ctx.tables.typing.literalType(x.value);
    if (x.kind === "array" && x.elements.length === 0) return this.ctx.tables.typing.tupleType([]);
    if (x.kind === "array") {
      let plain = true;
      for (const y of x.elements) if (y === undefined || y.kind === "spread") plain = false;
      if (plain) {
        let parts: Type[] = [];
        for (const y of x.elements) parts.push(this.constType(y!));
        const first = this.constWide(parts[0]!);
        let same = true;
        for (const p of parts) if (this.constWide(p) !== first) same = false;
        if (same) {
          const joined = this.constJoin(parts);
          return this.ctx.tables.typing.arrayType(joined);
        }
        const count = parts.length;
        return this.ctx.tables.typing.tupleType(parts, count, undefined, true);
      }
    }
    if (x.kind === "object") {
      let plain = true;
      for (const p of x.props) if (p.kind !== "property" || typeof p.key !== "string") plain = false;
      if (plain) {
        let fields: Field[] = [];
        for (const p of x.props) if (p.kind === "property") fields.push({ name: keyText(p.key), type: this.constType(p.value), readonly: true });
        return this.ctx.tables.typing.objectType(fields);
      }
    }
    const t = this.value(x);
    this.ctx.exprsState.once.add(cloneExpr(x));
    return t;
  }

  // A const type with its literals widened to their base types, so parts that agree on it join.
  private constWide(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "literal" && (r.owner === undefined)) return this.ctx.tables.typing.baseOf(t as LiteralType);
    if (r?.kind === "object" && (r.tuple !== undefined)) {
      let parts: Type[] = [];
      for (const p of this.ctx.tables.typing.elementsOf(t as ObjectType)) parts.push(this.constWide(p));
      return this.ctx.tables.typing.tupleType(parts);
    }
    if (r?.kind === "object") {
      const given = r.fields.slice();
      let fields: Field[] = [];
      for (const f of given) fields.push({ ...f, type: this.constWide(f.type) });
      return this.ctx.tables.typing.objectType(fields);
    }
    return t;
  }

  // One type holding each of parts, which widen alike: the union of their literals or objects, as
  // TypeScript gives, so an object's fields stay linked; tuples are joined position by position,
  // since a union of tuples can't be destructured.
  private constJoin(this: Mut<this>, parts: Ref<Type[]>): Type {
    const r = this.recOf(parts[0]!);
    if (r?.kind === "object" && (r.tuple !== undefined)) {
      const count = this.ctx.tables.typing.elementsOf(parts[0] as ObjectType).length;
      let joined: Type[] = [];
      for (let i: usize = 0; i < count; i++) {
        let column: Type[] = [];
        for (const p of parts) column.push(this.ctx.tables.typing.elementsOf(p as ObjectType)[i]!);
        joined.push(this.constJoin(column));
      }
      return this.ctx.tables.typing.tupleType(joined);
    }
    return this.ctx.tables.typing.unionType(parts.slice());
  }

  // `[a, b]` written where a tuple is expected: each element checked against its own type, then
  // the literal becomes the object of fields `0`, `1` and on that the tuple is laid out as.
  /** @throws {CompileError} */
  private tupleLiteral(this: Mut<this>, e: Ref<Expr>, tuple: ObjectType): Type {
    const elements = this.ctx.tables.typing.elementsOf(tuple);
    // Once a literal became an object, its rest elements are its field `...`, checked again.
    let parts: Expr[] = [];
    let given = this.tupleParts(e);
    while (given.length > 0) {
      const x = given.shift();
      if (x !== undefined && x !== null) parts.push(x);
    }
    const restLast = this.ctx.tables.typing.rec(tuple).rest !== undefined && e.kind === "object";
    let last: Expr[] = [];
    if (restLast && parts.length > 0) last.push(parts.pop()!);
    let fixed: Expr[] = [];
    let beyond: Elements = [];
    const count = parts.length;
    while (parts.length > 0) {
      const x = parts.shift()!;
      if (fixed.length < elements.length) fixed.push(x);
      else beyond.push(x);
    }
    const least = this.ctx.tables.typing.rec(tuple).required ?? elements.length;
    for (const x of fixed) if (x.kind === "spread") throw unsupported("spread elements in tuple literals", x);
    if (count < least || (count > elements.length && this.ctx.tables.typing.rec(tuple).rest === undefined)) {
      const counted = this.ctx.tables.typing.rec(tuple).rest !== undefined ? `at least ${least}` : least === elements.length ? `${least}` : `${least} to ${elements.length}`;
      throw new CompileError("E0117", `type '${this.ctx.tables.typing.show(tuple)}' has ${counted} element${elements.length === 1 ? "" : "s"}, but this literal has ${count}`, e.start, e.end);
    }
    // Optional elements left out are empty.
    for (let i = fixed.length; i < elements.length; i++) fixed.push({ id: nextId(this.ctx.tables.ids), kind: "null", start: e.end, end: e.end });
    for (let i: usize = 0; i < fixed.length; i++) {
      const t = this.value(fixed[i]!);
      this.coerce(fixed[i]!, t, elements[i]!, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(elements[i]!)}'`);
    }
    // A rest tuple's further elements are an array literal of its rest type, spreads allowed.
    if (this.ctx.tables.typing.rec(tuple).rest !== undefined) {
      const rest = this.ctx.tables.typing.arrayType(this.ctx.tables.typing.rec(tuple).rest!);
      const extra: Expr = last.length > 0 ? last.pop()! : { id: nextId(this.ctx.tables.ids), kind: "array", elements: beyond, start: e.start, end: e.end };
      this.expect(extra, rest);
      const t = this.value(extra);
      this.coerce(extra, t, rest, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(rest)}'`);
      fixed.push(extra);
    }
    if (e.kind === "array") {
      let props: ObjectProp[] = [];
      let i: usize = 0;
      while (fixed.length > 0) {
        const value = fixed.shift()!;
        const id = nextId(this.ctx.tables.ids);
        props.push({ id, kind: "property", key: i < elements.length ? `${i}` : "...", start: value.start, end: value.end, value });
        i++;
      }
      const made = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "object", props, start: e.start, end: e.end });
      this.ctx.tables.tupleLiterals.add(cloneExpr(made));
    }
    return tuple;
  }

  // The types a tuple literal's parts have, widened as a `let` widens them.
  /** @throws {CompileError} */
  private partTypes(this: Mut<this>, e: Ref<Expr>): Type[] {
    let out: Type[] = [];
    for (const x of this.tupleParts(e)) {
      const t = this.value(x!);
      out.push(this.ctx.tables.typing.widenLet(t));
    }
    return out;
  }

  // The tuple a literal of these parts' types is where a generic function takes one: its parts in
  // order, or in the shape its parameter writes, an optional element left out being empty and the
  // parts past the fixed ones its rest.
  private shapedTuple(this: Mut<this>, e: Ref<Expr>, parts: Type[]): ObjectType {
    const node = this.ctx.exprsState.shapedBy.get(e);
    if ((node === undefined)) return this.ctx.tables.typing.tupleType(parts);
    // Checked once already, the literal's last part is its rest's array.
    let rests = false;
    for (const n of node.elements) if (n.rest) rests = true;
    const again = e.kind === "object" && rests;
    const given = again ? parts.slice(0, -1) : parts.slice();
    let optional: boolean[] = [];
    for (const n of node.elements) if (!n.rest) optional.push(n.optional);
    let required = -1;
    for (let i: usize = 0; i < optional.length; i++) if (required < 0 && optional[i]!) required = i as i64;
    let elements: Type[] = [];
    for (let i: usize = 0; i < optional.length; i++) elements.push(i >= given.length ? "null" : optional[i]! ? this.ctx.tables.typing.unionType([given[i]!, "null"]) : given[i]!);
    if (!rests) return given.length > optional.length ? this.ctx.tables.typing.tupleType(given) : this.ctx.tables.typing.tupleType(elements, required < 0 ? elements.length : required as usize);
    const fixed = optional;
    // No parts past the fixed ones say nothing about the rest, as an empty array literal doesn't.
    const extra = given.slice(fixed.length as i64);
    const rest = again ? this.ctx.tables.typing.rec(parts.at(-1) as ArrayType).element : extra.length === 0 ? "never" : this.ctx.tables.typing.unionType(extra);
    return this.ctx.tables.typing.tupleType(elements, undefined, rest);
  }

  // `t[0]` on a tuple reads its field `0`: the index is a number written in place naming one of
  // its elements, and the expression becomes that field's read.
  /** @throws {CompileError} */
  private untuple(this: Mut<this>, given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.untupleNow(now) : this.untupleNow(given);
  }
  /** @throws {CompileError} */
  private untupleNow(this: Mut<this>, e: Ref<Expr>): boolean {
    if (e.kind !== "index") return false;
    // Named as the object of an index, as the index's own check would name it.
    if (e.object.kind === "ident") this.ctx.exprsState.objects.add(cloneExpr(e.object));
    const through = this.value(e.object);
    // Whatever reads the object next, the index's check or the field's, takes this type, so a
    // chain of indexes is checked once, not once per level and again for each.
    this.ctx.exprsState.once.add(e.object);
    const held = this.isRefType(through) ? this.ctx.tables.typing.rec(through).to : through;
    const r = this.recOf(held);
    const object = r?.kind === "shared" ? this.ctx.tables.typing.lower(r.of) : held;
    if (!this.ctx.tables.typing.isTuple(object)) return this.keyRead(e, object);
    const count = this.ctx.tables.typing.elementsOf(object as ObjectType).length;
    if (e.index.kind !== "int") throw new CompileError("E0117", `a tuple's element is named by a number written in place, like '[0]'; '${this.ctx.tables.typing.show(object)}' has no element for a computed index`, e.index.start, e.index.end);
    const n = e.index.value;
    // Past a rest tuple's fixed elements, an index reads its array, panicking past the end.
    if (n >= BigInt(count) && this.ctx.tables.typing.rec(object as ObjectType).rest !== undefined) {
      const at = { start: e.index.start, end: e.index.end };
      const array: Expr = { id: nextId(this.ctx.tables.ids), kind: "member", object: e.object, name: "...", optional: false, start: e.object.start, end: e.object.end };
      this.ctx.tables.restStarts.set(array, count);
      this.ctx.tables.rewrites.replace(e, { ...e, object: array, index: { id: nextId(this.ctx.tables.ids), kind: "int", value: n - BigInt(count), ...at } });
      return false;
    }
    if (n >= BigInt(count)) throw new CompileError("E0117", `tuple type '${this.ctx.tables.typing.show(object)}' of length ${count} has no element at index ${n}`, e.index.start, e.index.end);
    if (e.optional) throw unsupported("optional index expressions", e);
    this.ctx.tables.rewrites.replace(e, { id: 0, kind: "member", object: e.object, name: String(n), optional: false, start: e.start, end: e.end });
    return true;
  }

  // `o[K]` on an object or an instance, with a key known while compiling, reads the field it names.
  /** @throws {CompileError} */
  private keyRead(this: Mut<this>, e: Ref<Extract<Expr, { kind: "index" }>>, object: Type): boolean {
    const r = this.recOf(object);
    const shaped = (k: string | undefined) => k === "object" || k === "class";
    // A type parameter, an object-typed parameter's included, reads its fields as a member does.
    if (!shaped(r?.kind) && r?.kind !== "param" && !(r?.kind === "union" && r.members.every((m) => shaped(this.recOf(m)?.kind)))) return false;
    const name = this.knownKey(e.index);
    if (name.startsWith("#")) throw new CompileError("E0502", `'${name}' names no field: a private field is read as '${this.placeText(e.object)}.${name}'`, e.index.start, e.index.end);
    if (e.optional) throw unsupported("optional index expressions", e);
    this.ctx.tables.rewrites.replace(e, { id: 0, kind: "member", object: e.object, name, optional: false, start: e.start, end: e.end });
    return true;
  }

  // A tuple literal's elements, as written or once it became an object.
  private tupleParts(given: Ref<Expr>): (Expr | undefined)[] {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.tuplePartsNow(now) : this.tuplePartsNow(given);
  }
  private tuplePartsNow(e: Ref<Expr>): (Expr | undefined)[] {
    let out: (Expr | undefined)[] = [];
    if (e.kind === "array") {
      for (const x of e.elements) out.push(x === undefined ? undefined : cloneExpr(x));
    } else if (e.kind === "object") {
      for (const p of e.props) out.push(p.kind === "property" ? cloneExpr(p.value) : undefined);
    }
    return out;
  }

  // `FixedArray.filled<T, N>(v)`: N copies of `v`, its type written or the one expected.
  /** @throws {CompileError} */
  private filled(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    if (callee.name !== "filled") throw new CompileError("E0502", `'FixedArray' has no '${callee.name}'; make one with 'FixedArray.filled<T, N>(value)' or a literal`, callee.start, callee.end);
    const written = e.typeArgs.length > 0 ? this.ctx.resolveType({ id: nextId(this.ctx.tables.ids), kind: "ref", name: "FixedArray", args: e.typeArgs, start: e.start, end: e.end }) : this.ctx.exprsState.wanted.get(e);
    if ((written === undefined) || !this.isFixed(written)) throw new CompileError("E0104", "say which fixed array to fill, as in 'FixedArray.filled<i64, 4>(0)'", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("E0504", "'FixedArray.filled' takes the value to fill it with", e.start, e.end);
    this.clonable(this.ctx.tables.typing.rec(written).element, { start: e.start, end: e.end }, "FixedArray.filled");
    const v = e.args[0]!;
    this.expect(v, this.ctx.tables.typing.rec(written).element);
    const t = this.value(v);
    this.coerce(v, t, this.ctx.tables.typing.rec(written).element, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(written).element)}'`);
    // Each instance's own type, as a generic body's differ, and a statement keeps it too.
    this.ctx.tables.fixedFills.add(e);
    this.ctx.types.set(e, written);
    return { type: written, what: "'FixedArray.filled'" };
  }

  // `Array.of(a, b)` is the array literal `[a, b]`; `Array.from(x, f?)` is the array of what x
  // holds, clones of an array's elements, a string's code points or a generator's values, or of
  // `0` to `n - 1` from `{ length: n }`, mapped by f when there is one.
  // `x.toFixed(digits)` prints a number with that many digits after the point, as JavaScript does.
  /** @throws {CompileError} */
  private toFixed(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    if (e.args.length > 1) throw new CompileError("E0504", "'toFixed' takes how many digits to print after the point, 0 when not given", e.start, e.end);
    if (e.callee.kind === "member") this.loaded(e.callee.object, this.ctx.types.get(e.callee.object)!);
    this.ctx.tables.fixedPrints.add(cloneExpr(e));
    if (e.args.length === 0) return { type: "string", what: "'toFixed'" };
    const t = this.value(e.args[0]!);
    if (t !== "i64" && !this.adapt(e.args[0]!, "i64")) throw new CompileError("E0504", `'toFixed' takes its digits as an 'i64', not '${this.ctx.tables.typing.show(t)}'`, e.args[0]!.start, e.args[0]!.end);
    return { type: "string", what: "'toFixed'" };
  }

  // `x.checkedAdd(y)` and its kin: the other operand is x's type, or a `u32` for a shift or a
  // power; checked gives an Option, overflowing a tuple with whether it overflowed.
  /** @throws {CompileError} */
  private integerCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, type: Integer): { type: Type; what: string } {
    const [family, operation] = integerMethod(callee.name)!;
    const what = `'${callee.name}'`;
    if (callee.optional || this.linked(callee)) throw new CompileError("E0801", `${what} can't be called through an optional chain yet; check for null first`, callee.start, callee.end);
    if (operation === "Neg" && family === "saturating" && !integerInfo(type).signed) throw new CompileError("E0502", `'${this.ctx.tables.typing.show(type)}' has no method ${what}: an unsigned number is never negated past its range; use 'checkedNeg' or 'wrappingNeg'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    this.loaded(callee.object, this.ctx.types.get(callee.object)!);
    const other: Integer = operation === "Shl" || operation === "Shr" || operation === "Pow" ? "u32" : type;
    const arity: usize = operation === "Neg" ? 0 : 1;
    if (e.args.length !== arity) throw new CompileError("E0504", arity === 0 ? `${what} takes no argument` : `${what} takes one '${this.ctx.tables.typing.show(other)}'`, e.start, e.end);
    for (const a of e.args) {
      const t = this.read(a);
      if (t !== other && !this.adapt(a, other)) throw new CompileError("E0111", `${what} on '${this.ctx.tables.typing.show(type)}' takes a '${this.ctx.tables.typing.show(other)}', not '${this.ctx.tables.typing.show(t)}'; convert it with 'as', as in 'n as ${this.ctx.tables.typing.show(other)}'`, a.start, a.end);
    }
    this.ctx.tables.integerCalls.add(cloneExpr(e));
    const result = family === "checked" ? this.ctx.tables.typing.unionType([type, "null"]) : family === "overflowing" ? this.ctx.tables.typing.tupleType([type, "boolean"]) : type;
    return { type: result, what };
  }

  // The global `parseInt`, `parseFloat`, `Number` and `Number.parse...` a call makes, unless a
  // name of the program's hides it.
  private parserOf(this: Mut<this>, callee: Ref<Expr>): "parseInt" | "parseFloat" | "Number" | undefined {
    if (callee.kind === "ident" && this.unhidden(callee.name)) {
      if (callee.name === "parseInt") return "parseInt";
      if (callee.name === "parseFloat") return "parseFloat";
      if (callee.name === "Number") return "Number";
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Number" && this.unhidden("Number")) {
      if (callee.name === "parseInt") return "parseInt";
      if (callee.name === "parseFloat") return "parseFloat";
    }
    return undefined;
  }

  // Whether a global's name is the global's: no name of the program's hides it.
  private unhidden(this: Mut<this>, name: string): boolean {
    return this.ctx.lookup(name, undefined) === undefined && !this.ctx.classes.has(name) && !this.ctx.byName.has(name) && !this.ctx.byName.has(`const ${name}`) && !this.ctx.enums.has(name);
  }

  // Parsing a number gives an Option where JavaScript would give NaN.
  /** @throws {CompileError} */
  private parse(this: Mut<this>, e: Ref<Call>, name: "parseInt" | "parseFloat" | "Number"): { type: Type; what: string } {
    const what = `'${name}'`;
    const most: usize = name === "parseInt" ? 2 : 1;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    if (e.args.length < 1 || e.args.length > most) throw new CompileError("E0504", name === "parseInt" ? "'parseInt' takes a string and an optional radix" : `${what} takes one string`, e.start, e.end);
    const t = this.read(e.args[0]!);
    if (!stringLike(this.ctx.tables.typing, t)) {
      const hint = name === "Number" && isNumeric(t) ? "; to convert a number, write 'x as f64'" : "";
      throw new CompileError("E0504", `${what} parses a string, not '${this.ctx.tables.typing.show(t)}'${hint}`, e.args[0]!.start, e.args[0]!.end);
    }
    if (t !== "string") this.coerce(e.args[0]!, t, "string", "");
    if (e.args.length > 1) {
      const r = this.value(e.args[1]!);
      if (r !== "i64" && !this.adapt(e.args[1]!, "i64")) throw new CompileError("E0504", `a radix is an 'i64', not '${this.ctx.tables.typing.show(r)}'`, e.args[1]!.start, e.args[1]!.end);
    }
    this.ctx.tables.parses.set(cloneExpr(e), name);
    return { type: this.ctx.tables.typing.unionType([name === "parseInt" ? "i64" : "f64", "null"]), what };
  }

  // `assert(cond, message?)`, checked here so its panic can name the call's place.
  /** @throws {CompileError} */
  private assertion(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    if (e.typeArgs.length > 0 || e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'assert' takes a condition and an optional message, as in 'assert(n > 0, \"n is positive\")'", e.start, e.end);
    this.condition(e.args[0]!);
    if (e.args.length > 1) {
      const t = this.read(e.args[1]!);
      if (!stringLike(this.ctx.tables.typing, t)) throw new CompileError("E0504", `an assertion's message is a string, not '${this.ctx.tables.typing.show(t)}'`, e.args[1]!.start, e.args[1]!.end);
      if (t !== "string") this.coerce(e.args[1]!, t, "string", "");
    }
    this.ctx.tables.asserts.set(cloneExpr(e), textAt(this.ctx.tables.files, e.args[0]!));
    return { type: "void", what: "'assert'" };
  }

  // A regex's pattern, parsed and compiled here so its errors come while compiling.
  /** @throws {CompileError} */
  private regexLiteral(this: Mut<this>, source: string, flags: string, at: Ref<Span>, shown: string = source): RegexType {
    try {
      const pattern = parsePattern(source, flags, this.ctx.tables.regex);
      compileRegex(pattern, this.ctx.tables.regex);
      return this.ctx.tables.typing.regexType(source, flags, pattern.captures, shown);
    } catch (err) {
      throw new CompileError("E0508", (err as RegexSyntaxError).message, at.start, at.end);
    }
  }

  // `new RegExp(pattern, flags?)` with both known while compiling is a regex like a literal's.
  /** @throws {CompileError} */
  private regexNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, list: Ref<Expr[]>): Type {
    if (list.length < 1 || list.length > 2) throw new CompileError("E0508", "'new RegExp' takes a pattern and optional flags", e.start, e.end);
    const known = list.map((a) => (a.kind === "string" ? a.value : a.kind === "template" && a.exprs.length === 0 ? a.quasis[0]! : undefined));
    if (known.some((k) => k === undefined)) {
      throw new CompileError("E0508", "a regex is compiled while compiling, so 'new RegExp' takes its pattern and flags as string literals; for a pattern known only when the program runs, Fish has no regex", e.start, e.end);
    }
    this.ctx.tables.regexNews.add(cloneExpr(e));
    return this.regexLiteral(known[0]!, known[1] ?? "", e, this.shownSource(known[0]!));
  }

  // `re.test(s)` and `re.exec(s)`. A regex keeps no `lastIndex`, so on a `g` or `y` regex they
  // would loop forever where JavaScript moves on; `matchAll` goes through every match instead.
  /** @throws {CompileError} */
  private regexCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: RegexType, generic: boolean): { type: Type; what: string } {
    const what = `'${callee.name}'`;
    if (callee.name !== "test" && callee.name !== "exec") throw new CompileError("E0508", `'RegExp' has no method '${callee.name}' in Fish; it has 'test' and 'exec', and strings take regexes in 'replace', 'split', 'match' and 'matchAll'`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", `a regex is always there, so ${what} is called without '?.'`, e.start, e.end);
    if (/[gy]/.test(this.ctx.tables.typing.rec(t).flags)) {
      throw new CompileError("E0508", `a Fish regex keeps no 'lastIndex', so ${what} on a regex with the '${this.ctx.tables.typing.rec(t).flags.includes("g") ? "g" : "y"}' flag would start at 0 every time; ${callee.name === "exec" ? "use 'matchAll' to go through every match, or" : ""} drop the flag`, e.start, e.end);
    }
    if (e.args.length !== 1) throw new CompileError("E0504", `${what} takes the string to match`, e.start, e.end);
    const s = this.read(e.args[0]!);
    if (!stringLike(this.ctx.tables.typing, s)) throw new CompileError("E0504", `${what} matches a string, not '${this.ctx.tables.typing.show(s)}'`, e.args[0]!.start, e.args[0]!.end);
    if (s !== "string") this.coerce(e.args[0]!, s, "string", "");
    this.loaded(callee.object, this.ctx.types.get(callee.object)!);
    if (callee.name === "exec" && (this.ctx.tables.typing.rec(t).any !== undefined) && !generic) {
      throw new CompileError("E0508", "'exec' types its match from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter", e.start, e.end);
    }
    this.ctx.tables.regexCalls.set(cloneExpr(e), callee.name === "test" ? "test" : "exec");
    return { type: callee.name === "test" ? "boolean" : this.ctx.tables.typing.unionType([this.ctx.tables.typing.matchType(t), "null"]), what };
  }

  // The regex a value is: its own type, or, for a `RegExp` parameter in a generic body's
  // definition, any regex.
  private asRegex(this: Mut<this>, t: Type): RegexType | undefined {
    const held = this.ctx.tables.typing.lower(t);
    if (typeof held === "string") return undefined;
    const r = this.ctx.tables.typing.rec(held);
    if (r.kind === "regex") return held as RegexType;
    return r.kind === "param" && this.recOf(r.bound)?.kind === "regex" ? r.bound as RegexType : undefined;
  }

  // How JavaScript shows a pattern given as a string: a '/' not already escaped, outside a class,
  // and line terminators escaped, and an empty one as '(?:)'.
  private shownSource(pattern: string): string {
    if (pattern === "") return "(?:)";
    let out = "", inClass = false;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]!;
      if (c === "\\" && i + 1 < pattern.length) {
        out += c + pattern[++i];
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      out += c === "/" && !inClass ? "\\/" : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\u2028" ? "\\u2028" : c === "\u2029" ? "\\u2029" : c;
    }
    return out;
  }

  // `re.source`, `re.flags` and the flag properties, known from its type.
  /** @throws {CompileError} */
  private regexMember(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, t: RegexType, generic: boolean): Type {
    if ((this.ctx.tables.typing.rec(t).any !== undefined) && !generic && (e.name === "source" || e.name === "flags" || e.name in REGEX_FLAGS)) {
      throw new CompileError("E0508", `'${e.name}' is known from a regex's pattern, which isn't known for a 'RegExp' kept here; read it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    }
    if (e.name === "source" || e.name === "flags") return "string";
    if (e.name in REGEX_FLAGS) return "boolean";
    if (e.name === "lastIndex") throw new CompileError("E0508", "a Fish regex keeps no state, so it has no 'lastIndex'; use 'matchAll' to go through every match", e.start, e.end);
    throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'`, e.start, e.end);
  }

  // `Date.now()` and `performance.now()`, unless a name of the program's hides `Date` or
  // `performance`; their other members aren't there yet. std's Date class, under its own name or
  // the one it takes beside a program's own Date, is the clock's owner rather than a hiding name.
  /** @throws {CompileError} */
  private clockOf(this: Mut<this>, callee: Ref<Expr>): "Date.now" | "performance.now" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident") return undefined;
    const std = callee.object.name === "std Date" && callee.start >= STD_BASE;
    const owner = std ? "Date" : callee.object.name;
    const declared = this.ctx.classes.get(owner);
    const hidden = declared !== undefined && !(owner === "Date" && this.ctx.tables.arenas.classOf(declared).node.start >= STD_BASE);
    if ((owner !== "Date" && owner !== "performance") || (!std && ((this.ctx.lookup(owner, undefined) !== undefined) || hidden || this.ctx.byName.has(owner) || this.ctx.byName.has(`const ${owner}`) || this.ctx.enums.has(owner)))) return undefined;
    if (owner === "Date" && callee.name === "parse") throw new CompileError("E0801", "'Date.parse' isn't supported yet, as reading dates from strings isn't; give 'new Date(ms)' milliseconds since the epoch", callee.start, callee.end);
    if (callee.name !== "now") throw new CompileError("E0801", `'${owner}.${callee.name}' isn't supported yet; '${owner}.now()' is`, callee.start, callee.end);
    return owner === "Date" ? "Date.now" : "performance.now";
  }

  // std's Date is made from milliseconds alone: reading a string and the year, month, day form,
  // which counts in local time, aren't there yet.
  /** @throws {CompileError} */
  private dateNew(this: Mut<this>, e: Ref<Expr>, list: Ref<Expr[]>, argTypes: Type[]) {
    if (list.length > 1) throw new CompileError("E0801", "'new Date(year, month, ...)' isn't supported yet, as local time isn't; give 'new Date(ms)' milliseconds since the epoch", e.start, e.end);
    const t = argTypes.length > 0 ? argTypes[0]! : "void";
    if (t === "string" || (this.recOf(t)?.kind === "literal" && typeof this.ctx.tables.typing.rec(t as LiteralType).value === "string")) {
      throw new CompileError("E0801", "'new Date(text)' isn't supported yet, as reading dates from strings isn't; give 'new Date(ms)' milliseconds since the epoch", e.start, e.end);
    }
  }

  // `JSON.stringify` and `JSON.parse`, unless a name of the program's hides `JSON`.
  private jsonOf(this: Mut<this>, callee: Ref<Expr>): "stringify" | "parse" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident" || callee.object.name !== "JSON") return undefined;
    if ((this.ctx.lookup("JSON", undefined) !== undefined) || this.ctx.classes.has("JSON") || this.ctx.byName.has("JSON") || this.ctx.byName.has("const JSON") || this.ctx.enums.has("JSON")) return undefined;
    return callee.name === "stringify" ? "stringify" : callee.name === "parse" ? "parse" : undefined;
  }

  // `JSON.stringify(x)`: x written as JSON text, which its type decides.
  /** @throws {CompileError} */
  private stringify(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'JSON.stringify' takes no type argument; the value's type decides how it is written", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.stringify' replacer and indent arguments", e.args[1]!);
    if (e.args.length === 0) throw new CompileError("E0509", "'JSON.stringify' takes the value to write", e.start, e.end);
    const read = this.read(e.args[0]!);
    this.jsonable(read, { start: e.args[0]!.start, end: e.args[0]!.end }, "written as");
    this.ctx.tables.jsonCalls.set(cloneExpr(e), "stringify");
    return { type: "string", what: "'JSON.stringify'" };
  }

  // `JSON.parse<T>(s)`: s read as a T, throwing a JsonError when it isn't one.
  /** @throws {CompileError} */
  private jsonParse(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    // Without a type it reads the dynamic `Json` value, as TypeScript's gives `any`.
    if (e.typeArgs.length > 1) throw new CompileError("E0106", "'JSON.parse' takes one type argument, the type to read", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.parse' revivers", e.args[1]!);
    if (e.args.length === 0) throw new CompileError("E0509", "'JSON.parse' takes the text to read", e.start, e.end);
    const written: TypeNode = e.typeArgs.length > 0 ? cloneTypeNode(e.typeArgs[0]!) : { id: nextId(this.ctx.tables.ids), kind: "ref", name: JSON_VALUE_NAME, args: [], start: e.start, end: e.end };
    const t = this.ctx.resolveType(written);
    this.jsonable(t, written, "read from");
    if (this.ctx.tables.typing.holdsRef(t)) throw new CompileError("E0509", `'JSON.parse' makes owned values, so '${this.ctx.tables.typing.show(t)}' can't hold references`, written.start, written.end);
    if (this.ctx.tables.typing.holdsPattern(t)) throw unsupported("template literal pattern types in 'JSON.parse'", written);
    if (this.ctx.tables.typing.holdsPart(t, (u) => typeof u !== "string" && this.ctx.tables.typing.rec(u).kind === "fixed")) throw unsupported("fixed-size arrays in 'JSON.parse'", written);
    const hidden = this.ctx.tables.typing.holdsPart(t, (u) => typeof u !== "string" && this.ctx.tables.typing.rec(u).kind === "class" && this.ctx.tables.typing.rec(u).fields.some((f) => f.name.startsWith("#")));
    if (hidden) throw new CompileError("E0509", "a class with '#private' fields can't be read from JSON, since JSON doesn't hold them", written.start, written.end);
    const s = this.read(e.args[0]!);
    if (!stringLike(this.ctx.tables.typing, s)) throw new CompileError("E0509", `'JSON.parse' reads a string, not '${this.ctx.tables.typing.show(s)}'`, e.args[0]!.start, e.args[0]!.end);
    if (s !== "string") this.coerce(e.args[0]!, s, "string", "");
    const error = this.ctx.tables.arenas.classOf(this.ctx.classes.get("JsonError")!).type;
    this.ctx.raise(e, error, "'JSON.parse'");
    this.ctx.tables.jsonCalls.set(cloneExpr(e), "parse");
    return { type: t, what: "'JSON.parse'" };
  }

  // Refuses a type with a part JSON can't hold, saying why.
  /** @throws {CompileError} */
  private jsonable(this: Mut<this>, t: Type, at: Ref<Span>, verb: string) {
    // What an unknown holds is known once the whole program is checked, and checked then.
    if (this.ctx.tables.typing.holdsPart(t, (u) => this.ctx.tables.typing.isUnknown(u), true)) {
      if (verb !== "written as") throw new CompileError("E0509", "'JSON.parse' can't read into an 'unknown', which holds only what the program puts in one; read into 'Json' to take any JSON", at.start, at.end);
      this.ctx.tables.unknownJson.push({ start: at.start, end: at.end });
    }
    const part = this.ctx.tables.typing.unjson(t, (c) => this.derivesJson(c));
    if (part === undefined) return;
    const r = this.recOf(part);
    const why = r === undefined ? "it has no JSON form"
      : r.kind === "class" ? `a class is ${verb} JSON when it has '@derive(Json)', which '${r.name}' doesn't`
      : r.kind === "variant" ? `an enum holding values is ${verb} JSON when it has '@derive(Json)', which '${r.enum}' doesn't`
      : r.kind === "map" ? (r.set ? "a Set has no JSON form; use an array of its members" : "only a Map with string keys has a JSON form, an object")
      : "it has no JSON form";
    throw new CompileError("E0509", `values of type '${this.ctx.tables.typing.show(part)}' can't be ${verb} JSON: ${why}`, at.start, at.end);
  }

  /** @throws {CompileError} */
  private derivesJson(this: Mut<this>, t: ClassType | VariantType): boolean {
    const r = this.ctx.tables.typing.rec(t);
    if (r.kind === "variant") {
      const name = r.enum;
      for (const info of this.ctx.enums.values()) if (info.data !== undefined && info.data.name === name && info.data.json) return true;
      return false;
    }
    const derives = this.cls(t as ClassType).node.derives;
    return derives !== undefined && derives.includes("Json");
  }

  // The global `Math`, unless a name of the program's hides it.
  private isMath(this: Mut<this>, e: Ref<Expr>): boolean {
    return e.kind === "ident" && e.name === "Math" && (this.ctx.lookup("Math", undefined) === undefined) && !this.ctx.classes.has("Math") && !this.ctx.byName.has("Math") && !this.ctx.byName.has("const Math") && !this.ctx.enums.has("Math");
  }

  // `Math.abs`, `sign`, `min` and `max` keep the numeric type they are given, a literal taking
  // the type of the numbers beside it as with an operator; the rest take and give `f64`.
  /** @throws {CompileError} */
  private mathCall(this: Mut<this>, e: Ref<Call>, name: string): { type: Type; what: string } {
    const what = `'Math.${name}'`;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    if (name === "random") {
      if (e.args.length > 0) throw new CompileError("E0504", "'Math.random' takes no arguments", e.start, e.end);
      this.ctx.tables.clocks.set(cloneExpr(e), "Math.random");
      return { type: "f64", what };
    }
    const arity = MATH_FLOAT[name];
    if (arity !== undefined) {
      if (e.args.length !== arity) throw new CompileError("E0504", `${what} takes ${arity === 1 ? "one number" : "two numbers"}`, e.start, e.end);
      for (const a of e.args) {
        const read = this.read(a);
        const t = this.brandBase(read);
        if (t === "f64" || this.adapt(a, "f64")) continue;
        throw new CompileError("E0111", isNumeric(t) ? `${what} takes a '${this.ctx.tables.typing.show("f64")}', an f64, not '${this.ctx.tables.typing.show(t)}'; convert it with 'as', as in 'n as f64'` : `${what} takes a number, not '${this.ctx.tables.typing.show(t)}'`, a.start, a.end);
      }
      this.ctx.tables.maths.add(cloneExpr(e));
      return { type: "f64", what };
    }
    if (!["abs", "sign", "min", "max"].includes(name)) throw new CompileError("E0801", `'Math' has no '${name}' in Fish yet`, e.start, e.end);
    const many = name === "min" || name === "max";
    if (many ? e.args.length === 0 : e.args.length !== 1) throw new CompileError("E0504", many ? `${what} takes one or more numbers` : `${what} takes one number`, e.start, e.end);
    let given: Type[] = [];
    for (const a of e.args) {
      const read = this.read(a);
      given.push(this.brandBase(read));
    }
    for (let i: usize = 0; i < given.length; i++) {
      if (!isNumeric(given[i]!)) throw new CompileError("E0504", `${what} takes numbers, not '${this.ctx.tables.typing.show(given[i]!)}'`, e.args[i]!.start, e.args[i]!.end);
    }
    let to: Type | undefined = undefined;
    for (let i: usize = 0; i < e.args.length; i++) {
      if (!this.literalOnly(e.args[i]!, true)) {
        to = given[i]!;
        break;
      }
    }
    if (to === undefined) {
      to = "i64";
      for (const g of given) if (isFloat(g)) to = "f64";
    }
    for (let i: usize = 0; i < e.args.length; i++) {
      if (given[i] !== to && !this.adapt(e.args[i]!, to)) throw new CompileError("E0111", `${what} takes numbers of one type, but got '${this.ctx.tables.typing.show(to)}' and '${this.ctx.tables.typing.show(given[i]!)}'; convert one with 'as'`, e.args[i]!.start, e.args[i]!.end);
    }
    this.ctx.tables.maths.add(cloneExpr(e));
    return { type: to, what };
  }

  // `new Uint8Array(...)` and its siblings: an empty one, n zeros, a copy of an array's elements,
  // or the elements an ArrayBuffer holds, which it takes, as every typed array owns its own.
  /** @throws {CompileError} */
  private typedNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, name: TypedName, list: Ref<Expr[]>): Type {
    const typed = this.ctx.tables.typing.typedArray(name);
    const element = this.ctx.tables.typing.rec(typed).element;
    const at = { start: e.start, end: e.end };
    const usage = name === "ArrayBuffer" ? "'new ArrayBuffer(n)' takes its length in bytes" : `'new ${name}' takes a length, an array to copy, or an ArrayBuffer with an optional byte offset and length`;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    this.refuseSpread(list);
    if (list.length === 0) return this.typedAs(e, { id: nextId(this.ctx.tables.ids), kind: "array", elements: [], ...at }, typed);
    const source = list[0]!;
    const rest: usize = list.length - 1;
    if (rest > (name === "ArrayBuffer" ? 0 : 2)) throw new CompileError("E0504", usage, e.start, e.end);
    if (source.kind === "array" && rest === 0 && name !== "ArrayBuffer") return this.typedAs(e, cloneExpr(source), typed);
    const t = this.value(source);
    this.ctx.exprsState.once.add(cloneExpr(source));
    const held = this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t;
    if (isInteger(t) && rest === 0) {
      const length = this.arrayLength(source, false);
      const zero = this.typedZero(name, { start: source.start, end: source.end });
      return this.typedAs(e, this.typedCall("array typed zeros", [length, zero], at), typed);
    }
    if (this.ctx.tables.typing.typedName(held) === "ArrayBuffer" && name !== "ArrayBuffer") {
      const size = BigInt(typedSize(name));
      const helper = `array from buffer ${this.ctx.tables.typing.show(element)}`;
      const offset = rest >= 1 ? this.arrayLength(list[1]!, false) : this.intAt(0n, at);
      const count = rest >= 2 ? this.arrayLength(list[2]!, false) : this.intAt(-1n, at);
      const bytes = this.intAt(size, at);
      const label: Expr = { id: nextId(this.ctx.tables.ids), kind: "string", value: name, ...at };
      return this.typedAs(e, this.typedCall(helper, [cloneExpr(source), offset, count, bytes, label], at), typed);
    }
    if (this.isArray(held) && rest === 0 && name !== "ArrayBuffer") {
      const inner = this.ctx.tables.typing.rec(held).element;
      const got = this.ctx.tables.typing.lower(inner);
      if (got !== element) throw new CompileError("E0101", `'new ${name}' copies elements of type '${this.ctx.tables.typing.show(element)}', not '${this.ctx.tables.typing.show(got)}'; convert them first, as in 'xs.map((x) => x as ${this.ctx.tables.typing.show(element)})'${floatInto(got, element)}`, source.start, source.end);
      return this.typedAs(e, { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(source), name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at }, typed);
    }
    throw new CompileError("E0504", usage, e.start, e.end);
  }

  // `e` rewritten as `to`, which makes a typed array's elements, typed as that typed array.
  /** @throws {CompileError} */
  private typedAs(this: Mut<this>, e: Ref<Expr>, to: Expr, typed: ArrayType, mapped = false): Type {
    const made = this.become(e, to);
    this.expect(made, typed);
    const t = this.value(made);
    const name = this.ctx.tables.typing.typedName(typed)!;
    const want = this.ctx.tables.typing.rec(typed).element;
    let element: Type | undefined = undefined;
    if (this.isArray(t)) {
      const inner = this.ctx.tables.typing.rec(t).element;
      element = this.ctx.tables.typing.lower(inner);
    }
    // A map function giving another number type is told how to convert what it gives.
    if (mapped && element !== undefined && isNumeric(element) && !this.ctx.tables.typing.fits(t, typed)) {
      throw new CompileError("E0101", `'${name}.from' holds elements of type '${this.ctx.tables.typing.show(want)}', and this function gives '${this.ctx.tables.typing.show(element)}'; convert what it gives, as in '(x) => (...) as ${this.ctx.tables.typing.show(want)}'${floatInto(element, want)}`, e.start, e.end);
    }
    this.coerce(made, t, typed, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(typed)}'`);
    return typed;
  }

  // A typed array's byte length, byte offset, element size and buffer. It owns its elements from
  // the start of its own buffer, so its offset is 0 and its buffer is a copy of its bytes.
  /** @throws {CompileError} */
  private typedMember(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, name: TypedName): Type {
    const at = { start: e.start, end: e.end };
    const size = typedSize(name);
    if (this.linked(e)) throw unsupported("optional chains reading a typed array's properties", e);
    this.ctx.exprsState.once.add(cloneExpr(e.object));
    let to: Expr;
    if (e.name === "BYTES_PER_ELEMENT") to = this.intAt(BigInt(size), at);
    else if (e.name === "byteOffset") {
      const id = nextId(this.ctx.tables.ids);
      const zero = this.intAt(0n, at);
      const usize: TypeNode = { id: nextId(this.ctx.tables.ids), kind: "ref", name: "usize", args: [], ...at };
      to = { id, kind: "as", expr: zero, type: usize, ...at };
    } else if (e.name === "buffer") {
      const typed = this.ctx.tables.typing.typedArray(name);
      const element = this.ctx.tables.typing.rec(typed).element;
      const helper = `array typed buffer ${this.ctx.tables.typing.show(element)}`;
      const bytes = this.intAt(BigInt(size), at);
      to = this.typedCall(helper, [cloneExpr(e.object), bytes], at);
    } else {
      const length: Expr = { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(e.object), name: "length", optional: false, ...at };
      if (size === 1) to = length;
      else {
        const id = nextId(this.ctx.tables.ids);
        to = { id, kind: "binary", op: "*", left: length, right: this.intAt(BigInt(size), at), ...at };
      }
    }
    const made = this.become(e, to);
    return this.typeOf(made);
  }

  private intAt(this: Mut<this>, value: bigint, at: Ref<Span>): Expr {
    return { id: nextId(this.ctx.tables.ids), kind: "int", value, start: at.start, end: at.end };
  }

  // A `subarray` is a copy, so a write to it would be lost where JavaScript's reaches the array
  // it views: it is read, and never bound with 'let', assigned, lent mutably or changed.
  /** @throws {CompileError} */
  readOnlySubarray(e: Ref<Expr>) {
    const now = this.ctx.tables.rewrites.rewritten(e);
    const from = now !== undefined ? this.ctx.exprsState.subarrays.get(now) : this.ctx.exprsState.subarrays.get(e);
    if (from === undefined) return;
    const named = from === "(...)" ? "the array it came from" : `'${from}'`;
    throw new CompileError("E0212", `subarray copies in Fish, so writes would not reach ${named}; use 'slice()' for a copy you'll change, or write through ${named} at an offset`, e.start, e.end);
  }

  private typedCall(this: Mut<this>, name: string, args: Expr[], at: Ref<Span>): Expr {
    return { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name, start: at.start, end: at.end }, args, typeArgs: [], optional: false, start: at.start, end: at.end };
  }

  // A zero of a typed array's element, which picks the helper's instance.
  private typedZero(this: Mut<this>, name: TypedName, at: Ref<Span>): Expr {
    const span = { start: at.start, end: at.end };
    const typed = this.ctx.tables.typing.typedArray(name);
    const element = this.ctx.tables.typing.rec(typed).element;
    return { id: nextId(this.ctx.tables.ids), kind: "as", expr: { id: nextId(this.ctx.tables.ids), kind: "int", value: 0n, ...span }, type: { id: nextId(this.ctx.tables.ids), kind: "ref", name: this.ctx.tables.typing.show(element), args: [], ...span }, ...span };
  }

  // `Uint8Array.from(xs, f?)` and `Uint8Array.of(...)`: a typed array of the elements given, or of
  // what f makes of each; `Uint8Array.BYTES_PER_ELEMENT` is its element's size.
  /** @throws {CompileError} */
  private typedStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, name: TypedName): { type: Type; what: string } {
    const typed = this.ctx.tables.typing.typedArray(name);
    const at = { start: e.start, end: e.end };
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}.${callee.name}' takes no type arguments`, e.start, e.end);
    if (name === "ArrayBuffer" || (callee.name !== "from" && callee.name !== "of")) throw new CompileError("E0502", `'${name}' has no static '${callee.name}'${name === "ArrayBuffer" ? "" : `; make one with 'new ${name}(...)', '${name}.from(xs)' or '${name}.of(...)'`}`, callee.start, callee.end);
    this.refuseSpread(e.args);
    if (callee.name === "of") {
      let elements: Elements = [];
      for (const a of e.args) elements.push(cloneExpr(a));
      return { type: this.typedAs(e, { id: nextId(this.ctx.tables.ids), kind: "array", elements, ...at }, typed), what: `'${name}.of'` };
    }
    if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", `'${name}.from' takes the array to copy, and an optional function mapping each value`, e.start, e.end);
    if (e.args.length > 1) {
      const mapped: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(e.args[0]!), name: "map", optional: false, ...at }, args: [cloneExpr(e.args[1]!)], typeArgs: [], optional: false, ...at };
      return { type: this.typedAs(e, mapped, typed, true), what: `'${name}.from'` };
    }
    const made: Expr = { id: nextId(this.ctx.tables.ids), kind: "new", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name, ...at }, args: [cloneExpr(e.args[0]!)], typeArgs: [], ...at };
    return { type: this.typedAs(e, made, typed), what: `'${name}.from'` };
  }

  /** @throws {CompileError} */
  private arrayStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    const at = { start: callee.start, end: callee.end };
    if (callee.name === "of") {
      if (e.typeArgs.length > 1) throw new CompileError("E0106", "'Array.of' takes one type argument, its element type", e.start, e.end);
      if (e.typeArgs.length > 0) this.ctx.tables.ofElements.set(cloneExpr(e), cloneTypeNode(e.typeArgs[0]!));
      let elements: Elements = [];
      for (const a of e.args) elements.push(cloneExpr(a));
      const literal = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "array", elements, start: e.start, end: e.end });
      return { type: this.value(literal), what: "'Array.of'" };
    }
    // `Array.isArray(v)`: whether v holds an array, which narrows a union to its array members.
    if (callee.name === "isArray") {
      if (e.typeArgs.length > 0 || e.args.length !== 1) throw new CompileError("E0504", "'Array.isArray' takes the value to test", e.start, e.end);
      this.read(e.args[0]!);
      this.ctx.tables.kindTests.set(e, "Array");
      return { type: "boolean", what: "'Array.isArray'" };
    }
    if (callee.name !== "from") throw new CompileError("E0502", `'Array' has no '${callee.name}'; arrays are made with 'Array.of', 'Array.from' or 'new Array(n).fill(x)'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'Array.from' takes no type argument; its element type is what the source holds, or what the map function gives", e.start, e.end);
    if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'Array.from' takes what to make the array from, and an optional function mapping each value", e.start, e.end);
    const source = e.args[0]!;
    const mapping = e.args.length > 1;
    let length: Expr | undefined = undefined;
    if (source.kind === "object" && source.props.length === 1) {
      const prop = source.props[0]!;
      if (prop.kind === "property" && prop.key === "length") length = this.arrayLength(prop.value, false);
      else if (prop.kind === "shorthand" && prop.name === "length" && prop.default === undefined) {
        const named: Expr = { id: nextId(this.ctx.tables.ids), kind: "ident", name: "length", start: prop.start, end: prop.end };
        length = this.arrayLength(named, false);
      }
    }
    let made: Expr;
    if (length !== undefined) {
      if (!mapping) throw new CompileError("E0504", "'Array.from({ length: n })' alone would hold n undefined values, which Fish has no way to make; give it a function, as in 'Array.from({ length: n }, (_, i) => i)'", e.start, e.end);
      made = this.typedCall("array range", [length], at);
    } else {
      const t = this.value(source);
      const held = this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t;
      if (this.ctx.tables.typing.iterableElement(held) !== undefined) throw unsupported("'Array.from' over an 'Iterable' parameter", source);
      const inner = this.embeddedIterated(source, held);
      if (inner !== undefined) {
        const id = nextId(this.ctx.tables.ids);
        const calleeId = nextId(this.ctx.tables.ids);
        const listing = this.embeddedOf(held)!.embedded === "Set" ? "values" : "entries";
        const listed: Expr = { id, kind: "call", callee: { id: calleeId, kind: "member", object: inner, name: listing, optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
        let args: Expr[] = [listed];
        for (let i: usize = 1; i < e.args.length; i++) args.push(cloneExpr(e.args[i]!));
        const replaced = this.ctx.tables.rewrites.replace(e, { ...e, args });
        return this.callMade(replaced);
      }
      if (this.isArray(held)) made = mapping ? cloneExpr(source) : { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(source), name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
      else if (stringLike(this.ctx.tables.typing, held)) made = this.typedCall("array chars", [cloneExpr(source)], at);
      else if (this.ctx.tables.typing.yieldsOf(held) !== undefined) made = this.typedCall("array collect", [cloneExpr(source)], at);
      // Asked twice, as the ids each asking makes are kept in step with the code before.
      else if (this.iteratorCall(source, held) !== undefined) {
        const iterated = this.iteratorCall(source, held)!;
        made = this.typedCall("array collect", [iterated], at);
      } else throw new CompileError("E0119", `'Array.from' makes an array from an array, a string, a generator, an iterable class or '{ length: n }', not '${this.ctx.tables.typing.show(t)}'`, source.start, source.end);
    }
    if (mapping) {
      const id = nextId(this.ctx.tables.ids);
      const calleeId = nextId(this.ctx.tables.ids);
      const object = made;
      made = { id, kind: "call", callee: { id: calleeId, kind: "member", object, name: "map", optional: false, ...at }, args: [cloneExpr(e.args[1]!)], typeArgs: [], optional: false, ...at };
    }
    const replaced = this.ctx.tables.rewrites.replace(e, withIdExpr(made, idOfExpr(made), 0, [e.start, e.end]));
    return this.callMade(replaced);
  }

  // An object literal meeting a dictionary: the Map it is, made from its entries in order.
  /** @throws {CompileError} */
  private dictLiteral(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>, t: MapType) {
    const at = { start: e.start, end: e.end };
    let entries: Elements = [];
    for (const p of e.props) {
      if (p.kind === "spread") throw unsupported("spreads into a dictionary", p);
      if (p.kind !== "property" && p.kind !== "shorthand") throw unsupported("methods and accessors in a dictionary", p);
      if (p.kind === "property" && typeof p.key !== "string") throw unsupported("computed keys in a dictionary", p);
      const key: Expr = { id: nextId(this.ctx.tables.ids), kind: "string", value: propName(p), start: p.start, end: p.end };
      const value: Expr = p.kind === "property" ? cloneExpr(p.value) : { id: nextId(this.ctx.tables.ids), kind: "ident", name: p.name, start: p.start, end: p.end };
      entries.push({ id: nextId(this.ctx.tables.ids), kind: "array", elements: [key, value], start: p.start, end: p.end });
    }
    const args: Expr[] = entries.length > 0 ? [{ id: nextId(this.ctx.tables.ids), kind: "array", elements: entries, ...at }] : [];
    const made = this.become(e, { id: nextId(this.ctx.tables.ids), kind: "new", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "Map", ...at }, args, typeArgs: [], ...at });
    this.ctx.exprsState.wanted.set(cloneExpr(made), t);
  }

  // `Object.keys(o)`, `Object.values(o)` and `Object.entries(o)`: o's fields are known while
  // compiling, so each becomes an array literal reading them, the values cloned. A dictionary's
  // become calls of its Map's own, which give its entries in the order they were made.
  /** @throws {CompileError} */
  private objectStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    const name = callee.name;
    if (name !== "keys" && name !== "values" && name !== "entries") throw new CompileError("E0502", `'Object' has no '${name}' yet; it has 'keys', 'values' and 'entries'`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", `'Object' is always there, so 'Object.${name}' is called without '?.'`, e.start, e.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'Object.${name}' takes no type arguments`, e.start, e.end);
    if (e.args.length !== 1 || e.args[0]!.kind === "spread") throw new CompileError("E0504", `'Object.${name}' takes the object to read`, e.start, e.end);
    const o = e.args[0]!;
    const probe = this.spanned(renumbered(cloneExpr(o), this.ctx.tables.ids), o);
    const probed = this.value(probe);
    if (this.dictOf(probed) !== undefined) {
      const call = this.dictCall(e, o, name, []);
      return this.callMade(call);
    }
    const fields = this.objectRead(name, o).fields;
    const at = { start: e.start, end: e.end };
    let elements: Elements = [];
    for (const f of fields) {
      if (name === "keys") elements.push(this.fieldKey(f, at));
      else if (name === "values") elements.push(this.fieldRead(o, f, at));
      else {
        const id = nextId(this.ctx.tables.ids);
        const key = this.fieldKey(f, at);
        const value = this.fieldRead(o, f, at);
        elements.push({ id, kind: "array", elements: [key, value], ...at });
      }
    }
    const array = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "array", elements, ...at });
    this.ctx.tables.objectReads.set(cloneExpr(array), { name, object: cloneExpr(o) });
    return { type: this.value(array), what: `'Object.${name}'` };
  }
  // A field's name, as `Object.keys` gives it.
  private fieldKey(this: Mut<this>, f: Ref<Field>, at: Ref<Span>): Expr {
    return { id: nextId(this.ctx.tables.ids), kind: "string", value: f.name, start: at.start, end: at.end };
  }
  // A field of o read again, cloned unless it copies, as `Object.values` gives it.
  private fieldRead(this: Mut<this>, o: Ref<Expr>, f: Ref<Field>, at: Ref<Span>): Expr {
    const id = nextId(this.ctx.tables.ids);
    const object = this.spanned(renumbered(cloneExpr(o), this.ctx.tables.ids), o);
    const member: Expr = { id, kind: "member", object, name: f.name, optional: false, start: at.start, end: at.end };
    if (this.ctx.tables.typing.isCopy(f.type)) return member;
    return { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: member, name: "clone", optional: false, start: at.start, end: at.end }, args: [], typeArgs: [], optional: false, start: at.start, end: at.end };
  }

  // The fields `Object.keys`, `values` or `entries` reads from o, and the array it gives. An
  // instance gives its public fields, bases' first, in declaration order; an object type has only
  // its sorted order, which printing and JSON use too. Values are typed as the union of the fields'.
  /** @throws {CompileError} */
  private objectRead(this: Mut<this>, name: "keys" | "values" | "entries", o: Ref<Expr>): { fields: Field[]; type: ArrayType } {
    // The object is read once per field, so it has to be a place reading it again gives.
    const notPlace = `'Object.${name}' reads a variable or a field; store this value in a 'const' first`;
    if (!namedPlace(o)) throw new CompileError("E0504", notPlace, o.start, o.end);
    const probe = this.spanned(renumbered(cloneExpr(o), this.ctx.tables.ids), o);
    const read = this.read(probe);
    const t = this.ctx.tables.typing.unfolded(read);
    if (!this.rooted(probe)) throw new CompileError("E0504", notPlace, o.start, o.end);
    const r = this.recOf(t);
    if (r?.kind === "map") {
      const which = r.set ? "Set" : "Map";
      throw new CompileError("E0504", `'Object.${name}' reads an object's fields, and a ${which} has none; use the ${which}'s own '${name}()'`, o.start, o.end);
    }
    // A parameter typed with an object type gives that type's fields, as TypeScript types them.
    const shape: Type = r?.kind === "param" && r.bound !== undefined && this.recOf(r.bound)?.kind === "object" ? r.bound : t;
    const sr = this.recOf(shape);
    if (sr === undefined || !((sr.kind === "object" && !this.ctx.tables.typing.isTuple(shape)) || sr.kind === "class")) throw new CompileError("E0504", `'Object.${name}' reads the fields of an object or a class instance, not '${this.ctx.tables.typing.show(t)}'`, o.start, o.end);
    let all: Field[] = [];
    if (sr.kind === "class") all = this.ctx.tables.typing.allFields(shape as ClassType);
    else if (sr.kind === "object") for (const f of sr.fields) all.push({ ...f });
    let fields: Field[] = [];
    for (const f of all) if ((f.access ?? "public") === "public") fields.push(f);
    if (name !== "keys" && fields.length === 0) throw new CompileError("E0504", `'${this.ctx.tables.typing.show(t)}' has no fields, so 'Object.${name}' would give an array of nothing`, o.start, o.end);
    let widened: Type[] = [];
    for (const f of fields) widened.push(this.ctx.tables.typing.widenLet(f.type));
    const held = this.ctx.tables.typing.unionType(widened);
    const element = name === "keys" ? "string" : name === "values" ? held : this.ctx.tables.typing.tupleType(["string", held]);
    return { fields, type: this.ctx.tables.typing.arrayType(element) };
  }

  // `n` as the `i64` an array's length is made from, checked to be an i64 or a usize, and with
  // `panics` a negative one ending the program at n.
  private arrayLength(this: Mut<this>, n: Ref<Expr>, panics: boolean): Expr {
    const checked: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "fill length", start: n.start, end: n.end }, args: [cloneExpr(n)], typeArgs: [], optional: false, start: n.start, end: n.end };
    if (panics) this.ctx.tables.lengthChecks.add(cloneExpr(checked));
    return checked;
  }

  // A method calling a callback converts each value it passes to the parameter's type, so a
  // literal may widen, except a reference or, with `converted` false, an index, which it passes
  // as it is. The argument always comes, so the parameter can't be optional.
  /** @throws {CompileError} */
  private passedExactly(this: Mut<this>, name: string, given: Type, written: Type, p: Ref<Param> | undefined, at: Ref<Span>, converted = true) {
    const optional = p !== undefined && (p.optional || this.ctx.tables.defaulted.has(p));
    if (optional && !this.ctx.tables.typing.sameLowered(given, written)) throw new CompileError("E0506", `'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    if (this.ctx.tables.typing.sameLowered(given, written) || (converted && !this.isRefType(given) && this.ctx.tables.typing.fits(given, written))) return;
    if (optional) throw new CompileError("E0506", `'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    // A declared function given by name takes its own value, which a lent element isn't.
    const named = p !== undefined ? this.ctx.tables.namedParams.get(p) : undefined;
    if (named !== undefined && this.isRefType(given)) {
      const to = this.ctx.tables.typing.rec(given).to;
      if (this.ctx.tables.typing.sameLowered(to, written)) {
        let passed: string[] = [];
        for (let i: usize = 0; i < named.names.length; i++) passed.push(named.clones[i] === true ? `${named.names[i]!}.clone()` : named.names[i]!);
        const arrow = `(${named.names.join(", ")}) => ${named.fn}(${passed.join(", ")})`;
        throw new CompileError("E0506", `'${name}' lends its callback ${article(this.ctx.tables.typing.show(given))}, and '${named.fn}' takes its own '${this.ctx.tables.typing.show(written)}'; write '${arrow}', or have '${named.fn}' take a '${this.ctx.tables.typing.show(given)}'`, at.start, at.end);
      }
    }
    throw new CompileError("E0506", `'${name}' passes its callback ${article(this.ctx.tables.typing.show(given))} here, not ${article(this.ctx.tables.typing.show(written))}`, at.start, at.end);
  }

  // The element type of a spread, `...x`. An array spreads its elements, cloned unless it was made
  // for the spread; a string, a generator, a Map or a Set is first made into the array
  // `Array.from` would make of it.
  /** @throws {CompileError} */
  private spreadElements(this: Mut<this>, x: Ref<Extract<Expr, { kind: "spread" }>>): Type {
    const source = x.value;
    const t = this.value(source);
    const held = this.heldBy(t)!;
    const at = { start: source.start, end: source.end };
    let from: Expr | undefined = undefined;
    if ((this.dictOf(held) !== undefined)) throw this.notIterable(at);
    if (this.ctx.tables.typing.iterableElement(held) !== undefined) throw unsupported("spreads of an 'Iterable' parameter", source);
    const inner = this.embeddedIterated(source, held);
    if (inner !== undefined) {
      const replaced = this.ctx.tables.rewrites.replace(x, { ...x, value: inner });
      if (replaced.kind === "spread") return this.spreadElements(replaced);
    }
    if (stringLike(this.ctx.tables.typing, held)) from = this.callOf({ id: nextId(this.ctx.tables.ids), kind: "ident", name: "array chars", ...at }, [cloneExpr(source)], at);
    else if (this.ctx.tables.typing.yieldsOf(held) !== undefined) from = this.callOf({ id: nextId(this.ctx.tables.ids), kind: "ident", name: "array collect", ...at }, [cloneExpr(source)], at);
    // Asked twice, as the ids each asking makes are kept in step with the code before.
    else if (this.iteratorCall(source, held) !== undefined) {
      const callee: Expr = { id: nextId(this.ctx.tables.ids), kind: "ident", name: "array collect", ...at };
      const iterated = this.iteratorCall(source, held)!;
      from = this.callOf(callee, [iterated], at);
    } else if (this.recOf(held)?.kind === "map") from = this.callOf({ id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(source), name: this.ctx.tables.typing.rec(held as MapType).set ? "values" : "entries", optional: false, ...at }, [], at);
    else if (!this.isArray(held)) throw new CompileError("E0119", `'...' spreads an array, a string, a generator, a Map, a Set or an iterable class, not '${this.ctx.tables.typing.show(t)}'`, source.start, source.end);
    if (from !== undefined) {
      this.ctx.exprsState.once.add(cloneExpr(source));
      const replaced = this.ctx.tables.rewrites.replace(x, { ...x, value: from });
      if (replaced.kind === "spread") {
        const array = this.value(replaced.value);
        return this.spreadTyped(replaced, array);
      }
    }
    return this.spreadTyped(x, t);
  }
  // The element type of a spread of an array, or of a reference to one, of type `array`.
  /** @throws {CompileError} */
  private spreadTyped(this: Mut<this>, x: Ref<Extract<Expr, { kind: "spread" }>>, array: Type): Type {
    const held = this.isRefType(array) ? this.ctx.tables.typing.rec(array).to : array;
    const lowered = this.ctx.tables.typing.lowerKeepingBrands(held) as ArrayType;
    if (this.isRefType(array)) this.ctx.coercions.set(cloneExpr(x.value), lowered);
    const element = this.ctx.tables.typing.rec(lowered).element;
    this.clonable(element, x, "a spread");
    // Codegen converts each element from this type.
    this.ctx.types.set(cloneExpr(x), element);
    return element;
  }
  // A call of `callee`, made after it so their ids come in that order.
  private callOf(this: Mut<this>, callee: Expr, args: Expr[], at: Ref<Span>): Expr {
    return { id: nextId(this.ctx.tables.ids), kind: "call", callee, args, typeArgs: [], optional: false, start: at.start, end: at.end };
  }

  // A call's arguments after the fixed parameters fill its rest parameter, as one array literal,
  // where a spread argument spreads as in any literal. Packed once, as a generic body is
  // checked again for each instance.
  /** @throws {CompileError} */
  private packRest(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" | "new" }>>, list: Ref<Expr[]>, params: Ref<Param[]>): Expr | undefined {
    if (this.ctx.tables.packed.has(e)) return undefined;
    const fixed: usize = params.length - 1;
    this.refuseSpread(list.slice(0, fixed as i64));
    if (list.length < fixed) return undefined;
    let args: Expr[] = [];
    let rest: Elements = [];
    for (let i: usize = 0; i < list.length; i++) {
      if (i < fixed) args.push(cloneExpr(list[i]!));
      else rest.push(cloneExpr(list[i]!));
    }
    const at = fixed < list.length ? { start: list[fixed]!.start, end: list[list.length - 1]!.end } : { start: e.end - 1, end: e.end - 1 };
    args.push({ id: nextId(this.ctx.tables.ids), kind: "array", elements: rest, ...at });
    const made = this.ctx.tables.rewrites.replace(e, withArgs(e, args));
    this.ctx.tables.packed.add(cloneExpr(made));
    return made;
  }

  // `f(...t)` over a tuple named by a variable passes its elements, as `f(t[0], t[1])` would,
  // a rest tuple's array spreading after them. Each element reads the variable again, so a
  // tuple made for the call has to be named first.
  /** @throws {CompileError} */
  private spreadTuples(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" | "new" }>>): Expr | undefined {
    if (e.args !== undefined) {
      let tuples: (ObjectType | undefined)[] = [];
      let any = false;
      for (const a of e.args) {
        const t = a.kind === "spread" ? this.spreadTuple(a.value) : undefined;
        if (t !== undefined) any = true;
        tuples.push(t);
      }
      if (!any) return undefined;
      let parts: Expr[] = [];
      for (let i: usize = 0; i < e.args.length; i++) this.spreadParts(e.args[i]!, tuples[i], parts);
      return this.ctx.tables.rewrites.replace(e, withArgs(e, parts));
    }
    return undefined;
  }

  // An argument as `spreadTuples` passes it: itself, or a tuple's elements read from its variable.
  private spreadParts(this: Mut<this>, a: Ref<Expr>, t: ObjectType | undefined, parts: Mut<Expr[]>): void {
    if (t === undefined || a.kind !== "spread") {
      parts.push(cloneExpr(a));
      return;
    }
    const now = this.ctx.tables.rewrites.rewritten(a.value);
    const source = now !== undefined ? now : cloneExpr(a.value);
    const at = { start: a.start, end: a.end };
    const count = this.ctx.tables.typing.elementsOf(t).length;
    for (let n: usize = 0; n < count; n++) parts.push(this.tupleElement(source, `${n}`, at));
    if (this.ctx.tables.typing.rec(t).rest !== undefined) {
      const id = nextId(this.ctx.tables.ids);
      parts.push({ id, kind: "spread", value: this.tupleElement(source, "...", at), start: at.start, end: at.end });
    }
  }
  private tupleElement(this: Mut<this>, source: Ref<Expr>, name: string, at: Ref<Span>): Expr {
    const id = nextId(this.ctx.tables.ids);
    const object = withIdExpr(cloneExpr(source), nextId(this.ctx.tables.ids), 0);
    return { id, kind: "member", object, name, optional: false, start: at.start, end: at.end };
  }

  // The tuple a spread argument's variable holds, if it holds one.
  /** @throws {CompileError} */
  private spreadTuple(this: Mut<this>, given: Ref<Expr>): ObjectType | undefined {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.spreadTupleNow(now) : this.spreadTupleNow(given);
  }
  /** @throws {CompileError} */
  private spreadTupleNow(this: Mut<this>, source: Ref<Expr>): ObjectType | undefined {
    if (source.kind !== "ident") return undefined;
    const t = this.value(source);
    this.ctx.exprsState.once.add(cloneExpr(source));
    const held = this.heldBy(t)!;
    return this.ctx.tables.typing.isTuple(held) && !this.ctx.tables.typing.rec(held as ObjectType).match ? (held as ObjectType) : undefined;
  }

  // A spread argument fills only a rest parameter, since an array's length isn't known while compiling.
  /** @throws {CompileError} */
  private refuseSpread(this: Mut<this>, list: Ref<Expr[]>) {
    const spread = list.find((a) => a.kind === "spread");
    if (spread?.kind !== "spread") return;
    // A tuple reached any other way than by a variable would be read again for each element.
    const t = this.value(spread.value);
    const held = this.heldBy(t)!;
    if (this.ctx.tables.typing.isTuple(held)) throw new CompileError("E0408", "a tuple spreads into parameters from a variable, since each element reads it again; name it first, as in 'const t = pair(); f(...t)'", spread.start, spread.end);
    throw new CompileError("E0408", "a spread argument fills only a rest parameter, as in 'function f(...xs: T[])', since an array's length isn't known while compiling; a tuple spreads into parameters from a variable, as in 'const t = pair(); f(...t)'", spread.start, spread.end);
  }

  // A closure that moves a capture out of itself can run only once, which a method calling it
  // again and again can't allow.
  /** @throws {CompileError} */
  private runsOften(c: ClosureType, name: string, calls: string, at: Ref<Span>) {
    const once = this.ctx.tables.typing.rec(c).once;
    if (once !== undefined) throw new CompileError("E0210", `'${name}' calls ${calls}, but this closure moves '${once}' out, so it can run only once; clone it inside instead`, at.start, at.end);
  }

  // `includes` and `indexOf` compare elements by value, as `===` does; `join` writes each as
  // `String(x)` would; `slice` gives clones of a range, its positions as JavaScript reads them.
  /** @throws {CompileError} */
  private readingCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (name === "concat") {
      // Each array given is read, as this one is, and its elements cloned.
      for (const a of e.args) {
        this.expect(a, array);
        const t = this.value(a);
        const given = this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t;
        // A literal, `[]` and `[2]` among them, takes the element type as an annotated one does.
        if (!(a.kind === "array" && this.literalArray(a, t, array)) && !this.ctx.tables.typing.fits(given, array)) throw new CompileError("E0504", `'concat' joins arrays of the same element type, '${this.ctx.tables.typing.show(array)}', not '${this.ctx.tables.typing.show(t)}'; to add single values, push them`, a.start, a.end);
        this.ctx.coercions.set(cloneExpr(a), this.ctx.tables.typing.refType(array, false));
      }
      return { type: array, what: "'concat'" };
    }
    if (name === "flat") {
      if (e.args.length > 0) throw new CompileError("E0504", "'flat' flattens one level so far, so it takes no depth", e.args[0]!.start, e.args[0]!.end);
      const inner = this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(array).element);
      if (typeof inner === "string" || this.ctx.tables.typing.rec(inner).kind !== "array") throw new CompileError("E0504", `'flat' flattens an array of arrays, not '${this.ctx.tables.typing.show(array)}'`, callee.start, callee.end);
      return { type: inner, what: "'flat'" };
    }
    const finds = name === "includes" || name === "indexOf" || name === "lastIndexOf";
    const most: usize = name === "join" && !finds ? 1 : 2;
    const takes = finds ? "a value to look for and an optional position to start from" : name === "join" ? "an optional separator" : "an optional start and end";
    const least: usize = finds ? 1 : 0;
    if (e.args.length < least || e.args.length > most) throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    const element = this.ctx.tables.typing.rec(array).element;
    if (name === "join") {
      const lowered = this.ctx.tables.typing.lower(element);
      if (!this.joinable(lowered)) {
        throw new CompileError("E0504", `'join' writes each element as 'String(x)' does, which works for numbers, booleans and strings, not '${this.ctx.tables.typing.show(element)}'`, callee.start, callee.end);
      }
      if (e.args.length > 0) this.argument(e.args[0]!, "string");
      return { type: "string", what: "'join'" };
    }
    if (name === "slice") {
      for (const a of e.args) this.argument(a, "i64");
      return { type: array, what: "'slice'" };
    }
    const sought = e.args[0]!;
    this.expect(sought, element);
    const t = this.value(sought);
    if (objectsMeet(this.ctx.tables.typing, element, t)) throw new CompileError("E0112", `'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    // A value that fits the element type, a literal of a sized number too, is one.
    if (this.ctx.tables.typing.fits(t, element) || (isNumeric(this.ctx.tables.typing.widenLet(t)) && isNumeric(element) && isFloat(this.ctx.tables.typing.widenLet(t)) === isFloat(element))) {
      if (e.args.length > 1) this.argument(e.args[1]!, "i64");
      this.coerce(sought, t, element, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(element)}'`);
      return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
    }
    if (objectsMeet(this.ctx.tables.typing, element, t)) throw new CompileError("E0112", `'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    if (!comparable(this.ctx.tables.typing, element, t)) throw new CompileError("E0112", `'${name}' can never find a '${this.ctx.tables.typing.show(this.ctx.tables.typing.widenLet(t))}' among elements of type '${this.ctx.tables.typing.show(element)}'`, sought.start, sought.end);
    if (e.args.length > 1) this.argument(e.args[1]!, "i64");
    return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
  }
  // An argument checked as a `want`, converted to it where it fits.
  /** @throws {CompileError} */
  private argument(this: Mut<this>, a: Ref<Expr>, want: Type): void {
    this.expect(a, want);
    const t = this.value(a);
    this.coerce(a, t, want, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(want)}'`);
  }
  // Literals, and unions of them, are written as their values.
  private joinable(t: Type): boolean {
    const r = this.recOf(t);
    if (isNumeric(t) || t === "boolean" || t === "string" || r?.kind === "literal") return true;
    if (r?.kind !== "union") return false;
    for (const m of r.members) if (!this.joinable(m)) return false;
    return true;
  }

  // A raw pointer's methods, all inside `unsafe`: reading and writing what it points at, which
  // must be a plain value a raw write can't leave dangling, moving along by elements, and
  // telling whether it points anywhere.
  /** @throws {CompileError} */
  private pointerCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, p: PointerType): { type: Type; what: string } {
    const counts: Record<string, usize> = { read: 0, write: 1, offset: 1, isNull: 0 };
    if (!(callee.name in counts)) throw new CompileError("E1006", `raw pointers have no method '${callee.name}'; they have 'read', 'write', 'offset' and 'isNull'`, callee.start, callee.end);
    this.needsUnsafe(`'${callee.name}' on a raw pointer`, { start: callee.start, end: callee.end });
    if (this.linked(callee)) throw unsupported("optional chains calling raw pointer methods", callee);
    const held = this.ctx.types.get(callee.object)!;
    if (this.isRefType(held)) this.ctx.coercions.set(callee.object, p);
    if (e.args.length !== counts[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${counts[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const { to } = this.ctx.tables.typing.rec(p);
    const plain = isNumeric(to) || to === "boolean" || this.recOf(to)?.kind === "pointer";
    if ((callee.name === "read" || callee.name === "write") && !plain) throw unsupported(`raw reads and writes of '${this.ctx.tables.typing.show(to)}'`, callee);
    if (callee.name === "read") return { type: to, what: "'read'" };
    if (callee.name === "isNull") return { type: "boolean", what: "'isNull'" };
    const a = e.args[0]!;
    const want = callee.name === "write" ? to : "i64";
    if (callee.name === "write" && !this.ctx.tables.typing.rec(p).mutable) throw new CompileError("E1006", "'write' needs a 'MutPtr'; a 'Ptr' only reads what it points at", callee.start, callee.end);
    this.expect(a, want);
    const t = this.value(a);
    this.coerce(a, t, want, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(want)}'`);
    return { type: callee.name === "write" ? "void" : p, what: `'${callee.name}'` };
  }

  // `new Atomic(v)`, `new Lock(v)`, `new Cell(v)`: one holding v, of its type argument, the type
  // expected of it, or else v's own type.
  /** @throws {CompileError} */
  private interiorNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, which: InteriorRecord["which"], list: Ref<Expr[]>): Type {
    if (list.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", `'${which}' takes the value it starts with, as in 'new ${which}(0)'`, e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const given = e.typeArgs[0] ? this.ctx.tables.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : r?.kind === "interior" && r.which === which ? r.of : undefined;
    if (given) this.expect(list[0]!, given);
    const t = this.value(list[0]!);
    const of = given ?? this.ctx.tables.typing.heldArgument(this.ctx.tables.typing.widenLet(t));
    this.coerce(list[0]!, t, of, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    return interior(this.ctx.tables.typing, which, of, e);
  }

  // `new Rc(v)`: v moved into a new block with one count. `new Weak<T>()` reaches no value, so it
  // never upgrades, for a back-reference made before what it points to.
  /** @throws {CompileError} */
  private countedNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, which: "Rc" | "Weak", list: Ref<Expr[]>): Type {
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const given = e.typeArgs[0] ? this.ctx.tables.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : r?.kind === "shared" && r.which === which ? r.of : undefined;
    if (which === "Weak") {
      if (list.length !== 0 || e.typeArgs.length > 1 || given === undefined) throw new CompileError("E0504", "'new Weak<T>()' takes no value and reaches none; make a Weak that reaches one with 'rc.downgrade()'", e.start, e.end);
      return counted(this.ctx.tables.typing, given, which, e);
    }
    if (list.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", "'Rc' takes the value it starts with, as in 'new Rc(node)'", e.start, e.end);
    if (given) this.expect(list[0]!, given);
    const t = this.value(list[0]!);
    const of = given ?? this.ctx.tables.typing.heldArgument(this.ctx.tables.typing.widenLet(t));
    this.coerce(list[0]!, t, of, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    return counted(this.ctx.tables.typing, of, which, e);
  }

  // An Atomic's methods, JavaScript's `Atomics` on one value: each changes it in one step, seen
  // the same by every thread, and gives what it held before, except `store`.
  /** @throws {CompileError} */
  private interiorCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: InteriorType): { type: Type; what: string } {
    this.where(callee, t);
    if (this.ctx.tables.typing.rec(t).which === "Cell") return this.cellCall(e, callee, t);
    if (this.ctx.tables.typing.rec(t).which === "Lock" || this.ctx.tables.typing.rec(t).which === "RwLock") return this.lockCall(e, callee, t);
    if (this.ctx.tables.typing.rec(t).which !== "Atomic") throw new CompileError("E0502", `'${this.ctx.tables.typing.rec(t).which}' has no method '${callee.name}'`, callee.start, callee.end);
    const takes: Record<string, usize> = { load: 0, store: 1, add: 1, sub: 1, exchange: 1, compareExchange: 2 };
    if (!(callee.name in takes)) throw new CompileError("E0502", `'Atomic' has no method '${callee.name}'; it has 'load', 'store', 'add', 'sub', 'exchange' and 'compareExchange'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Atomic' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : `${takes[callee.name]} arguments`}`, e.start, e.end);
    const of = this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of);
    if ((callee.name === "add" || callee.name === "sub") && !isInteger(of)) throw new CompileError("E0504", `'${callee.name}' needs an integer 'Atomic', not '${this.ctx.tables.typing.show(t)}'`, callee.start, callee.end);
    for (const a of e.args) {
      this.expect(a, of);
      const given = this.value(a);
      this.coerce(a, given, of, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    }
    return { type: callee.name === "store" ? "void" : of, what: `'${callee.name}'` };
  }

  // An Atomic's, Cell's or Lock's method changes it where it lives, so it is called on a place,
  // a reference, or a value just made; anything else would change a copy.
  /** @throws {CompileError} */
  private where(callee: Ref<Extract<Expr, { kind: "member" }>>, t: InteriorType) {
    const inPlace = (written: Expr): boolean => {
      const e = this.ctx.tables.rewrites.current(written);
      const type = this.ctx.types.get(e);
      if (this.recOf(type)?.kind === "ref") return true;
      if (e.kind === "ident" || e.kind === "this" || e.kind === "call" || e.kind === "new") return true;
      if (e.kind === "member") {
        // A field shared by a union's members is read from a copy of the union.
        const holder = this.recOf(this.ctx.types.get(e.object));
        const held = holder?.kind === "ref" ? this.recOf(holder.to) : holder;
        const inside = held?.kind === "object" || held?.kind === "class" || held?.kind === "shared";
        return inside && !this.ctx.calls.has(e) && !this.ctx.copiesOut.has(e) && inPlace(e.object);
      }
      return this.element(e) && inPlace(e.object);
    };
    if (inPlace(callee.object)) return;
    const hint = this.bare(callee.object).kind === "nonNull" ? "; narrow the Option with a check like 'if (x !== null)' instead of '!'" : "; narrow a union to one member first";
    throw new CompileError("E0212", `'${callee.name}' works on the '${this.ctx.tables.typing.rec(t).which}' where it lives, so call it on a variable or a field${hint}`, callee.start, callee.end);
  }

  // A Cell's methods, Rust's: `get` copies out what it holds, `set` puts a value in, dropping
  // the old one, and `replace` puts one in and gives the old one back.
  /** @throws {CompileError} */
  private cellCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: InteriorType): { type: Type; what: string } {
    const takes: Record<string, usize> = { get: 0, set: 1, replace: 1 };
    if (!(callee.name in takes)) throw new CompileError("E0502", `'Cell' has no method '${callee.name}'; it has 'get', 'set' and 'replace'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Cell' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const of = this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of);
    if (callee.name === "get" && !this.ctx.tables.typing.isCopy(of)) throw new CompileError("E0504", `'get' copies what a Cell holds, which a '${this.ctx.tables.typing.show(of)}' can't be; use 'replace' to take it out and put another in`, callee.start, callee.end);
    for (const a of e.args) {
      this.expect(a, of);
      const given = this.value(a);
      this.coerce(a, given, of, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    }
    return { type: callee.name === "set" ? "void" : of, what: `'${callee.name}'` };
  }

  // `new Semaphore(n)` with n slots, and `new Channel<T>(capacity)`, of its type argument or the
  // type expected of it.
  /** @throws {CompileError} */
  private blockNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, which: "Semaphore" | "Channel", list: Ref<Expr[]>): Type {
    const what = which === "Semaphore" ? "the number of slots it hands out, as in 'new Semaphore(4)'" : "how many values it holds before 'send' waits, as in 'new Channel<string>(8)'";
    if (list.length !== 1 || e.typeArgs.length > (which === "Channel" ? 1 : 0)) throw new CompileError("E0504", `'${which}' takes ${what}`, e.start, e.end);
    this.expect(list[0]!, "i64");
    const t = this.value(list[0]!);
    this.coerce(list[0]!, t, "i64", `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type 'i64'`);
    if (which === "Semaphore") return this.ctx.tables.typing.blockType("Semaphore");
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const of = e.typeArgs[0] ? this.ctx.resolveType(e.typeArgs[0]) : r?.kind === "block" && r.which === "Channel" ? r.of : undefined;
    if (!of) throw new CompileError("E0104", "'Channel' needs the type it carries, as in 'new Channel<string>(8)'", e.start, e.end);
    return channel(this.ctx.tables.typing, of, e);
  }

  // Whether a place is read through a Dyn, or a runtime-computed property, anywhere along its
  // path: such a read gives a copy, which a change would be lost in.
  private readCopy(given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.readCopyNow(now) : this.readCopyNow(given);
  }
  private readCopyNow(e: Ref<Expr>): boolean {
    for (let at = e; ; ) {
      if (this.ctx.tables.computed.has(at)) return true;
      if (at.kind === "member" || at.kind === "index") at = at.object;
      else if (at.kind === "nonNull") at = at.expr;
      else return false;
    }
  }

  // A Map's and a Set's methods. Those changing it need it in a place that may change, or a
  // `Mut` borrow of it, which `set` and `add` give for chaining. What they give out are clones.
  /** @throws {CompileError} */
  private mapCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: MapType): { type: Type; what: string } {
    const name = callee.name;
    const isSet = this.ctx.tables.typing.rec(t).set;
    const kind = isSet ? "Set" : "Map";
    if (isSet ? !SET_METHODS.has(name) : !MAP_METHODS.has(name)) throw new CompileError("E0502", `'${kind}' has no method '${name}' yet${didYouMean(name, isSet ? [...SET_METHODS] : [...MAP_METHODS])}`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported(`optional chains calling '${kind}' methods`, callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    const count = MAP_ARGUMENTS[name]!;
    if (e.args.length !== count) throw new CompileError("E0504", `'${name}' takes ${count === 0 ? "no arguments" : count === 1 ? "1 argument" : `${count} arguments`}`, e.start, e.end);
    const held = this.ctx.types.get(callee.object)!;
    if (this.isRefType(held)) this.ctx.coercions.set(callee.object, t);
    if (MAP_CHANGES.has(name)) {
      if (this.readCopy(callee.object)) throw new CompileError("E0211", `'${name}' changes its ${kind}, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
      // A class extending Map or Set lends its collection where it is lent.
      const holder = callee.object.kind === "member" && callee.object.name === EMBEDDED ? this.ctx.types.get(callee.object.object) : undefined;
      const lent = (this.isRefType(held) && this.ctx.tables.typing.rec(held).mutable) || (holder !== undefined && this.isRefType(holder) && this.ctx.tables.typing.rec(holder).mutable);
      if (!this.place(callee.object) && !lent) throw new CompileError("E0212", `'${name}' changes its ${kind}, so call it on a variable or a field`, callee.start, callee.end);
      if (!lent) this.changeable(callee.object, name === "clear" ? "clear" : name === "delete" ? "delete from" : name === "update" ? "update" : "add to");
    }
    const argument = (x: Expr, to: Type) => {
      this.expect(x, to);
      const got = this.value(x);
      this.coerce(x, got, to, `argument of type '${this.ctx.tables.typing.show(got)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(to)}'`);
    };
    if (count > 0 && name !== "forEach") argument(e.args[0]!, this.ctx.tables.typing.rec(t).key);
    switch (name) {
      case "set":
      case "add":
        if (name === "set") argument(e.args[1]!, this.ctx.tables.typing.rec(t).value);
        this.ctx.borrowsFrom.set(e, [callee.object]);
        return { type: this.ctx.tables.typing.refType(t, true), what: `'${name}'` };
      case "get":
        this.clonable(this.ctx.tables.typing.rec(t).value, callee, undefined, true);
        return { type: this.ctx.tables.typing.unionType([this.ctx.tables.typing.rec(t).value, "null"]), what: "'get'" };
      case "has":
      case "delete":
        return { type: "boolean", what: `'${name}'` };
      case "clear":
        return { type: "void", what: "'clear'" };
      case "keys":
        return { type: this.ctx.tables.typing.arrayType(this.ctx.tables.typing.rec(t).key), what: "'keys'" };
      case "values":
        if (this.ctx.tables.typing.rec(t).set) return { type: this.ctx.tables.typing.arrayType(this.ctx.tables.typing.rec(t).key), what: "'values'" };
        this.clonable(this.ctx.tables.typing.rec(t).value, callee, undefined, true);
        return { type: this.ctx.tables.typing.arrayType(this.ctx.tables.typing.rec(t).value), what: "'values'" };
      case "entries":
        this.clonable(this.ctx.tables.typing.rec(t).value, callee, undefined, true);
        return { type: this.ctx.tables.typing.arrayType(this.ctx.tables.typing.tupleType(this.ctx.tables.typing.rec(t).set ? [this.ctx.tables.typing.rec(t).key, this.ctx.tables.typing.rec(t).key] : [this.ctx.tables.typing.rec(t).key, this.ctx.tables.typing.rec(t).value])), what: "'entries'" };
    }
    // `update(k, f)` and `forEach(f)` call an arrow written in place: `update`'s gets the value
    // to change, once, and `forEach`'s each value and its key in turn, borrowed or copied.
    const callback = e.args[name === "update" ? 1 : 0]!;
    this.namedFunction(callback);
    if (callback.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const lend = (u: Type) => (this.ctx.tables.typing.isCopy(u) ? u : this.ctx.tables.typing.refType(u, false));
    // A Set's forEach passes each member twice, as JavaScript's does.
    const { key, value: entry, set } = this.ctx.tables.typing.rec(t);
    const params = name === "update" ? [this.ctx.tables.typing.refType(entry, true)] : set ? [lend(key), lend(key)] : [lend(entry), lend(key)];
    const passes = name === "update" ? "the value to change" : set ? "each member" : "each value and its key";
    const signature = this.ctx.tables.typing.functionType(params.map((_, i) => (i === 0 ? "value" : "key")), params, "void");
    this.ctx.tables.typing.openThrows.add(signature);
    this.expect(callback, signature);
    const called = this.value(callback);
    const c = this.recOf(called);
    if (c?.kind !== "closure" || c.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${passes}${name === "forEach" ? "; JavaScript's last argument, the collection, isn't passed, since it is already borrowed" : ""}`, callback.start, callback.end);
    }
    if (name === "forEach") this.runsOften(called as ClosureType, name, "its callback once per entry", callback);
    c.params.forEach((p, i) => {
      const at = callback.params[i] ?? callback;
      this.passedExactly(name, params[i]!, p, callback.params[i], at);
    });
    if (this.holdsFuture(c.returns)) throw new CompileError("E0801", `'${name}' with a callback giving a Promise isn't supported yet`, callback.start, callback.end);
    if (c.throws) this.ctx.raise(e, c.throws, `'${name}'`);
    return { type: name === "update" ? "boolean" : "void", what: `'${name}'` };
  }

  // `new Map<K, V>()` and `new Set<T>()`, their types written or taken from where they're expected.
  /** @throws {CompileError} */
  private mapNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, set: boolean, list: Ref<Expr[]>): Type {
    const name = set ? "Set" : "Map";
    const shape = set ? "an array of members, as in 'new Set([\"a\", \"b\"])'" : "an array of key and value pairs, as in 'new Map([[\"a\", 1]])'";
    if (list.length > 1) throw new CompileError("E0504", `'new ${name}' takes ${shape}, or nothing`, e.start, e.end);
    if (e.typeArgs.length > 0 && e.typeArgs.length !== (set ? 1 : 2)) throw new CompileError("E0116", set ? "'Set' takes the type of its members, like 'new Set<string>()'" : "'Map' takes its key and value types, like 'new Map<string, i64>()'", e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const made = e.typeArgs.length > 0 ? collection(this.ctx.tables.typing, this.ctx.resolveType(e.typeArgs[0]!), set ? "void" : this.ctx.resolveType(e.typeArgs[1]!), set, e)
      : this.recOf(expected)?.kind === "map" && this.ctx.tables.typing.rec(expected as MapType).set === set ? expected as MapType : undefined;
    // The entries or members are moved in from an array, which gives the types when nothing else does.
    const from = list[0];
    const entries = made && (set ? this.ctx.tables.typing.rec(made).key : this.ctx.tables.typing.tupleType([this.ctx.tables.typing.rec(made).key, this.ctx.tables.typing.rec(made).value]));
    if (from) {
      if (entries) this.expect(from, this.ctx.tables.typing.arrayType(entries));
      else if (!set && from.kind === "array") for (const x of from.elements) if (x?.kind === "array" && x.elements.length === 2) this.ctx.tables.pairs.add(x);
      const t = this.value(from);
      if (made && entries) {
        const wants = this.ctx.tables.typing.arrayType(entries);
        this.coerce(from, t, wants, `'new ${name}' takes ${shape}, not '${this.ctx.tables.typing.show(t)}'`);
        return made;
      }
      const element = this.isArray(t) ? this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(t).element) : undefined;
      const tuple = element !== undefined && this.ctx.tables.typing.isTuple(element) ? this.ctx.tables.typing.rec(element as ObjectType) : undefined;
      const pair = tuple && tuple.fields.length === 2 && tuple.rest === undefined && tuple.required === undefined ? this.ctx.tables.typing.elementsOf(element as ObjectType) : undefined;
      if (element === undefined || (!set && !pair)) throw new CompileError("E0504", `'new ${name}' takes ${shape}, not '${this.ctx.tables.typing.show(t)}'`, from.start, from.end);
      // Each closure is its own type, so which callable type the values share must be written.
      const v = set ? undefined : this.ctx.tables.typing.lower(pair![1]!);
      const fn = this.recOf(v);
      if (fn?.kind === "closure") throw new CompileError("E0104", `a 'Map' of functions needs its types written, as in 'new Map<${this.ctx.tables.typing.show(this.ctx.tables.typing.widenLet(pair![0]!))}, ${fn.name}>(...)'`, e.start, e.end);
      const result = collection(this.ctx.tables.typing, this.ctx.tables.typing.widenLet(set ? element : pair![0]!), set ? "void" : this.ctx.tables.typing.widenLet(pair![1]!), set, e);
      const wants = this.ctx.tables.typing.arrayType(set ? this.ctx.tables.typing.rec(result).key : this.ctx.tables.typing.tupleType([this.ctx.tables.typing.rec(result).key, this.ctx.tables.typing.rec(result).value]));
      this.coerce(from, t, wants, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(wants)}'`);
      return result;
    }
    if (made) return made;
    throw new CompileError("E0104", set ? "'new Set()' needs the type of its members, as in 'new Set<string>()'" : "'new Map()' needs its key and value types, as in 'new Map<string, i64>()'", e.start, e.end);
  }

  // `handle.join()`: the task's handle, awaited as giving its value or throwing a TaskPanic.
  /** @throws {CompileError} */
  private handleCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: HandleType): { type: Type; what: string } {
    if (callee.name !== "join") throw new CompileError("E0305", `'${this.ctx.tables.typing.show(t)}' has no method '${callee.name}'; ${(this.ctx.tables.typing.rec(t).joined !== undefined) ? "await it" : "it has 'join', and awaiting it gives what the task gave"}`, callee.start, callee.end);
    if ((this.ctx.tables.typing.rec(t).joined !== undefined)) throw new CompileError("E0305", "this is already the task's 'join()'; await it", callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'join'", callee);
    if (e.args.length !== 0) throw new CompileError("E0305", "'join' takes no arguments", e.start, e.end);
    if (this.isRefType(this.ctx.types.get(callee.object)!)) throw new CompileError("E0305", "'join' takes the handle over, so it needs the handle itself, not a borrow of it", callee.object.start, callee.object.end);
    this.ctx.tables.joinCalls.add(cloneExpr(e));
    return { type: this.ctx.tables.typing.joinedType(t, this.ctx.tables.arenas.classOf(this.ctx.classes.get("TaskPanic")!).type), what: "'join'" };
  }

  // A Semaphore's `acquire()` and `available()`, and a Channel's `send(v)`, `receive()` and
  // `close()`. A Permit has no methods: dropping it gives its slot back.
  /** @throws {CompileError} */
  private blockCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: BlockType): { type: Type; what: string } {
    const which = this.ctx.tables.typing.rec(t).which;
    if (which === "JsValue") return this.jsMethodCall(e, callee, t);
    if (which === "UdpSocket") return this.udpCall(e, callee);
    // A wait may also take an AbortSignal, as its last argument.
    const sockets = ["accept", "read", "write"].includes(callee.name);
    const waits = callee.name === "acquire" || callee.name === "send" || callee.name === "receive" || sockets;
    const methods: Record<string, usize> = which === "Semaphore" ? { acquire: 0, available: 0 } : which === "Channel" ? { send: 1, receive: 0, close: 0, ...(e.start >= STD_BASE ? { settle: 1 } : {}) }
      : which === "AbortController" ? { abort: 0 } : which === "AbortSignal" ? { throwIfAborted: 0 } : which === "TcpListener" || which === "UnixListener" ? { accept: 0, ...(e.start >= STD_BASE ? { listenTls: 2 } : {}) }
      : which === "TcpStream" || which === "UnixStream" ? { read: 1, write: 1, ...(e.start >= STD_BASE ? { startTls: 2 } : {}) } : {};
    if (!(callee.name in methods)) {
      const has = which === "Semaphore" ? "it has 'acquire' and 'available'" : which === "Channel" ? "it has 'send', 'receive', 'close' and 'clone'"
        : which === "AbortController" ? "it has 'abort' and 'signal'" : which === "AbortSignal" ? "it has 'throwIfAborted' and 'aborted'"
        : which === "TcpListener" ? "it has 'accept' and 'port'" : which === "UnixListener" ? "it has 'accept', and dropping it stops listening but leaves its socket file" : which === "TcpStream" || which === "UnixStream" ? "it has 'read', 'write' and 'clone', and dropping it closes it" : "dropping it gives its slot back";
      throw new CompileError("E0502", `'${this.ctx.tables.typing.show(t)}' has no method '${callee.name}'; ${has}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported(`optional chains calling '${this.ctx.tables.typing.rec(t).which}' methods`, callee);
    const signalled = waits && e.args.length === methods[callee.name]! + 1;
    if (e.args.length !== methods[callee.name] && !signalled) throw new CompileError("E0504", `'${callee.name}' takes ${methods[callee.name] === 1 ? "1 argument" : "no arguments"}${waits ? ", and may take an AbortSignal" : ""}`, e.start, e.end);
    if (signalled) this.signalArgument(e.args.at(-1)!, `'${callee.name}'`);
    // The std's own non-waiting send, which a promise's resolve and reject make.
    if (callee.name === "send" || callee.name === "settle") {
      const of = this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of);
      this.expect(e.args[0]!, of);
      const given = this.value(e.args[0]!);
      this.coerce(e.args[0]!, given, of, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    }
    if (callee.name === "available") return { type: "i64", what: "'available'" };
    // std's own TLS setup, `startTls(serverName, ca)` on a stream and `listenTls(cert, key)` on a
    // listener, giving why it failed, or an empty string.
    if (callee.name === "startTls" || callee.name === "listenTls") {
      for (const arg of e.args) {
        this.expect(arg, "string");
        const given = this.value(arg);
        this.coerce(arg, given, "string", `'${callee.name}' takes strings, not '${this.ctx.tables.typing.show(given)}'`);
      }
      return { type: "string", what: `'${callee.name}'` };
    }
    if (callee.name === "accept") return { type: this.ctx.tables.typing.leafFuture("accept", this.ctx.tables.typing.rec(t).which === "UnixListener" ? this.ctx.tables.typing.blockType("UnixStream") : "void", this.socketError(signalled), signalled), what: "'accept'" };
    // `read(max)` gives at most max bytes, and `write(bytes)` takes its bytes to send them all.
    if (callee.name === "read" || callee.name === "write") {
      const want = callee.name === "read" ? "i64" : this.ctx.tables.typing.arrayType("u8");
      this.expect(e.args[0]!, want);
      const given = this.value(e.args[0]!);
      this.coerce(e.args[0]!, given, want, callee.name === "read" ? `'read' takes the most bytes to read as an 'i64', not '${this.ctx.tables.typing.show(given)}'` : `'write' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '${this.ctx.tables.typing.show(given)}'`);
      return { type: this.ctx.tables.typing.leafFuture(callee.name, "void", this.socketError(signalled), signalled), what: `'${callee.name}'` };
    }
    if (callee.name === "abort") return { type: "void", what: "'abort'" };
    if (callee.name === "throwIfAborted") {
      this.ctx.raise(e, this.abortError(), "'throwIfAborted'");
      return { type: "void", what: "'throwIfAborted'" };
    }
    if (callee.name === "close" || callee.name === "settle") return { type: "void", what: `'${callee.name}'` };
    return { type: this.ctx.tables.typing.leafFuture(callee.name as "acquire" | "send" | "receive", this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of), signalled ? this.abortError() : undefined, signalled), what: `'${callee.name}'` };
  }

  // A UdpSocket's `sendTo(bytes, host, port)`, `receiveFrom()`, `connect(host, port)`, `send(bytes)`
  // and `receive()`. Each but connect, which never waits, may take an AbortSignal last.
  /** @throws {CompileError} */
  private udpCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    const methods: Record<string, usize> = { sendTo: 3, receiveFrom: 0, connect: 2, send: 1, receive: 0 };
    const what = `'${callee.name}'`;
    if (!(callee.name in methods)) throw new CompileError("E0502", `'UdpSocket' has no method '${callee.name}'; it has 'sendTo', 'receiveFrom', 'connect', 'send', 'receive', 'clone' and 'port', and dropping it closes it`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'UdpSocket' methods", callee);
    const count = methods[callee.name]!;
    const signalled = callee.name !== "connect" && e.args.length === count + 1;
    const usage = { sendTo: "the bytes, a host address and a port, like 'sendTo(bytes, \"127.0.0.1\", 8080)'", connect: "a host address and a port, like 'connect(\"127.0.0.1\", 8080)'", send: "the bytes to send" }[callee.name];
    if (e.args.length !== count && !signalled) throw new CompileError("E0504", `${what} takes ${usage ?? "no arguments"}${callee.name === "connect" ? "" : ", and may take an AbortSignal"}`, e.start, e.end);
    if (signalled) this.signalArgument(e.args.at(-1)!, what);
    const take = (arg: Expr, want: Type, say: (given: Type) => string) => {
      this.expect(arg, want);
      const given = this.value(arg);
      this.coerce(arg, given, want, say(given));
    };
    const sends = callee.name === "sendTo" || callee.name === "send";
    if (sends) take(e.args[0]!, this.ctx.tables.typing.arrayType("u8"), (given) => `${what} takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '${this.ctx.tables.typing.show(given)}'`);
    if (callee.name === "sendTo" || callee.name === "connect") {
      const [host, port] = callee.name === "sendTo" ? [e.args[1]!, e.args[2]!] : [e.args[0]!, e.args[1]!];
      take(host, "string", (given) => `the host is a 'string' like "127.0.0.1", not '${this.ctx.tables.typing.show(given)}'`);
      take(port, "i64", (given) => `the port is an 'i64', not '${this.ctx.tables.typing.show(given)}'`);
    }
    const method = sends ? "sendTo" : callee.name === "connect" ? "udpConnect" : "receiveFrom";
    return { type: this.ctx.tables.typing.leafFuture(method, callee.name === "receive" ? this.ctx.tables.typing.arrayType("u8") : "void", this.socketError(signalled), signalled), what };
  }

  // `AbortSignal.timeout(ms)`: a new signal that aborts itself after ms milliseconds. And
  // `AbortSignal.any(signals)`: one that aborts with the first of them, each lent to it.
  /** @throws {CompileError} */
  private signalStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    if (callee.name === "any") return this.signalAny(e);
    if (callee.name !== "timeout") throw new CompileError("E0502", `'AbortSignal' has no static method '${callee.name}'; it has 'timeout' and 'any'`, callee.start, callee.end);
    // The std library's own code is compiled whatever main is; a sync main never reaches it.
    if (!this.ctx.runtime && e.start < STD_BASE) throw new CompileError("E0301", "'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("E0504", "'AbortSignal.timeout' takes how many milliseconds until it aborts, like 'AbortSignal.timeout(5000)'", e.start, e.end);
    this.expect(e.args[0]!, "i64");
    const t = this.value(e.args[0]!);
    this.coerce(e.args[0]!, t, "i64", `'AbortSignal.timeout' takes milliseconds as an 'i64', not '${this.ctx.tables.typing.show(t)}'`);
    return { type: this.ctx.tables.typing.blockType("AbortSignal"), what: "'AbortSignal.timeout'" };
  }

  // A literal list lends each signal, as a wait's is, so 'req.signal' stays the request's.
  /** @throws {CompileError} */
  private signalAny(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    const example = "like 'AbortSignal.any([a, b])'";
    if (e.args.length !== 1) throw new CompileError("E0504", `'AbortSignal.any' takes one list of signals, ${example}`, e.start, e.end);
    const list = e.args[0]!;
    const signal = this.ctx.tables.typing.blockType("AbortSignal");
    if (list.kind === "array") {
      for (const x of list.elements) {
        if ((x === undefined) || x.kind === "spread") throw new CompileError("E0504", `'AbortSignal.any' takes its signals listed one by one, ${example}`, (x ?? list).start, (x ?? list).end);
        this.signalArgument(x, "'AbortSignal.any'");
      }
    } else {
      const given = this.value(list);
      this.coerce(list, given, this.ctx.tables.typing.refType(this.ctx.tables.typing.arrayType(signal), false), `'AbortSignal.any' takes a list of 'AbortSignal's, not '${this.ctx.tables.typing.show(given)}'`);
    }
    return { type: signal, what: "'AbortSignal.any'" };
  }

  // `TcpListener.bind(host, port)` and `TcpStream.connect(host, port)`, and the Unix ones taking a
  // socket path: futures the async runtime's reactor completes, throwing an `IoError` when the
  // system says no. std's own `TcpListener.unix(path)` and `TcpStream.unix(path)` give a socket on a
  // path typed as TCP's, so serve and fetch share their HTTP code.
  /** @throws {CompileError} */
  private socketStatic(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, which: "TcpListener" | "TcpStream" | "UnixListener" | "UnixStream" | "UdpSocket"): { type: Type; what: string } {
    const listens = which === "TcpListener" || which === "UnixListener" || which === "UdpSocket";
    const internal = e.start >= STD_BASE && (which === "TcpListener" || which === "TcpStream") && callee.name === "unix";
    const unix = internal || which === "UnixListener" || which === "UnixStream";
    const method = listens ? "bind" : "connect";
    if (callee.name !== method && !internal) throw new CompileError("E0502", `'${which}' has no static method '${callee.name}'; it has '${method}'`, callee.start, callee.end);
    const name = `'${which}.${callee.name}'`;
    if (!this.ctx.runtime && e.start < STD_BASE) throw new CompileError("E0301", `${name} works only when 'main' is an async function, whose runtime waits on sockets`, e.start, e.end);
    // Connecting waits, so it may take an AbortSignal; binding doesn't.
    const most = unix ? 1 : 2;
    const signalled = method === "connect" && e.args.length === most + 1;
    const example = unix ? `like '${which}.${method}("/tmp/app.sock")'` : `like '${which}.${method}("127.0.0.1", 8080)'`;
    if (e.args.length !== most && !signalled) throw new CompileError("E0504", `${name} takes ${unix ? "a socket path" : "a host address and a port"}, ${example}${method === "connect" ? ", and may take an AbortSignal" : ""}`, e.start, e.end);
    if (signalled) this.signalArgument(e.args[most]!, name);
    const host = e.args[0]!;
    this.expect(host, "string");
    const h = this.value(host);
    this.coerce(host, h, "string", unix ? `the socket path is a 'string' like "/tmp/app.sock", not '${this.ctx.tables.typing.show(h)}'` : `the host is a 'string' like "127.0.0.1", not '${this.ctx.tables.typing.show(h)}'`);
    if (!unix) {
      const port = e.args[1]!;
      this.expect(port, "i64");
      const p = this.value(port);
      this.coerce(port, p, "i64", `the port is an 'i64', not '${this.ctx.tables.typing.show(p)}'`);
    }
    return { type: this.ctx.tables.typing.leafFuture(method, unix || which === "UdpSocket" ? this.ctx.tables.typing.blockType(which) : "void", this.socketError(signalled), signalled), what: name };
  }

  // The std `IoError` class, which failed socket calls throw.
  private ioError(): Type {
    return this.ctx.tables.arenas.classOf(this.ctx.classes.get("IoError")!).type;
  }

  // What a socket's wait throws: an IoError, or an AbortError too when it was given a signal.
  private socketError(this: Mut<this>, signalled: boolean): Type {
    return signalled ? this.ctx.tables.typing.unionType([this.ioError(), this.abortError()]) : this.ioError();
  }

  // A wait's AbortSignal, lent to it: the wait keeps a count on it of its own.
  /** @throws {CompileError} */
  private signalArgument(this: Mut<this>, a: Ref<Expr>, what: string) {
    const signal = this.ctx.tables.typing.blockType("AbortSignal");
    const given = this.value(a);
    const lent = this.ctx.tables.typing.refType(signal, false);
    this.coerce(a, given, lent, `${what} takes an 'AbortSignal' to stop waiting early, not '${this.ctx.tables.typing.show(given)}'`);
  }

  // `new Promise<T>(executor)`, rewritten as the prelude's cell its executor settles, awaited.
  // T is written or the `Promise<T>` it meets; reject's error is its annotation's, or what the
  // function declares it throws, or `Error`.
  /** @throws {CompileError} */
  private promiseNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, list: Ref<Expr[]>) {
    const example = "as in 'new Promise<i64>((resolve, reject) => resolve(1))'";
    if (list.length !== 1 || list[0]!.kind === "spread") throw new CompileError("E0305", `'new Promise' takes one executor, ${example}`, e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("E0305", "'Promise' takes one type argument, what it gives", e.start, e.end);
    const executor = list[0]!;
    const expected = this.ctx.exprsState.wanted.get(e);
    // A stored `Promise<T>`, or one a parameter takes, gives its T and can't throw; one awaited
    // where a T is wanted gives that T and may.
    const stored = expected === undefined ? undefined : this.promiseMet(expected);
    const gives = e.typeArgs[0] ? this.ctx.resolveType(e.typeArgs[0]) : stored ?? this.ctx.exprsState.awaitedAs.get(e);
    if (gives === undefined) throw new CompileError("E0305", `can't tell what this Promise gives; write it, ${example}`, e.start, e.end);
    const declared = executor.kind === "arrow" ? executor : executor.kind === "ident" && (this.ctx.lookup(executor.name, undefined) === undefined) ? this.bodyNamed(executor.name) : undefined;
    const raw = declared === undefined ? this.ctx.tables.typing.lower(this.value(executor)) : undefined;
    const held = (raw && this.boundFunction(raw)) ?? raw;
    const r = this.recOf(held);
    const fn = r?.kind === "closure" || r?.kind === "function" ? r : held !== undefined && this.isCallable(held) ? this.recOf(this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(held as DynType).of)) : undefined;
    if (declared === undefined && fn === undefined) throw new CompileError("E0305", `'new Promise' takes an executor, a function given 'resolve' and 'reject', ${example}; not '${this.ctx.tables.typing.show(held!)}'`, executor.start, executor.end);
    const returned = this.recOf(fn?.returns);
    const async = declared?.async === true || (returned !== undefined && (returned.kind === "future" || this.ctx.tables.typing.promiseElement(returned.kind === "dyn" ? returned.of : fn!.returns) !== undefined));
    if (async) throw new CompileError("E0305", "an executor runs at once, so it can't be async; call an async function that awaits and then calls 'resolve' instead", executor.start, executor.end);
    const takes = declared?.params.length ?? fn!.params.length;
    const rejects = takes >= 2;
    if (rejects && stored !== undefined) throw new CompileError("E0305", `a Promise stored as a '${this.ctx.tables.typing.show(expected!)}' can't throw yet, so its executor can't take 'reject'; await it where it is made, or resolve it with a value saying it failed`, executor.start, executor.end);
    // Reject's own type, written on the executor's parameter or in its signature.
    const annotated = declared?.params[1]?.type;
    const reason = annotated ? this.ctx.resolveType(annotated) : fn?.params[1];
    const rejecting = this.recOf(reason);
    const signature = rejecting?.kind === "function" ? rejecting : reason !== undefined && this.isCallable(reason) ? this.recOf(this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(reason as DynType).of)) : undefined;
    if (reason !== undefined && signature?.params.length !== 1) throw new CompileError("E0305", `'reject' takes the error it fails with, as in 'reject: (reason: Error) => void', not '${this.ctx.tables.typing.show(reason)}'`, (annotated ?? executor).start, (annotated ?? executor).end);
    const error = signature?.params[0] ?? this.ctx.throwsDeclared() ?? this.ctx.tables.arenas.classOf(this.ctx.classes.get("Error")!).type;
    const variant = `${rejects ? "" : " resolve"}${gives === "void" ? " void" : ""}`;
    const typeArgs = [...(gives === "void" ? [] : [this.presetNode(gives, e)]), ...(rejects ? [this.presetNode(error, e)] : [])];
    const at = { start: e.start, end: e.end };
    const cell: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: `promise cell${variant}`, ...at }, typeArgs, args: [executor], optional: false, ...at };
    const awaited = this.ctx.tables.rewrites.replace(e, { id: 0, kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: `promise await${variant}`, ...at }, typeArgs, args: [cell], optional: false, ...at });
    if (gives !== "void") {
      const resolves = rejects ? "" : " resolve";
      this.ctx.tables.promiseVariants.set(cell, { name: `promise cell${resolves}`, typeArgs });
      this.ctx.tables.promiseVariants.set(awaited, { name: `promise await${resolves}`, typeArgs });
    }
    return awaited;
  }

  // The T of a `Promise<T>` a value meets, stored or taken by a parameter.
  private promiseMet(t: Type): Type | undefined {
    const r = this.recOf(t);
    const held = this.recOf(r?.kind === "param" ? r.bound : t);
    return held?.kind === "dyn" ? this.ctx.tables.typing.promiseElement(held.of) : held?.kind === "interface" ? this.ctx.tables.typing.promiseElement((r?.kind === "param" ? r.bound! : t) as InterfaceType) : undefined;
  }

  // A type argument for a rewritten call, standing for a type already known.
  private presetNode(this: Mut<this>, t: Type, at: Ref<Span>): TypeNode {
    const made: TypeNode = { id: nextId(this.ctx.tables.ids), kind: "ref", name: this.ctx.tables.typing.show(t), args: [], start: at.start, end: at.end };
    this.ctx.tables.presetTypes.set(made, t);
    return made;
  }

  // `setTimeout(callback, ms)`, `setInterval` and their clears, rewritten as the std's timers.
  /** @throws {CompileError} */
  private timerCall(this: Mut<this>, e: Ref<Call>, name: string): Call {
    const at = { start: e.start, end: e.end };
    const helper = (named: string, args: Expr[]): Call => this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: named, start: e.callee.start, end: e.callee.end }, args, typeArgs: [] }) as Call;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    if (e.args.some((a) => a.kind === "spread")) throw new CompileError("E0504", `'${name}' takes its arguments written out, not spread`, e.start, e.end);
    if (name === "clearTimeout" || name === "clearInterval") {
      if (e.args.length > 1) throw new CompileError("E0504", `'${name}' takes the timer to clear`, e.start, e.end);
      return helper("timeout clear", [e.args[0] ?? { id: nextId(this.ctx.tables.ids), kind: "null", ...at }]);
    }
    if (e.args.length === 0) throw new CompileError("E0504", `'${name}' takes the function to run, then the milliseconds to wait`, e.start, e.end);
    if (!this.ctx.runtime && !this.ctx.async) throw new CompileError("E0301", `'${name}' can only be used inside an 'async' function here, where the runtime is running`, e.callee.start, e.callee.end);
    this.ctx.tables.timerNames.set(e, name);
    if (e.args.length > 4) throw new CompileError("E0504", `'${name}' passes at most two arguments on to its function so far; pass the rest through an arrow, as in '${name}(() => f(a, b, c), ms)'`, e.args[4]!.start, e.args.at(-1)!.end);
    // What it passes on is captured when the timer is set, so each is a name or a literal, which
    // capturing then and reading later can't tell apart.
    const passed = e.args.slice(2);
    const plain = (x: Expr): boolean => ["ident", "int", "float", "bigint", "string", "bool", "null"].includes(x.kind) || (x.kind === "unary" && x.op === "-" && plain(x.operand));
    const odd = passed.find((x) => !plain(x));
    if (odd) throw new CompileError("E0504", `'${name}' passes on a name or a literal; give this value a name first, as in 'const v = ...; ${name}(f, ms, v)'`, odd.start, odd.end);
    // The callback runs inside an async arrow the timer keeps, which owns what it captures. It is
    // named or written in place, so making that arrow evaluates nothing early or late.
    let callback = e.args[0]!;
    if (callback.kind !== "arrow" && callback.kind !== "ident") throw new CompileError("E0504", `'${name}' takes a function written here or named, as in '${name}(() => tick(), ms)'; give this one a name first`, callback.start, callback.end);
    // An arrow's unwritten parameters take the types of what is passed, as TypeScript infers.
    if (callback.kind === "arrow") {
      const params = callback.params.map((p, i) => (!p.type && passed[i] ? this.ctx.tables.rewrites.replaceParam(p, { ...p, type: this.presetNode(this.ctx.tables.typing.widenLet(this.value(passed[i]!)), p) }) : p));
      callback = this.ctx.tables.rewrites.replace(callback, { ...callback, params });
    }
    const span = { start: callback.start, end: callback.end };
    // Each run passes its own copy of a value that doesn't copy, as each of node's runs passes it.
    const given = passed.map((x): Expr => (x.kind === "ident" && !this.ctx.tables.typing.isCopy(this.value(x)) ? { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: x, name: "clone", optional: false, start: x.start, end: x.end }, args: [], typeArgs: [], optional: false, start: x.start, end: x.end } : x));
    const run: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: callback, args: given, typeArgs: [], optional: false, ...span };
    const body: Expr = this.givesPromise(callback) ? { id: nextId(this.ctx.tables.ids), kind: "unary", op: "await", operand: run, ...span } : run;
    // An async arrow taking nothing is what the timer keeps, so its captures are made once.
    const own = callback.kind === "arrow" && callback.async && callback.params.length === 0 && Array.isArray(callback.body);
    const kept: Expr = own ? callback
      : { id: nextId(this.ctx.tables.ids), kind: "arrow", move: false, async: true, typeParams: [], params: [], returnType: undefined, body: [{ id: nextId(this.ctx.tables.ids), kind: "expr", expr: body, ...span }], ...span };
    const wrapper: Expr = this.givesPromise(callback) ? { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "timer detached", ...span }, args: [kept], typeArgs: [], optional: false, ...span } : kept;
    this.ctx.tables.timerWrappers.add(kept);
    if (!own) this.ctx.tables.madeArrows.add(kept);
    const loop: Expr = { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: "timer loop", ...at }, args: [], typeArgs: [], optional: false, ...at };
    const ms = e.args[1] ?? { id: nextId(this.ctx.tables.ids), kind: "int", value: 0n, ...at };
    this.ctx.tables.timerSets.add(e);
    return helper("timerSet", [wrapper, ms, { id: nextId(this.ctx.tables.ids), kind: "bool", value: name === "setInterval", ...at }, loop]);
  }

  // Whether a timer's callback gives a Promise to await: an async arrow or one whose body calls a
  // function that does, or a function or value that does.
  private givesPromise(this: Mut<this>, callback: Ref<Expr>): boolean {
    if (callback.kind === "arrow") {
      if (callback.async) return true;
      // A block body gives what its last statement returns.
      const last = Array.isArray(callback.body) ? callback.body.at(-1) : undefined;
      const given = Array.isArray(callback.body) ? (last?.kind === "return" ? last.value : undefined) : callback.body;
      return given?.kind === "call" && this.givesPromise(given.callee);
    }
    if (callback.kind !== "ident") return false;
    const localId = this.ctx.lookup(callback.name, undefined);
    const local = localId === undefined ? undefined : this.lc(localId);
    if ((local === undefined)) {
      const f = this.bodyNamed(callback.name);
      return f?.async === true || (f?.returnType?.kind === "ref" && f.returnType.name === "Promise");
    }
    const held = this.ctx.tables.typing.lower(local.type);
    const r = this.recOf(held);
    const fn = r?.kind === "closure" || r?.kind === "function" ? r : this.isCallable(held) ? this.recOf(this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(held as DynType).of)) : undefined;
    const returns = fn?.returns;
    return returns !== undefined && (this.recOf(returns)?.kind === "future" || this.promiseMet(returns) !== undefined);
  }

  // `Promise.withResolvers<T>()`, rewritten as the prelude's cell with its promise and the
  // closures settling it; reject's error is what the function declares it throws, or `Error`.
  /** @throws {CompileError} */
  private promiseResolvers(this: Mut<this>, e: Ref<Call>): Call {
    if (e.args.length > 0) throw new CompileError("E0305", "'Promise.withResolvers' takes no arguments", e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("E0305", "'Promise.withResolvers' takes one type argument, what its Promise gives", e.start, e.end);
    if (e.typeArgs.length === 0) throw new CompileError("E0305", "can't tell what this Promise gives; write it, as in 'Promise.withResolvers<i64>()'", e.start, e.end);
    const gives = this.ctx.resolveType(e.typeArgs[0]!);
    const error = this.ctx.throwsDeclared() ?? this.ctx.tables.arenas.classOf(this.ctx.classes.get("Error")!).type;
    const at = { start: e.start, end: e.end };
    const made = this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: gives === "void" ? "promise with resolvers void" : "promise with resolvers", ...at }, typeArgs: [...(gives === "void" ? [] : [this.presetNode(gives, e)]), this.presetNode(error, e)] }) as Call;
    if (gives !== "void") this.ctx.tables.promiseVariants.set(made, { name: "promise with resolvers", typeArgs: made.typeArgs });
    return made;
  }

  // `Promise.resolve(v)` and `Promise.reject(e)`, rewritten as the prelude's async functions
  // giving v or throwing e. Each gives the T it is written with or meets; a rejected one with
  // neither gives nothing.
  /** @throws {CompileError} */
  private promiseSettled(this: Mut<this>, e: Ref<Call>, name: "resolve" | "reject"): Call {
    const at = { start: e.start, end: e.end };
    if (e.args.length > 1 || e.args[0]?.kind === "spread") throw new CompileError("E0305", `'Promise.${name}' takes ${name === "resolve" ? "the value it gives" : "the error it throws"}`, e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("E0305", `'Promise.${name}' takes one type argument, what it gives`, e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const met = (expected === undefined ? undefined : this.promiseMet(expected)) ?? this.ctx.exprsState.awaitedAs.get(e);
    const written = e.typeArgs[0] ? this.ctx.resolveType(e.typeArgs[0]) : undefined;
    if (name === "resolve") {
      const gives = written ?? (e.args.length === 0 ? "void" : met);
      if (gives === "void" && e.args.length > 0) throw new CompileError("E0305", "a 'Promise<void>' gives nothing, so 'Promise.resolve' takes no value for it", e.args[0]!.start, e.args[0]!.end);
      if (gives !== "void" && e.args.length === 0) throw new CompileError("E0305", `'Promise.resolve' takes the value it gives, of type '${this.ctx.tables.typing.show(gives!)}'`, e.start, e.end);
      const given = e.args.length > 0 ? this.value(e.args[0]!) : undefined;
      const r = this.recOf(given);
      if (r?.kind === "future" || r?.kind === "handle" || (r?.kind === "dyn" && this.ctx.tables.typing.promiseElement(r.of) !== undefined)) {
        throw new CompileError("E0305", "'Promise.resolve' of a Promise would hold one Promise inside another, which Fish doesn't flatten; await it first, or use the Promise itself", e.args[0]!.start, e.args[0]!.end);
      }
      return this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: gives === "void" ? "promise resolve void" : "promise resolve", ...at }, typeArgs: gives === "void" || gives === undefined ? [] : [this.presetNode(gives, e)] }) as Call;
    }
    if (e.args.length === 0) throw new CompileError("E0305", "'Promise.reject' takes the error it throws, as in 'Promise.reject(new Error(\"failed\"))'", e.start, e.end);
    const gives = written ?? met ?? "void";
    const reason = this.value(e.args[0]!);
    const made = this.ctx.tables.rewrites.replace(e, { ...e, callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: gives === "void" ? "promise reject void" : "promise reject", ...at }, typeArgs: [...(gives === "void" ? [] : [this.presetNode(gives, e)]), this.presetNode(this.ctx.tables.typing.widenLet(reason), e)] }) as Call;
    if (gives !== "void") this.ctx.tables.promiseVariants.set(made, { name: "promise reject", typeArgs: made.typeArgs });
    return made;
  }

  // The std `AbortError` class, which aborted work throws.
  private abortError(): Type {
    return this.ctx.tables.arenas.classOf(this.ctx.classes.get("AbortError")!).type;
  }

  // Whether a value passes where a JS shape is wanted: a handle of a shape with its fields, or a
  // Fish value with them, converted; methods only a handle has.
  private takesShape(this: Mut<this>, from: Type, shape: InterfaceType | ObjectType): boolean {
    return this.missingField(from, shape) === undefined;
  }

  // Why a value doesn't pass where a JS shape is wanted, said of the first field that fails.
  private missingField(this: Mut<this>, from: Type, shape: InterfaceType | ObjectType): string | undefined {
    // A borrowed handle is the handle, counted again where it goes.
    if (this.isRefType(from) && (this.ctx.tables.typing.jsShape(this.ctx.tables.typing.rec(from).to) !== undefined)) from = this.ctx.tables.typing.rec(from).to;
    const own = this.ctx.tables.typing.jsShape(from);
    if (own === shape) return undefined;
    // A pair of types met again while it is compared: handles' shapes referring to themselves
    // fit; a Fish type referring to itself has no value JS could take yet. Object types are
    // interned, so a nested value of another type is a pair of its own.
    const source = own ?? from;
    if (this.ctx.exprsState.comparing.get(source)?.has(shape)) return own ? undefined : `'${this.ctx.tables.typing.show(from)}' refers to itself, which can't cross between Fish and JS yet`;
    if (!this.ctx.exprsState.comparing.has(source)) this.ctx.exprsState.comparing.set(source, new TypeSet());
    this.ctx.exprsState.comparing.get(source)!.add(shape);
    try {
      return this.shapeMisses(from, own, shape);
    } finally {
      this.ctx.exprsState.comparing.get(source)!.delete(shape);
    }
  }

  private shapeMisses(this: Mut<this>, from: Type, own: InterfaceType | ObjectType | undefined, shape: InterfaceType | ObjectType): string | undefined {
    const kind = this.recOf(from)?.kind;
    const source = own ?? ((kind === "object" || kind === "class") && !this.ctx.tables.typing.isTuple(from) ? from : undefined);
    if (!source) return `a '${this.ctx.tables.typing.show(from)}' isn't an object`;
    const wanted = this.ctx.tables.typing.rec(shape);
    const owned = own && this.ctx.tables.typing.rec(own);
    if (!own && wanted.kind === "interface" && wanted.methods.length > 0) return `its methods come only with a value JS made`;
    // A handle of another shape has the methods this one declares, by name and types.
    if (own && wanted.kind === "interface") {
      const methods = owned?.kind === "interface" ? owned.methods : [];
      // A method fits as TypeScript's do: it may take fewer parameters, an extra one of its own
      // is optional, the wanted one's arguments pass for those it has, and what it gives passes for
      // what is wanted; a generic one is matched by its parameters' count.
      const same = (a: Method, b: Method) => {
        if (a.params.slice(b.params.length).some((p) => !this.ctx.tables.typing.isOption(p))) return false;
        if (a.generic || b.generic) return a.params.length === b.params.length;
        return a.params.every((p, i) => i >= b.params.length || this.passesJs(b.params[i]!, p)) && (b.returns === "void" || this.passesJs(a.returns, b.returns));
      };
      const lacking = wanted.methods.find((m) => !methods.some((n) => n.name === m.name && same(n, m)));
      if (lacking) return methods.some((n) => n.name === lacking.name) ? `method '${lacking.name}' takes or gives other types` : `property '${lacking.name}' is missing`;
    }
    // A member Fish couldn't type that the shape declares is one only a handle of it has.
    const held = wanted.kind === "interface" ? this.ctx.tables.typing.jsUntyped.get(shape as InterfaceType) : undefined;
    const optional = wanted.kind === "interface" ? this.ctx.tables.typing.jsOptional.get(shape as InterfaceType) : undefined;
    const aside = [...(held ?? [])].filter(([n]) => !(optional?.has(n) ?? false)).map(([n]) => n);
    const unseen = aside.find((n) => owned?.kind !== "interface" || !(this.ctx.tables.typing.jsUntyped.get(own as InterfaceType)?.has(n) ?? false));
    if (unseen !== undefined) return unseen.startsWith("[") ? `its ${unseen === "[index]" ? "index" : "call"} signature comes only with a value JS made` : `property '${unseen}' is missing`;
    // A Fish class's private fields stay its own.
    const r = this.ctx.tables.typing.rec(source as Exclude<Type, string>);
    const fields = r.kind === "class" ? r.fields.filter((g) => (g.access ?? "public") === "public") : r.fields;
    for (const f of this.ctx.tables.typing.rec(shape).fields) {
      const found = fields.find((g) => g.name === f.name);
      if (!found) {
        if (this.ctx.tables.typing.isOption(f.type)) continue;
        return `property '${f.name}' is missing`;
      }
      if (!this.passesJs(found.type, f.type)) return `property '${f.name}' is a '${this.ctx.tables.typing.show(found.type)}', not a '${this.ctx.tables.typing.show(f.type)}'`;
      const why = own ? undefined : this.ctx.tables.typing.uncrossable(found.type);
      if (why) return `property '${f.name}' is a '${this.ctx.tables.typing.show(found.type)}', which can't cross between Fish and JS yet: ${why}`;
    }
    return undefined;
  }

  // Whether a value passes where a package declares a type: as it fits it, or as a value JS takes
  // for it, inside unions and arrays too.
  private passesJs(this: Mut<this>, from: Type, to: Type): boolean {
    const referred = this.isRefType(from) ? this.recOf(this.ctx.tables.typing.rec(from).to) : undefined;
    if (this.isRefType(from) && referred?.kind === "block" && referred.which === "JsValue") from = this.ctx.tables.typing.rec(from).to;
    if (this.ctx.tables.typing.fits(from, to)) return true;
    // An integer is a number in JS, as a literal in an object for one is written.
    // ponytail: past 2^53 an integer loses precision, as it would in JS; refuse if that matters
    if (isInteger(from) && to === "f64") return true;
    const source = this.recOf(from);
    if (source?.kind === "union") return source.members.every((m) => this.passesJs(m, to));
    if (typeof to === "string") return false;
    const r = this.ctx.tables.typing.rec(to);
    if (r.kind === "union") return r.members.some((m) => this.passesJs(from, m));
    if (r.kind === "array") return source?.kind === "array" && this.passesJs(source.element, r.element);
    // A nested object becomes a new JS object as the one holding it does, so it takes a Fish value
    // of its shape the same way.
    const shape = this.ctx.tables.typing.jsShape(to) ?? (r.kind === "object" && (r.tuple === undefined) ? (to as ObjectType) : undefined);
    if ((shape !== undefined)) return this.takesShape(from, shape);
    return r.kind === "block" && r.which === "JsValue" && this.ctx.tables.typing.uncrossable(from) === undefined;
  }

  // Whether a type holds a JS handle or an any, where Fish values of other types pass.
  private holdsJs(t: Type): boolean {
    return this.ctx.tables.typing.holdsPart(t, (u) => {
      const r = this.recOf(u);
      return r?.kind === "block" && r.which === "JsValue";
    });
  }

  // A shape's member Fish couldn't type, as the refusal of its declaration, noting this use.
  private untyped(shape: InterfaceType | ObjectType | undefined, name: string, at: Ref<Span>): CompileError | undefined {
    const why = shape && this.ctx.tables.typing.rec(shape).kind === "interface" ? this.ctx.tables.typing.jsUntyped.get(shape as InterfaceType)?.get(name) : undefined;
    if (why && !why.note) why.note = { message: `'${name}' is used here`, start: at.start, end: at.end };
    return why;
  }

  // A type a handle's member gives or takes, refused when it can't cross between Fish and JS.
  /** @throws {CompileError} */
  private crossing(this: Mut<this>, t: Type, what: string, at: Ref<Span>): Type {
    // A generic body's definition holds placeholders, which each instance checks as what they are.
    if (this.ctx.tables.typing.holdsPart(t, (p) => this.placeholder(p))) return t;
    const why = t === "void" ? undefined : this.ctx.tables.typing.uncrossable(t);
    if ((why !== undefined)) throw new CompileError("E1005", `${what} '${this.ctx.tables.typing.show(t)}', which can't cross between Fish and JS yet: ${why}`, at.start, at.end);
    return t;
  }

  // A JS handle's property, as its shape declares it, read from JS.
  /** @throws {CompileError} */
  private jsProperty(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, t: BlockType): Type {
    if (this.ctx.tables.typing.rec(t).of === "void") {
      if (this.ctx.exprsState.writing === e.id) throw new CompileError("E1005", "writing a JS value's properties isn't supported yet; a 'JsValue' is read with 'get'", e.start, e.end);
      if (["get", "at", "has"].includes(e.name)) throw new CompileError("E1005", `'${e.name}' is a method of a 'JsValue'; call it, as in '${this.placeText(e)}(...)'`, e.start, e.end);
      throw new CompileError("E1005", `a 'JsValue' could be anything, as an 'unknown' could, so it has no property '${e.name}' to use; read one with '${this.placeText(e.object)}.get("${e.name}")'`, e.start, e.end);
    }
    const shape = this.ctx.tables.typing.jsShape(t);
    const found = shape && this.ctx.tables.typing.rec(shape).fields.find((f) => f.name === e.name);
    if (found) {
      this.ctx.tables.jsMembers.add(e);
      // A callback or a Promise goes to JS when written, but Fish has no reading of one back.
      const kept = (u: Type) => typeof u !== "string" && this.ctx.tables.typing.rec(u).kind === "dyn" && this.ctx.tables.typing.keptByJs(u);
      if (this.ctx.exprsState.writing !== e.id && this.ctx.tables.typing.holdsPart(found.type, kept)) {
        const promise = this.ctx.tables.typing.holdsPart(found.type, (u) => kept(u) && this.ctx.tables.typing.promiseElement(this.ctx.tables.typing.rec(u as DynType).of) !== undefined);
        throw new CompileError("E0801", `reading property '${e.name}' of '${this.ctx.tables.typing.show(t)}' isn't supported yet: it holds a ${promise ? "Promise" : "function"}, which Fish can give JS but not read back`, e.start, e.end);
      }
      return this.crossing(this.ctx.tables.typing.jsView(found.type), `property '${e.name}' of '${this.ctx.tables.typing.show(t)}' is a`, e);
    }
    const r = this.recOf(shape);
    const method = r?.kind === "interface" && r.methods.some((m) => m.name === e.name);
    if (method) throw new CompileError("E0503", `'${e.name}' is a method of '${this.ctx.tables.typing.show(t)}'; call it, as in '${this.placeText(e)}(...)'`, e.start, e.end);
    throw this.untyped(shape, e.name, e) ?? new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'`, e.start, e.end);
  }

  // `v.get(key)` and `v.at(i)` read a property or an element of a JsValue, and `v.has(key)` tests
  // for one.
  /** @throws {CompileError} */
  private jsAccessor(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    const name = callee.name;
    const takes = ({ get: "string", has: "string", at: "i64" } as Record<string, Type>)[name];
    if (!takes) throw new CompileError("E1005", `a 'JsValue' has no method '${name}': its own are 'get', 'at' and 'has', and it is narrowed with 'typeof' to read it`, callee.start, callee.end);
    const what = takes === "i64" ? "an index, as an 'i64'" : "a key, as a 'string'";
    if (e.args.length !== 1) throw new CompileError("E0504", `'${name}' takes ${what}`, e.start, e.end);
    this.expect(e.args[0]!, takes);
    const given = this.value(e.args[0]!);
    this.coerce(e.args[0]!, given, takes, `'${name}' takes ${what}, not '${this.ctx.tables.typing.show(given)}'`);
    this.ctx.tables.jsAccessors.add(e);
    return { type: name === "has" ? "boolean" : this.ctx.tables.typing.blockType("JsValue"), what: `'${name}'` };
  }

  // A JS handle's method, called with its declared parameters.
  /** @throws {CompileError} */
  private jsMethodCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: BlockType): { type: Type; what: string } {
    if (this.ctx.tables.typing.rec(t).of === "void") return this.jsAccessor(e, callee);
    const shape = this.ctx.tables.typing.jsShape(t);
    const r = this.recOf(shape);
    const method = r?.kind === "interface" ? r.methods.find((m) => m.name === callee.name) : undefined;
    if ((method === undefined)) {
      const field = r?.fields.some((f) => f.name === callee.name);
      throw this.untyped(shape, callee.name, callee) ?? new CompileError(field ? "E0503" : "E0502", field ? `'${callee.name}' is a property of '${this.ctx.tables.typing.show(t)}', not a method` : `property '${shownName(callee.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'`, callee.start, callee.end);
    }
    this.ctx.tables.jsMethods.add(e);
    // A generic one is typed for the call's type arguments, written or inferred.
    if (method.generic) {
      // An optional parameter left out is undefined, as JS gives it.
      const missing = method.params.slice(e.args.length);
      const left = missing.findIndex((p) => !this.ctx.tables.typing.isOption(p));
      const nulls = missing.slice(0, left < 0 ? missing.length : left).map((): Expr => ({ id: nextId(this.ctx.tables.ids), kind: "null", start: e.end, end: e.end }));
      if (nulls.length > 0) e = this.ctx.tables.rewrites.replace(e, { ...e, args: [...e.args, ...nulls] }) as Call;
      this.ctx.tables.jsCrossings.add(e);
      this.ctx.tables.jsOptionalOf.set(e, method.optional ?? []);
      const typed = this.familyCall(e, { generic: method.generic }, `'${callee.name}'`);
      e.args.forEach((a) => this.crossing(this.ctx.types.get(a) ?? "void", `'${callee.name}' of '${this.ctx.tables.typing.show(t)}' is given a`, a));
      return { type: this.crossing(typed.type === "void" ? "void" : this.ctx.tables.typing.jsView(typed.type), `'${callee.name}' of '${this.ctx.tables.typing.show(t)}' gives a`, e), what: typed.what };
    }
    // A callback or a Promise it takes is one JS keeps, and an object type a JS object's shape.
    const params = method.params.map((t) => this.ctx.tables.typing.jsTakes(t));
    params.forEach((p) => this.crossing(p, `'${callee.name}' of '${this.ctx.tables.typing.show(t)}' takes a`, e));
    this.jsArgs(e, params, method.optional ?? []);
    return { type: this.crossing(method.returns === "void" ? "void" : this.ctx.tables.typing.jsView(method.returns), `'${callee.name}' of '${this.ctx.tables.typing.show(t)}' gives a`, e), what: `'${callee.name}'` };
  }

  // The signature of a package's function a call takes: the first, in the order declared, whose
  // parameters the arguments pass for; a generic one is taken on the count of its arguments.
  /** @throws {CompileError} */
  private jsOverload(this: Mut<this>, e: Ref<Call>, first: Ref<Body>): Body {
    const signatures = [first, ...first.js!.overloads!.map((f) => this.ctx.tables.arenas.bodyOf(this.ctx.tables.jsBodies.get(f)!))];
    if (e.args.some((a) => a.kind === "arrow" || a.kind === "spread")) return first;
    const given = e.args.map((a) => this.value(a));
    // In a generic body's definition an argument may be a placeholder: each instance picks again.
    const open = given.some((t) => this.ctx.tables.typing.holdsPart(t, (p) => this.placeholder(p)));
    const fitting = signatures.find((f) => {
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (given.length < required || (given.length > f.params.length && !f.params.at(-1)?.rest)) return false;
      if ((f.typeParams?.length ?? 0) > 0 || open) return true;
      return given.every((t, i) => {
        const p = f.params[Math.min(i, f.params.length - 1)]!;
        const declared = p.type ? this.ctx.resolveType(p.type) : this.ctx.tables.typing.blockType("JsValue");
        return this.passesJs(t, p.optional ? this.ctx.tables.typing.unionType([declared, "null"]) : declared);
      });
    });
    if (fitting) return fitting;
    const shown = signatures.map((f) => `(${f.params.map((p) => `${(p.pattern as { name?: string }).name ?? "_"}${p.optional ? "?" : ""}: ${p.type ? this.ctx.tables.typing.show(this.ctx.resolveType(p.type)) : "any"}`).join(", ")})`).join(", ");
    throw new CompileError("E0507", `no signature of '${first.js!.name}' takes (${given.map((t) => this.ctx.tables.typing.show(t)).join(", ")}); it takes ${shown}`, e.start, e.end);
  }

  // The overload a call takes: the first, in the order declared, whose parameters its arguments
  // pass for, as TypeScript picks one. A generic one is taken on the count of its arguments.
  /** @throws {CompileError} */
  private overload(this: Mut<this>, e: Ref<Call>, impl: Ref<Body>): Body {
    const spread = e.args.find((a) => a.kind === "spread");
    if ((spread !== undefined)) throw new CompileError("E0801", `spreading arguments into the overloaded '${impl.name}' isn't supported yet; pass them one by one`, spread.start, spread.end);
    const given = e.args.map((a) => (a.kind === "arrow" ? undefined : this.tried(a)));
    const overloads = impl.overloads!.map((f) => this.ctx.tables.arenas.bodyOf(f));
    const fitting = overloads.find((f) => {
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (e.args.length < required || (e.args.length > f.params.length && !f.params.at(-1)?.rest)) return false;
      const types = this.signatureTypes(f);
      return types === undefined || e.args.every((a, i) => this.passes(a, given[i], types[Math.min(i, types.length - 1)]!, f.params[Math.min(i, f.params.length - 1)]!));
    });
    if (fitting) return fitting;
    const shown = overloads.map((f) => {
      const types = this.signatureTypes(f);
      // A destructured parameter, named only to be passed on, shows as its type alone.
      const params = f.params.map((p, i) => {
        const name = (p.pattern as { name?: string }).name ?? "_";
        const type = types ? this.ctx.tables.typing.show(types[i]!) : "_";
        return name.startsWith("argument ") ? type : `${p.rest ? "..." : ""}${name}${p.optional ? "?" : ""}: ${type}`;
      });
      return `(${params.join(", ")}): ${f.returnType ? this.ctx.tables.typing.show(this.ctx.resolveType(f.returnType)) : "_"}`;
    });
    const args = given.map((t) => (t === undefined ? "a function" : this.ctx.tables.typing.show(t)));
    throw new CompileError("E0507", `no overload of '${impl.name}' takes (${args.join(", ")}); its overloads are ${shown.join(", ")}`, e.start, e.end);
  }

  // What an overload's body gives back: the implementation's value, as the members of its type the
  // signature's return type takes; codegen panics on any other.
  /** @throws {CompileError} */
  private narrowedReturn(this: Mut<this>, call: Ref<Expr>, node: Ref<TypeNode>): Type {
    const from = this.value(call);
    const to = this.ctx.resolveType(node);
    if (this.ctx.tables.typing.fits(from, to)) return from;
    const r = this.recOf(from);
    const kept = r?.kind === "union" ? r.members.filter((m) => this.ctx.tables.typing.fits(m, to)) : [];
    if (kept.length === 0 && this.ctx.tables.typing.fits(to, from)) throw new CompileError("E0410", `it returns '${this.ctx.tables.typing.show(to)}', narrower than the implementation's '${this.ctx.tables.typing.show(from)}', which isn't a union whose members it could be narrowed to; give the implementation a union return type, as in '${this.ctx.tables.typing.show(to)} | ...'`, node.start, node.end);
    if (kept.length === 0) throw new CompileError("E0410", `this overload signature is not compatible with its implementation, which returns '${this.ctx.tables.typing.show(from)}', never a '${this.ctx.tables.typing.show(to)}'`, node.start, node.end);
    return kept.length === 1 ? kept[0]! : this.ctx.tables.typing.unionType(kept);
  }

  // An argument's type before it meets a parameter, or nothing when it needs one to be typed.
  private tried(this: Mut<this>, a: Ref<Expr>): Type | undefined {
    try {
      return this.value(a);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A signature's parameter types, unless it is generic, when each call's instance decides them.
  /** @throws {CompileError} */
  private signatureTypes(this: Mut<this>, f: Ref<Body>): Type[] | undefined {
    if ((f.typeParams ?? []).some((p) => !isLifetime(p)) || f.params.some((p) => p.comptime)) return undefined;
    const bounds = this.ctx.implicitOf(f.bodyId);
    // With an implicit parameter, an instance would check the signature's body against bounds,
    // so the others are read as declared.
    const known = bounds.size > 0 ? this.ctx.members().paramTypesOf(f.bodyId) : this.ctx.paramTypes(this.ctx.instanceOf(f.bodyId, undefined));
    return f.params.map((p, i) => {
      const t = bounds.get(i) ?? known[i]!;
      return p.optional ? this.ctx.tables.typing.unionType([t, "null"]) : p.rest && this.isArray(this.ctx.tables.typing.lower(t)) ? this.ctx.tables.typing.rec(this.ctx.tables.typing.lower(t) as ArrayType).element : t;
    });
  }

  // Whether an argument passes for a parameter, as choosing an overload asks before the call
  // checks it against the one chosen.
  /** @throws {CompileError} */
  private passes(this: Mut<this>, a: Ref<Expr>, given: Type | undefined, to: Type, p: Ref<Param>): boolean {
    if (a.kind === "arrow") return this.arrowPasses(a, to);
    if (given === undefined) return true;
    if (this.ctx.tables.typing.fits(given, to)) return true;
    if (this.isRefType(to)) return this.passes(a, this.isRefType(given) ? this.ctx.tables.typing.rec(given).to : given, this.ctx.tables.typing.rec(to).to, p);
    if (this.isRefType(given)) return this.passes(a, this.ctx.tables.typing.rec(given).to, to, p);
    const n = this.numberLiteral(a);
    if (typeof to === "string") {
      if (n === undefined || !isNumeric(to)) return false;
      if (isFloat(to)) return true;
      return typeof n === "bigint" && isInteger(to) && n >= range(to)[0] && n <= range(to)[1];
    }
    const r = this.ctx.tables.typing.rec(to);
    if (r.kind === "union") return r.members.some((m) => this.passes(a, given, m, p));
    if (r.kind === "interface") return unsatisfied(given, to as InterfaceType, this.ctx.members(), a) === undefined;
    if (r.kind === "literal") return (a.kind === "string" || a.kind === "bool") ? a.value === r.value : n !== undefined && n === r.value;
    return false;
  }

  // Whether an arrow passes for a function type: no more parameters than it takes, each one
  // written with a type taking what it is given. Without a function type, the call decides.
  private arrowPasses(this: Mut<this>, a: Ref<Extract<Expr, { kind: "arrow" }>>, to: Type): boolean {
    const r = this.recOf(to);
    if (r?.kind === "union") return r.members.some((m) => this.arrowPasses(a, m));
    if (r?.kind !== "function" || (r.generic !== undefined)) return true;
    if (a.params.length > r.params.length) return false;
    return a.params.every((q, i) => {
      if ((q.type === undefined)) return true;
      const written = this.tryType(q.type);
      return written === undefined || this.ctx.tables.typing.fits(r.params[i]!, written);
    });
  }

  private tryType(this: Mut<this>, t: Ref<TypeNode>): Type | undefined {
    try {
      return this.ctx.resolveType(t);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A numeric literal's value, negated or not: a bigint for an integer, a number for a float.
  private numberLiteral(a: Ref<Expr>): bigint | f64 | undefined {
    if (a.kind === "int") return a.value;
    if (a.kind === "float") return a.value;
    if (a.kind === "unary" && a.op === "-") {
      const n = this.numberLiteral(a.operand);
      return n === undefined ? undefined : -n;
    }
    return undefined;
  }

  // A call's arguments against a JS declaration's parameters: a trailing Option may be left out,
  // as an optional parameter.
  /** @throws {CompileError} */
  private jsArgs(this: Mut<this>, e: Call | Extract<Expr, { kind: "new" }>, params: Type[], optional: boolean[]) {
    this.ctx.tables.jsCrossings.add(e);
    this.ctx.tables.jsOptionalOf.set(e, optional);
    const list = e.args ?? [];
    let required = params.length;
    while (required > 0 && this.ctx.tables.typing.isOption(params[required - 1]!)) required--;
    if (list.length < required || list.length > params.length) {
      const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
      throw new CompileError("E0501", `expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${list.length}`, e.start, e.end);
    }
    list.forEach((a, i) => {
      if (a.kind === "spread") throw new CompileError("E1005", "spreading arguments into a package's functions isn't supported yet", a.start, a.end);
      this.expect(a, params[i]!);
      const given = this.value(a);
      this.coerce(a, given, params[i]!, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(params[i]!)}'`);
      this.givenToJs(a, given);
    });
  }

  // A value given to JS, which the call or write converts: refused when it has no JS form.
  /** @throws {CompileError} */
  private givenToJs(this: Mut<this>, a: Ref<Expr>, given: Type) {
    this.ctx.tables.jsGiven.add(cloneExpr(a));
    // A type parameter is what it stands for in this instance.
    for (let r = this.recOf(given); r?.kind === "param" && r.concrete !== undefined; r = this.recOf(given)) given = r.concrete;
    // A callback given to JS is kept by JS, which may call it later from whichever task calls
    // into JS next, so what it holds goes with it to any thread.
    // A future given to JS is a promise, running as a task from when it is given.
    if (typeof given !== "string" && (this.ctx.tables.typing.rec(given).kind === "future" || this.ctx.tables.typing.rec(given).kind === "handle")) {
      if (!this.ctx.async) throw new CompileError("E1005", "a Promise given to JS starts running as a task when it is given, so it is given only inside an 'async' function", a.start, a.end);
      const blocker = this.unsent(given);
      if (blocker) throw new CompileError("E1005", `a Promise given to JS runs as a task of its own, so it must own everything it uses; it holds a '${this.ctx.tables.typing.show(blocker)}'`, a.start, a.end);
      return;
    }
    if (typeof given !== "string" && (this.ctx.tables.typing.rec(given).kind === "closure" || this.ctx.tables.typing.rec(given).kind === "function" || this.ctx.tables.typing.rec(given).kind === "dyn")) {
      const blocker = this.unsent(given);
      if (blocker) throw new CompileError("E1005", `a callback given to JS must own everything it uses, as JS may keep it and call it from another task; it holds a '${this.ctx.tables.typing.show(blocker)}'`, a.start, a.end);
      return;
    }
    // JS keeps a callback or a future, so one only borrowed here can't be given; one inside
    // another value would be dropped by Fish as well as kept by JS.
    if (this.isRefType(given) && this.ctx.tables.typing.keptByJs(this.ctx.tables.typing.rec(given).to)) throw new CompileError("E1005", "JS keeps a callback or a Promise given to it, so it is given owned, not borrowed; give it a clone, or take it owned", a.start, a.end);
    if (this.ctx.tables.typing.holdsPart(given, (u) => u !== given && this.ctx.tables.typing.keptByJs(u))) throw new CompileError("E1005", "a callback or a Promise inside another value isn't supported yet; give it to JS on its own", a.start, a.end);
    const open = this.ctx.tables.typing.holdsPart(given, (p) => this.placeholder(p));
    if (!open && !this.ctx.tables.typing.jsConverts(given)) throw new CompileError("E1005", `a '${this.ctx.tables.typing.show(given)}' has no JS form yet, so it can't be given to JS`, a.start, a.end);
  }

  // A package's declared parameters as Fish types: an optional one is an Option.
  /** @throws {CompileError} */
  private jsParams(this: Mut<this>, params: Ref<Param[]>): Type[] {
    return params.map((p) => {
      const written = p.type !== undefined ? this.ctx.resolveType(p.type) : this.ctx.tables.typing.blockType("JsValue");
    const declared = this.ctx.tables.typing.jsTakes(written);
      return p.optional ? this.ctx.tables.typing.unionType([declared, "null"]) : declared;
    });
  }

  // `new C(...)` of a package's class: its constructor's parameters, giving a handle.
  /** @throws {CompileError} */
  private jsNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, c: Interface): Type {
    if (c.typeParams.length > 0) throw unsupported("generic classes of a package", e);
    const constructor = this.jsChain(c).find((k) => k.jsClass!.constructors.length > 0)?.jsClass!.constructors[0] ?? [];
    const params = this.jsParams(constructor);
    params.forEach((p) => this.crossing(p, `'${c.name}''s constructor takes a`, e));
    this.jsArgs(e, params, constructor.map((p) => p.optional));
    this.ctx.tables.jsNews.set(e, c.js!);
    return this.ctx.resolveType({ id: nextId(this.ctx.tables.ids), kind: "ref", name: c.name, args: [], start: e.start, end: e.end });
  }

  // A package's class and the classes it extends, nearest first: a class without its own
  // constructor takes its base's, and inherits its statics, as in JS.
  private jsChain(c: Interface): Interface[] {
    const chain = [c];
    for (let at = c; ; ) {
      const base = at.extends[0]?.kind === "ref" ? this.ctx.tables.jsClasses.get(at.extends[0].name) : undefined;
      if (!base || chain.includes(base)) return chain;
      chain.push(base);
      at = base;
    }
  }

  // A property or method of an `unknown`, which has none until a check says what it holds.
  private unnarrowed(e: Ref<Extract<Expr, { kind: "member" }>>): CompileError {
    return new CompileError("E0502", `an 'unknown' could hold anything, so it has no property '${shownName(e.name)}' until it is narrowed; check what it holds first, with 'typeof', 'instanceof' or a type predicate`, e.start, e.end);
  }

  // A package's class's static member: a property read, or a method called.
  /** @throws {CompileError} */
  private jsStatic(this: Mut<this>, c: Interface, name: string, at: Ref<Expr>): TypeMember {
    const found = this.jsChain(c).flatMap((k) => k.jsClass!.statics).find((m) => "name" in m && m.name === name);
    if (!found) throw new CompileError("E0502", `property '${name}' does not exist on '${c.name}'`, at.start, at.end);
    this.ctx.tables.jsStatics.set(at, c.js!);
    return found;
  }

  // `c.signal` on a controller, another handle to its signal, and `signal.aborted`, whether
  // its controller has aborted: values computed by the runtime, not fields.
  /** @throws {CompileError} */
  private blockProperty(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, t: BlockType): Type {
    if (this.linked(e)) throw unsupported(`optional chains through '${this.ctx.tables.typing.rec(t).which}' values`, e);
    this.ctx.tables.computed.add(cloneExpr(e));
    if (this.ctx.tables.typing.rec(t).which === "JsValue") return this.jsProperty(e, t);
    if (this.ctx.tables.typing.rec(t).which === "AbortController" && e.name === "signal") return this.ctx.tables.typing.blockType("AbortSignal");
    if (this.ctx.tables.typing.rec(t).which === "AbortSignal" && e.name === "aborted") return "boolean";
    if ((this.ctx.tables.typing.rec(t).which === "TcpListener" || this.ctx.tables.typing.rec(t).which === "UdpSocket") && e.name === "port") return "i64";
    throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'`, e.start, e.end);
  }

  // `shared(v)`: v moved into a new counted block, of its type argument, the type expected of
  // it, or else v's own type.
  /** @throws {CompileError} */
  private sharedNew(this: Mut<this>, e: Ref<Call>): { type: Type; what: string } {
    if (e.args.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", "'shared' takes the value it starts with, as in 'shared({ hits: 0 })'", e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const given = e.typeArgs[0] ? this.ctx.tables.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : typeof expected !== "string" && expected !== undefined && this.ctx.tables.typing.rec(expected).kind === "shared" ? (this.ctx.tables.typing.rec(expected as SharedType)).of : undefined;
    const a = e.args[0]!;
    if (given) this.expect(a, given);
    const t = this.value(a);
    const of = given ?? this.ctx.tables.typing.heldArgument(this.ctx.tables.typing.widenLet(t));
    this.coerce(a, t, of, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(of)}'`);
    return { type: shareable(this.ctx.tables.typing, of, e), what: "'shared'" };
  }

  // A shared value's `update`, a Lock's: the callback changes the value under the block's lock.
  /** @throws {CompileError} */
  private sharedCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: SharedType): { type: Type; what: string } {
    const which = this.ctx.tables.typing.rec(t).which;
    if (which === "Weak") return this.weakCall(e, callee, t);
    if (which === "Rc" && callee.name === "downgrade") {
      if (e.args.length > 0) throw new CompileError("E0504", "'downgrade' takes no arguments", e.start, e.end);
      return { type: this.ctx.tables.typing.sharedType(this.ctx.tables.typing.rec(t).of, "Weak"), what: "'downgrade'" };
    }
    const inner = this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of);
    const stored = typeof inner !== "string" && (this.ctx.tables.typing.rec(inner).kind === "object" || this.ctx.tables.typing.rec(inner).kind === "class") ? this.ctx.tables.typing.field(inner, callee.name) : undefined;
    if (stored && this.isCallable(this.ctx.tables.typing.lower(stored.type))) return this.callableCall(e, callee, this.ctx.tables.typing.lower(stored.type) as DynType);
    if (which === "Rc" && callee.name === "read") return this.lockCall(e, callee, this.ctx.tables.typing.interiorType("RwLock", this.ctx.tables.typing.rec(t).of), true, true);
    const method = which === "Rc" && this.recOf(inner)?.kind === "class" ? this.inheritedOf(inner as ClassType, "methods", callee.name) : undefined;
    if (method) return this.rcMethod(e, callee, method);
    if (callee.name !== "update") throw new CompileError("E0502", `'${which}' has no method '${callee.name}'; read its fields, change it with 'update', ${which === "Rc" ? "read it in place with 'read', share it again with 'clone', or reach it weakly with 'downgrade'" : "or share it again with 'clone'"}`, callee.start, callee.end);
    return this.lockCall(e, callee, this.ctx.tables.typing.interiorType("Lock", this.ctx.tables.typing.rec(t).of), true, which === "Rc");
  }

  // `rc.m(args)` for a method that only reads: `rc.read((v) => v.m(args))`, so its call counts as
  // a read of the value, which nested reads may share and an update may not.
  /** @throws {CompileError} */
  private rcMethod(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, method: Ref<Body>): { type: Type; what: string } {
    if (method.self?.mutable || method.self?.owned) {
      throw new CompileError("E0304", `'${callee.name}' changes its object, so on an Rc it runs inside 'update', as in '${this.placeText(this.bare(callee.object))}.update((v) => v.${callee.name}(...))'`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported("optional chains calling methods through an Rc", callee);
    const at = { start: e.start, end: e.end };
    const name = "rc value";
    const param: Param = { ...at, id: nextId(this.ctx.tables.ids), pattern: { id: nextId(this.ctx.tables.ids), kind: "ident", name, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false };
    const inner: Expr = { ...e, id: nextId(this.ctx.tables.ids), callee: { ...callee, id: nextId(this.ctx.tables.ids), object: { id: nextId(this.ctx.tables.ids), kind: "ident", name, start: callee.object.start, end: callee.object.end } } };
    const arrow: Expr = { id: nextId(this.ctx.tables.ids), kind: "arrow", move: false, async: false, typeParams: [], params: [param], returnType: undefined, body: inner, ...at };
    const read = this.ctx.tables.rewrites.replace(e, { ...e, callee: { ...callee, id: nextId(this.ctx.tables.ids), name: "read" }, args: [arrow], typeArgs: [] }) as Call;
    return this.call(read);
  }

  // `Rc.ptrEq(a, b)`: whether two Rcs share one block, which `===` doesn't ask, since it
  // compares values. Each is borrowed for the test.
  /** @throws {CompileError} */
  private ptrEq(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>): { type: Type; what: string } {
    if (callee.name !== "ptrEq") throw new CompileError("E0502", `'Rc' has no '${callee.name}'; it has 'ptrEq', which tells whether two Rcs share one value`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", "'Rc' is always there, so 'Rc.ptrEq' is called without '?.'", e.start, e.end);
    if (e.args.length !== 2 || e.typeArgs.length > 0 || e.args.some((a) => a.kind === "spread")) throw new CompileError("E0504", "'Rc.ptrEq' takes the two Rcs to compare, as in 'Rc.ptrEq(a, b)'", e.start, e.end);
    const held = e.args.map((a) => {
      const t = this.value(a);
      const r = this.recOf(this.isRefType(t) ? this.ctx.tables.typing.rec(t as RefType).to : t);
      if (r?.kind !== "shared" || r.which !== "Rc") throw new CompileError("E0504", `'Rc.ptrEq' compares two Rcs, not '${this.ctx.tables.typing.show(t)}'`, a.start, a.end);
      if (!this.isRefType(t)) {
      const lent = this.ctx.tables.typing.refType(t, false);
      this.coerce(a, t, lent, "");
    }
      return this.ctx.tables.typing.lower(r.of);
    });
    if (held[0] !== held[1]) throw new CompileError("E0504", `'Rc.ptrEq' compares two Rcs of one type, not '${this.ctx.tables.typing.show(this.ctx.types.get(e.args[0]!)!)}' and '${this.ctx.tables.typing.show(this.ctx.types.get(e.args[1]!)!)}'`, e.start, e.end);
    return { type: "boolean", what: "'Rc.ptrEq'" };
  }

  // `w.upgrade()`: an Rc of the value a Weak reaches while any Rc of it is left, or else null.
  /** @throws {CompileError} */
  private weakCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: SharedType): { type: Type; what: string } {
    if (callee.name !== "upgrade") throw new CompileError("E0502", `'Weak' has no method '${callee.name}'; reach its value with 'upgrade', which gives an 'Rc' or null, or copy it with 'clone'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Weak' methods", callee);
    if (e.args.length > 0) throw new CompileError("E0504", "'upgrade' takes no arguments", e.start, e.end);
    const rc = this.ctx.tables.typing.sharedType(this.ctx.tables.typing.rec(t).of, "Rc");
    return { type: this.ctx.tables.typing.unionType([rc, "null"]), what: "'upgrade'" };
  }

  // `s.f` on a shared value: an interior-mutable field is borrowed where it lives, unlocked,
  // since it changes only through its own methods; any other is copied out under the lock.
  /** @throws {CompileError} */
  private sharedField(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, t: SharedType): Type {
    if (this.linked(e)) throw unsupported("optional chains through shared values", e);
    if (this.ctx.tables.typing.rec(t).which === "Weak") throw new CompileError("E0502", `a 'Weak' reaches its value only through 'upgrade()', which gives an 'Rc' while one is left, as in 'const p = ${this.placeText(this.bare(e.object))}.upgrade()'`, e.start, e.end);
    const inner = this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of);
    const ir = this.recOf(inner);
    if (ir?.kind === "class") this.cls(inner as ClassType);
    const found = ir === undefined || ir.kind === "closure" ? undefined : this.ctx.tables.typing.field(inner as Exclude<Type, string>, e.name);
    if ((found === undefined)) throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'${didYouMean(e.name, this.memberNames(inner))}`, e.start, e.end);
    if (ir?.kind === "class") this.visible(found.access, this.declaring(inner as ClassType, e.name), e.name, { start: e.start, end: e.end });
    // A Rust value is reached only under the lock, and a read here would copy its handle out.
    let rust: RustClass | undefined;
    if (this.ctx.tables.typing.holdsPart(found.type, (u) => (rust ??= rustClassOf(this.ctx.tables.typing, u)) !== undefined)) {
      throw new CompileError("E1004", `'${e.name}' holds a Rust '${rust!.name}', which a shared value gives only inside 'update', as in 's.update((v) => v.${e.name}...)'`, e.start, e.end);
    }
    if (!this.ctx.tables.typing.interiorMutable(found.type)) this.ctx.copiesOut.add(e);
    return found.type;
  }

  // `lock.update(v => ...)`: the callback changes what the lock holds while it is locked, and
  // gives what the callback gives; an RwLock's `read` lends it read-only, beside other readers.
  // A closure can't return a reference, so nothing it gives borrows from the value once the
  // lock is released.
  /** @throws {CompileError} */
  private lockCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: InteriorType, sharing = false, counting = false): { type: Type; what: string } {
    const method = callee.name;
    const which = this.ctx.tables.typing.rec(t).which;
    if (method !== "update" && !(method === "read" && which === "RwLock")) {
      const has = which === "RwLock" ? "'read' runs a callback with a read-only view of what it holds, and 'update' with a mutable one" : "'update' runs a callback with what it holds";
      throw new CompileError("E0502", `'${which}' has no method '${method}'; ${has}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported(`optional chains calling '${which}' methods`, callee);
    if (e.args.length !== 1) throw new CompileError("E0506", `'${method}' takes 1 argument, a callback like 'v => ...'`, e.start, e.end);
    const callback = e.args[0]!;
    if (callback.kind !== "arrow") throw unsupported(`callbacks passed to '${method}' by name; write the arrow function in place`, callback);
    const held = this.ctx.tables.typing.refType(this.ctx.tables.typing.lowerKeepingBrands(this.ctx.tables.typing.rec(t).of), method === "update");
    const signature = this.ctx.tables.typing.functionType(["value"], [held], "void");
    this.ctx.tables.typing.lockCallbacks.set(signature, method);
    if (sharing) this.ctx.tables.typing.sharedCallbacks.add(signature);
    if (counting) this.ctx.tables.typing.rcCallbacks.add(signature);
    this.expect(callback, signature);
    const c = this.recOf(this.value(callback));
    if (c?.kind !== "closure" || c.params.length > 1) throw new CompileError("E0506", `'${method}' passes its callback a '${this.ctx.tables.typing.show(held)}'`, callback.start, callback.end);
    if (c.params[0] !== undefined) this.passedExactly(method, held, c.params[0], callback.kind === "arrow" ? callback.params[0] : undefined, callback);
    return { type: c.returns, what: `'${method}'` };
  }

  // `await p`: the future runs to completion, the async function stopping while it is pending,
  // and gives its value, or raises its error as a call would. It moves into the await.
  /** @throws {CompileError} */
  private awaited(this: Mut<this>, e: Ref<Extract<Expr, { kind: "unary" }>>): Type {
    if ((this.ctx.locked !== undefined) && this.ctx.counting) throw new CompileError("E0304", `an Rc's '${this.ctx.locked}' callback can't 'await': the value stays marked as ${this.ctx.locked === "read" ? "read" : "changed"} until the callback returns, and code running meanwhile would find it so; finish the ${this.ctx.locked}, then await`, e.start, e.end);
    if (this.ctx.locked) throw new CompileError("E0304", `'${this.ctx.locked}' holds its lock while the callback runs, so the callback can't 'await': every task needing the lock would wait too; finish the ${this.ctx.locked}, then await`, e.start, e.end);
    if (!this.ctx.async || this.ctx.syncMain) throw new CompileError("E0301", "'await' can only be used inside an 'async' function", e.start, e.end);
    if (!this.ctx.awaitable.has(e)) throw new CompileError("E0801", "'await' inside an expression isn't supported yet; give its value a name first, as in 'const x = await ...;'", e.start, e.end);
    this.ctx.tables.awaitedNow.add(e.operand);
    let t = this.value(e.operand);
    // Through a bound: in an instance, the concrete method's own future; in the definition, what
    // the bound's `Promise<T>` gives.
    const p = this.recOf(t);
    if (p?.kind === "param" && p.concrete) t = p.concrete;
    const r = this.recOf(t);
    const promise = r?.kind === "param" ? r.bound : t;
    const described = this.recOf(promise)?.kind === "interface" ? this.ctx.tables.typing.promiseElement(promise!) : undefined;
    if (described !== undefined && (r?.kind === "interface" || r?.kind === "param")) return described;
    if (r?.kind === "param" || r?.kind === "interface") throw unsupported("awaits of 'Promise<T>' parameters", e.operand);
    if (r?.kind === "dyn" && this.ctx.tables.typing.promiseElement(r.of) !== undefined) return this.ctx.tables.typing.promiseElement(r.of)!;
    if (r === undefined || (r.kind !== "future" && r.kind !== "handle")) throw new CompileError("E0305", `'await' needs a Promise, like an async function's call, not '${this.ctx.tables.typing.show(t)}'`, e.operand.start, e.operand.end);
    if (r.throws) this.ctx.raise(e, r.throws, "this Promise");
    return r.gives;
  }

  // `Promise.all`, `race`, `allSettled` and `any`: one future awaiting those in the list at once,
  // in this task. It is awaited where it is made, so the futures' borrows end with the await.
  /** @throws {CompileError} */
  private combined(this: Mut<this>, e: Ref<Call>, kind: Combiner): { type: Type; what: string } {
    const name = `'Promise.${kind}'`;
    if (e.optional) throw new CompileError("E0505", `${name} is always there, so it is called without '?.'`, e.start, e.end);
    if (!this.ctx.tables.awaitedNow.has(e)) throw new CompileError("E0305", `${name} is awaited where it is called, as in 'await Promise.${kind}([a(), b()])'`, e.start, e.end);
    const [list] = e.args;
    if (e.args.length !== 1 || list === undefined || list.kind === "spread") throw new CompileError("E0305", `${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])'`, e.start, e.end);
    // An array of `Promise<T>` values gives a `T[]`, or for `race` a `T`.
    if (list.kind !== "array") {
      const t = this.value(list);
      const lr = this.recOf(t);
      const er = this.recOf(lr?.kind === "array" ? lr.element : undefined);
      if (er?.kind !== "dyn" || this.ctx.tables.typing.promiseElement(er.of) === undefined) throw new CompileError("E0305", `${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])' or a 'Promise<T>[]', not '${this.ctx.tables.typing.show(t)}'`, list.start, list.end);
      this.ctx.tables.combinedCalls.add(e);
      // Boxed futures throw nothing, so an `any` over them fails only when the array is empty,
      // with no errors, typed as null.
      return { type: this.ctx.tables.typing.combinedFuture({ kind, futures: [], array: t as ArrayType, aggregate: kind === "any" ? this.aggregateOf("null", e) : undefined, at: e }), what: name };
    }
    if (list.elements.length === 0) throw new CompileError("E0305", `${name} needs a Promise to wait for${kind === "race" ? "; an empty race never settles" : ""}`, list.start, list.end);
    const futures = list.elements.map((x) => {
      if (x === undefined || x.kind === "spread") throw new CompileError("E0305", `${name} takes each Promise written in the list`, (x ?? list).start, (x ?? list).end);
      if (x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise" && COMBINERS.includes(x.callee.name) && (this.ctx.lookup("Promise", undefined) === undefined) && !this.ctx.classes.has("Promise")) {
        throw new CompileError("E0305", `'Promise.${(x.callee as { name: string }).name}' can't be in another Promise's list; give it an async function of its own, as in 'async function both() { return await Promise.all([...]); }', and put its call in the list`, x.start, x.end);
      }
      let t = this.value(x);
      const p = this.recOf(t);
      if (p?.kind === "param" && p.concrete) t = p.concrete;
      const r = this.recOf(t);
      if (r?.kind === "dyn" && this.ctx.tables.typing.promiseElement(r.of) !== undefined) return t as DynType;
      if (r === undefined || (r.kind !== "future" && r.kind !== "handle")) throw new CompileError("E0305", `${name} takes Promises, like an async function's call, not '${this.ctx.tables.typing.show(t)}'`, x.start, x.end);
      return t as FutureType | HandleType;
    });
    // An `any` fails only when every future can, with all their errors.
    const thrown = futures.map((f) => { const r = this.ctx.tables.typing.rec(f); return r.kind === "dyn" ? undefined : r.throws; });
    const aggregate = kind === "any" && thrown.every((x) => x !== undefined) ? this.aggregateOf(this.ctx.tables.typing.unionType(thrown as Type[]), e) : undefined;
    const type = this.ctx.tables.typing.combinedFuture({ kind, futures, aggregate, at: e });
    this.ctx.tables.combinedCalls.add(e);
    return { type, what: name };
  }

  // The prelude's `AggregateError<E>` for errors of type `E`.
  /** @throws {CompileError} */
  private aggregateOf(this: Mut<this>, errors: Type, at: Ref<Span>): ClassType {
    return this.ctx.tables.arenas.classOf(this.ctx.construct("AggregateError", [], [this.ctx.tables.typing.arrayType(errors)], at)!).type as ClassType;
  }

  // What keeps a value from moving to another thread: a reference, which borrows from the
  // thread that made it, a raw pointer, which nothing checks, a Cell, which changes unlocked, or
  // an Rc or a Weak, whose counts do.
  private unsent(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    // A type holding itself is looked into once.
    if (typeof t === "string" || seen.has(t)) return undefined;
    seen.add(t);
    const r = this.ctx.tables.typing.rec(t);
    if (r.kind === "ref" || r.kind === "pointer" || (r.kind === "interior" && r.which === "Cell") || (r.kind === "shared" && r.which !== "shared") || (r.kind === "dyn" && this.ctx.tables.typing.borrowing.has(r.of))) return t;
    // A Rust type is Send, which the shim asserts.
    if ((rustClassOf(this.ctx.tables.typing, t) !== undefined)) return undefined;
    const parts = r.kind === "interior" ? [r.of] : r.kind === "future" || r.kind === "generator" ? r.params.map((f) => f.type)
      : r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "map" ? [r.key, r.value] : r.kind === "class" && (r.base !== undefined) ? [r.base, ...r.fields.map((f) => f.type)] : this.ctx.tables.typing.fieldsOf(t).map((f) => f.type);
    for (const part of parts) {
      const found = this.unsent(part, seen);
      if ((found !== undefined)) return found;
    }
    return undefined;
  }

  // `g.next()` runs a generator to its next `yield`, changing it, so it needs a place. An async
  // generator's gives a future borrowing it, awaited where it is made so the borrow ends there.
  /** @throws {CompileError} */
  private generatorCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, generator: Type, yields: Type, async = false): { type: Type; what: string } {
    if (!async && Object.hasOwn(GENERATOR_HELPERS, callee.name)) return this.helperCall(e, callee, yields);
    if (callee.name !== "next") throw new CompileError("E0502", `generators have no method '${callee.name}' yet${didYouMean(callee.name, async ? ["next"] : ["next", ...Object.keys(GENERATOR_HELPERS)])}`, callee.start, callee.end);
    if (async && !this.ctx.tables.awaitedNow.has(e)) throw new CompileError("E0305", "an async generator's 'next()' is awaited where it is called, as in 'await g.next()'", e.start, e.end);
    if (this.linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    const sends = this.ctx.tables.typing.generatorSends(generator);
    if (e.args.length > 0 && async) throw unsupported("values sent into an async generator's 'next'", e.args[0]!);
    if (e.args.length > 0 && sends === undefined) throw new CompileError("E0606", `this generator takes nothing through 'next'; to send it values, declare what it takes, as in 'Generator<${this.ctx.tables.typing.show(yields)}, void, string>'`, e.args[0]!.start, e.args[0]!.end);
    if (e.args.length > 1) throw new CompileError("E0606", "'next' takes at most 1 argument, the value the generator's 'yield' gives", e.args[1]!.start, e.args[1]!.end);
    // Like JavaScript, `next()` with nothing sent is allowed; a `yield` whose value is used panics.
    const arg = e.args[0];
    if (arg) {
      this.expect(arg, sends!);
      const t = this.value(arg);
      if (this.ctx.tables.typing.holdsRef(t)) throw unsupported("references sent into generators", arg);
      this.coerce(arg, t, sends!, `argument of type '${this.ctx.tables.typing.show(t)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(sends!)}'`);
    }
    const held = this.ctx.types.get(callee.object)!;
    if (this.isRefType(held)) this.ctx.coercions.set(callee.object, generator);
    if (!this.place(callee.object)) throw new CompileError("E0212", "'next' changes its generator, so call it on a variable or a field", callee.start, callee.end);
    this.changeable(callee.object, "advance");
    const error = this.ctx.tables.typing.generatorThrows(generator);
    if (!async && error) this.ctx.raise(e, error, "'next'");
    if (!async) return { type: this.ctx.tables.typing.nextResult(yields), what: "'next'" };
    const g = this.recOf(generator);
    const made = this.recOf(g?.kind === "param" && g.concrete ? g.concrete : generator);
    return { type: made?.kind === "generator" ? this.ctx.tables.typing.leafFuture("next", (g?.kind === "param" && g.concrete ? g.concrete : generator as GeneratorType)) : this.ctx.tables.typing.promiseInterface(this.ctx.tables.typing.nextResult(yields)), what: "'next'" };
  }

  // The iterator helpers call std's generators and functions over the generator, which they take
  // over. `map`, `filter`, `take`, `drop` and `flatMap` give a generator that pulls from it only
  // when pulled; the rest run it at once. Callbacks get each value and its index, the predicates
  // a borrow of the value.
  /** @throws {CompileError} */
  private helperCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, yields: Type): { type: Type; what: string } {
    const name = callee.name;
    const source = callee.object;
    if (this.linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    if (this.isRefType(this.ctx.types.get(source)!)) throw new CompileError("E0202", `'${name}' takes its generator over, and this one is borrowed; call it on a generator this code owns`, source.start, source.end);
    this.ctx.exprsState.once.add(cloneExpr(source));
    const counted = name === "take" || name === "drop";
    if (name === "toArray" ? e.args.length !== 0 : name === "reduce" ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      const takes = name === "toArray" ? "no arguments" : counted ? "1 argument, a count" : name === "reduce" ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'";
      throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    }
    if (name === "toArray") return this.callMade(this.ctx.tables.rewrites.replace(e, this.stdHelper(name, "array collect", [cloneExpr(source)], e)));
    if (counted) {
      const count = this.panicking(this.stdHelper(name, "iter count", [cloneExpr(e.args[0]!)], e), `'${name}''s count can't be negative`, e);
      return this.callMade(this.ctx.tables.rewrites.replace(e, this.stdHelper(name, GENERATOR_HELPERS[name]!, [cloneExpr(source), count], e)));
    }
    // A declared function given by name becomes an arrow calling it, as for array methods.
    const made = this.namedFunction(e.args[0]!);
    if (made !== undefined) return this.helperNamed(e, callee, yields, made);
    return this.helperNamed(e, callee, yields, e.args[0]!);
  }

  // A call of one of std's helpers, shown as the method `name` in messages.
  private stdHelper(this: Mut<this>, name: string, helperName: string, args: Expr[], at: Ref<Span>): Expr {
    const id = nextId(this.ctx.tables.ids);
    return { id, kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "ident", name: helperName, start: at.start, end: at.end }, args, typeArgs: [], optional: false, shown: name, start: at.start, end: at.end };
  }

  // A count or a fold that can't give a value panics at the call, with JavaScript's reason.
  private panicking(this: Mut<this>, expr: Expr, reason: string, at: Ref<Span>): Expr {
    return { id: nextId(this.ctx.tables.ids), kind: "nonNull", expr, reason, start: at.start, end: at.end };
  }

  /** @throws {CompileError} */
  private helperNamed(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, yields: Type, callback: Ref<Expr>): { type: Type; what: string } {
    const name = callee.name;
    const reducing = name === "reduce";
    const lent = PREDICATES.has(name);
    const each = lent ? this.ctx.tables.typing.refType(yields, false) : yields;
    const init = e.args.length > 1 ? this.value(e.args[1]!) : undefined;
    const acc = !reducing ? undefined : init !== undefined ? this.ctx.tables.typing.widenLet(init) : yields;
    if (e.args.length > 1) this.ctx.exprsState.once.add(cloneExpr(e.args[1]!));
    const params: Type[] = acc !== undefined ? [acc, each, "i64"] : [each, "i64"];
    if (callback.kind === "arrow" && callback.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc !== undefined ? "the accumulator, " : ""}the value and its index`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    // std calls the callback with every argument, so an arrow leaving some out takes them under
    // names no program can write.
    if (callback.kind === "arrow" && callback.params.length < params.length) {
      const names = acc !== undefined ? ["accumulator", "value", "index"] : ["value", "index"];
      const at = { start: callback.start, end: callback.start };
      let all: Param[] = [];
      for (const p of callback.params) all.push(cloneParam(p));
      for (let i = callback.params.length; i < params.length; i++) {
        const id = nextId(this.ctx.tables.ids);
        all.push({ id, pattern: { id: nextId(this.ctx.tables.ids), kind: "ident", name: `_ ${names[i]!}`, start: at.start, end: at.end }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, start: at.start, end: at.end });
      }
      const widened = this.ctx.tables.rewrites.replace(callback, { ...callback, params: all });
      return this.helperWith(e, callee, yields, widened, params, acc);
    }
    return this.helperWith(e, callee, yields, callback, params, acc);
  }

  /** @throws {CompileError} */
  private helperWith(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, yields: Type, callback: Ref<Expr>, params: Ref<Type[]>, acc: Type | undefined): { type: Type; what: string } {
    const name = callee.name;
    const source = callee.object;
    const reducing = name === "reduce";
    const lent = PREDICATES.has(name);
    const names = acc !== undefined ? ["accumulator", "value", "index"] : ["value", "index"];
    // std lends a predicate even a value that copies; a function taking the copy reads it there.
    if (callback.kind === "arrow" && lent && this.ctx.tables.typing.isCopy(yields) && callback.params.length > 0 && this.ctx.tables.presetParams.get(callback.params[0]!) === yields) this.ctx.tables.presetParams.delete(callback.params[0]!);
    const signature = this.ctx.tables.typing.functionType(names, params.slice(), "void");
    this.expect(callback, signature);
    const called = this.value(callback);
    const c = this.recOf(called);
    this.ctx.exprsState.once.add(cloneExpr(callback));
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    for (let i: usize = 0; i < c.params.length; i++) {
      const written = callback.kind === "arrow" && i < callback.params.length ? callback.params[i] : undefined;
      this.passedExactly(name, params[i]!, c.params[i]!, written, { start: callback.start, end: callback.end }, i + 1 !== params.length);
    }
    this.runsOften(called as ClosureType, name, "its callback once per value", callback);
    const gives = c.returns;
    if (lent && gives !== "boolean") {
      throw new CompileError("E0506", `'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    }
    if (acc !== undefined && !this.ctx.tables.typing.fits(gives, acc)) throw new CompileError("E0506", `'${name}''s callback gives the next accumulator, a '${this.ctx.tables.typing.show(acc)}', but this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || this.ctx.tables.typing.holdsRef(gives))) throw new CompileError("E0506", `'map''s callback has to give a value to keep, not '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
    let target = GENERATOR_HELPERS[name]!;
    if (name === "flatMap") {
      if (this.ctx.tables.typing.yieldsOf(this.ctx.tables.typing.lower(gives)) !== undefined) target = "iter flat map generator";
      else if (!this.isArray(this.ctx.tables.typing.lower(gives))) throw new CompileError("E0506", `'flatMap''s callback gives a generator or an array for each value, whose values make up the result; this one gives '${this.ctx.tables.typing.show(gives)}'`, callback.start, callback.end);
      else this.clonable(this.ctx.tables.typing.rec(this.ctx.tables.typing.lower(gives) as ArrayType).element, callback, "flatMap");
    }
    const at = { start: e.start, end: e.end };
    if (reducing && e.args.length < 2) {
      // std gives the fold in a one-element tuple, or nothing when the generator was empty.
      const folded = this.panicking(this.stdHelper(name, "iter reduce first", [cloneExpr(source), cloneExpr(callback)], e), "reduce of empty generator with no initial value", e);
      const index: Expr = { id: nextId(this.ctx.tables.ids), kind: "int", value: 0n, start: at.start, end: at.end };
      return { type: this.typeOf(this.ctx.tables.rewrites.replace(e, { id: 0, kind: "index", object: folded, index, optional: false, start: at.start, end: at.end })), what: "'reduce'" };
    }
    const args: Expr[] = e.args.length > 1 ? [cloneExpr(source), cloneExpr(callback), cloneExpr(e.args[1]!)] : [cloneExpr(source), cloneExpr(callback)];
    return this.callMade(this.ctx.tables.rewrites.replace(e, this.stdHelper(name, target, args, e)));
  }

  // Whether an expression is an index into an array, a place inside it.
  private element(given: Ref<Expr>): given is Extract<Expr, { kind: "index" }> {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.elementNow(now) : this.elementNow(given);
  }
  private elementNow(e: Ref<Expr>): e is Extract<Expr, { kind: "index" }> {
    if (e.kind !== "index") return false;
    const object = this.ctx.types.get(e.object);
    const held = object !== undefined && (this.isRefType(object) ? this.ctx.tables.typing.rec(object).to : object);
    return held !== false && (this.isArray(held) || this.isFixed(held));
  }

  // A string read where a string's property or method is used: a literal becomes its string,
  // and a reference is read through. In an optional chain, the chain reads the Option.
  /** @throws {CompileError} */
  private text(this: Mut<this>, object: Ref<Expr>, type: Type, chained: boolean) {
    if (chained && type !== "string") throw unsupported("optional chains on string literal types", object);
    const held = this.ctx.types.get(object);
    if (held && this.isRefType(held)) this.ctx.coercions.set(object, "string");
    else if (type !== "string" && !chained) this.coerce(object, type, "string", "");
  }

  // A member of a data-carrying enum: a variant, read on its own only when it holds nothing.
  // A generic enum's type arguments come from those written, then from the payload, then from
  // the type expected where the value goes.
  /** @throws {CompileError} */
  private variant(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, named: EnumInfo, alone: boolean, given: Type[] = [], typeArgs: TypeNode[] = []): VariantType {
    const data = named.data!;
    const member = data.members.find((m) => m.name === e.name);
    if ((member === undefined)) throw new CompileError("E0502", `property '${e.name}' does not exist on enum '${data.name}'${didYouMean(e.name, data.members.map((m) => m.name))}`, e.start, e.end);
    if (typeArgs.length > 0 && typeArgs.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError("E0707", `enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, e.start, e.end);
    }
    const bindings = new Map<string, Type>();
    const expected = typeArgs.length > 0 ? undefined : this.expectedVariant(e, named, given);
    if (typeArgs.length > 0) data.params.forEach((p, i) => bindings.set(p, this.ctx.resolveType(typeArgs[i]!)));
    else if (expected) data.params.forEach((p, i) => bindings.set(p, this.ctx.tables.typing.rec(expected).args[i]!));
    else {
      const names = new Set(data.params);
      (member.payload ?? []).forEach((node, i) => given[i] && infer(this.ctx.tables, this.ctx.decls, node, this.ctx.tables.typing.widenLet(given[i]!), names, bindings, e));
    }
    const missing = data.params.find((p) => !bindings.has(p));
    if (missing) {
      throw new CompileError("E0104", `can't tell what '${missing}' is for '${data.name}.${e.name}'; give it a declared type, like 'const x: ${data.name}<${data.params.join(", ")}> = ...' with real types`, e.start, e.end);
    }
    const found = this.ctx.enumInstance(named.data!.name, data.params.map((p) => bindings.get(p)!), e).variants.get(e.name)!;
    if (alone && this.ctx.tables.typing.rec(found).fields.length > 0) throw new CompileError("E0503", `'${this.ctx.tables.typing.rec(found).name}' holds ${this.ctx.tables.typing.rec(found).fields.length === 1 ? "a value" : "values"}; build it with '${this.ctx.tables.typing.rec(found).name}(...)'`, e.start, e.end);
    if (!alone && this.ctx.tables.typing.rec(found).fields.length === 0) throw new CompileError("E0503", `'${this.ctx.tables.typing.rec(found).name}' holds nothing, so it isn't called; write '${this.ctx.tables.typing.rec(found).name}'`, e.start, e.end);
    return found;
  }

  // The variant of this enum the type expected here holds: of the instances it names, one whose
  // fields the payload fits, if it is given, or else the first.
  /** @throws {CompileError} */
  private expectedVariant(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, named: EnumInfo, given?: Type[]): VariantType | undefined {
    const want = this.ctx.exprsState.wanted.get(e);
    const wr = this.recOf(want);
    const members = want === undefined ? [] : wr?.kind === "union" ? wr.members : [want];
    const candidates = members.flatMap((t) => {
      const m = this.recOf(t);
      if (m?.kind !== "variant" || m.enum !== named.data!.name) return [];
      const v = this.ctx.enumInstance(named.data!.name, m.args, e).variants.get(e.name);
      return v ? [v] : [];
    });
    // A payload that fits exactly decides first; then a number takes a number type of its own
    // kind, an integer an integer type and a float a float type.
    const suits = (exact: boolean) => (v: VariantType) => this.ctx.tables.typing.rec(v).fields.every((f, i) => {
      const g = given?.[i];
      if (g === undefined || this.ctx.tables.typing.fits(g, f.type)) return true;
      return !exact && isNumeric(g) && isNumeric(f.type) && isFloat(g) === isFloat(f.type);
    });
    return (given && (candidates.find(suits(true)) ?? candidates.find(suits(false)))) ?? candidates[0];
  }

  // Whether `x.clone()` is the compiler's copy: for any value whose class doesn't declare a
  // `clone` method of its own. A base's `clone` makes a base, so it doesn't count.
  /** @throws {CompileError} */
  private copies(this: Mut<this>, t: Type): boolean {
    if (typeof t === "string") return true;
    const r = this.ctx.tables.typing.rec(t);
    if (r.kind === "literal" || r.kind === "pattern") return true;
    // A generator's frame may hold a view into what it iterates, which a copy would share.
    if (r.kind === "generator") return false;
    if (r.kind === "class") return !this.cls(t as ClassType).methods.has("clone");
    const bound = this.recOf(r.kind === "param" ? r.bound : r.kind === "interface" ? t : undefined);
    return (bound === undefined) || bound.kind !== "interface" || !bound.methods.some((m) => m.name === "clone");
  }

  // The compiler's copy of a value, or in an instance, the concrete class's own `clone()`.
  /** @throws {CompileError} */
  private cloned(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, receiver: Type): { type: Type; what: string } {
    if (e.args.length > 0 || e.typeArgs.length > 0) throw new CompileError("E0213", "'clone' takes no arguments", e.start, e.end);
    const stored = this.ctx.tables.typing.lower(receiver);
    // A generator runs once, through its frame, so there is no second one to make.
    const sr = this.recOf(stored);
    if (sr?.kind === "generator") throw new CompileError("E0213", "a generator can't be cloned: it runs once, and a copy would share its place in the run", e.start, e.end);
    // A copy of a value holding references borrows what it does.
    if (this.ctx.tables.typing.holdsRef(receiver)) this.ctx.borrowsFrom.set(e, [callee.object]);
    if (stored !== receiver && sr?.kind === "class" && this.cls(stored as ClassType).methods.has("clone")) {
      return { type: this.concreteMethod(e, callee, stored as ClassType, receiver), what: "'clone'" };
    }
    this.clonable(receiver, e);
    // A clone of what a recursive type's block holds is a value of its own.
    return { type: this.ctx.tables.typing.unfold(receiver), what: "'clone'" };
  }

  // Refuses a value that can't be cloned, for `clone()` and for the array methods that give
  // clones of elements, named by `by`; `dyns` copies Dyns one by one, as those methods do.
  /** @throws {CompileError} */
  private clonable(this: Mut<this>, type: Type, at: Ref<Span>, by?: string, dyns: boolean = by !== undefined) {
    const stored = this.ctx.tables.typing.lower(type);
    const say = (why: string) => new CompileError("E0213", (by !== undefined) ? `'${by}' gives clones of the array's elements, and ${why}` : why, at.start, at.end);
    const permit = this.ctx.tables.typing.holdsPart(stored, (u) => {
      const r = this.recOf(u);
      return r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit");
    });
    if (permit) throw say("can't clone a 'Semaphore' or a 'Permit', or a value holding one: a semaphore's slots are counted, so share it inside a shared value or a class instead");
    let rust: ClassType | undefined;
    const behind = this.isRefType(stored) ? this.ctx.tables.typing.rec(stored as RefType).to : stored;
    this.ctx.tables.typing.holdsPart(behind, (u) => ((rustClassOf(this.ctx.tables.typing, u) !== undefined) ? ((rust = u as ClassType), true) : false));
    if (rust) {
      const name = rustClassOf(this.ctx.tables.typing, rust)!.name;
      if (this.cls(rust).methods.has("clone")) throw say(`can't clone a value holding a Rust '${name}' as a whole; clone each '${name}' with its 'clone()'`);
      throw say(`can't clone a Rust '${name}'${rustClassOf(this.ctx.tables.typing, behind) ? "" : ", or a value holding one,"} unless its class declares 'clone(): ${name}', which calls its Clone`);
    }
    // An array method's copy of a Dyn may panic, which unwinds as a Dyn's own copy does; only
    // `clone()` written on a value holding one asks for its Dyns to be cloned one by one.
    if (!dyns && (typeof stored === "string" || this.ctx.tables.typing.rec(stored).kind !== "dyn") && this.ctx.tables.typing.holdsPart(stored, (u) => typeof u !== "string" && this.ctx.tables.typing.rec(u).kind === "dyn")) throw say("can't clone a value holding a Dyn, whose clone may fail at run time; clone its Dyns one by one");
    const inner = this.ctx.tables.typing.holdsInterior(stored);
    if (inner) throw say(`can't clone ${inner === stored ? "" : "a value holding "}${article(this.ctx.tables.typing.rec(inner as InteriorType).which)}, which is changed in place wherever it is shared; make a new one from what it holds`);
    if (this.ctx.tables.typing.holdsHandle(stored)) throw say("can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself");
    // Its value is given once, so a copy awaited after the first would find nothing to give.
    if (this.ctx.tables.typing.holdsPart(stored, (u) => {
      const r = this.recOf(u);
      return r?.kind === "future" && r.name.startsWith("promise await");
    })) throw say("can't clone a Promise made with 'new Promise', or a value holding one: its value is given once, to one await; await it once and share the value");
    // Two mutable references to one thing can't be.
    if (this.ctx.tables.typing.holdsMut(type)) throw say("can't clone a value holding a mutable reference ('Mut'), since the copy would change the same thing");
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  /** @throws {CompileError} */
  private receiverType(this: Mut<this>, callee: Ref<Extract<Expr, { kind: "member" }>>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && (this.ctx.lookup(object.name, undefined) === undefined) && (this.ctx.classes.has(object.name) || (this.ctx.definedClass(object.name) !== undefined) || this.ctx.enums.has(object.name)))) return undefined;
    if (object.kind === "ident") this.ctx.exprsState.objects.add(object);
    const type = this.linked(callee) ? this.unwrapped(object, callee.optional) : this.value(object);
    // A method called through a reference gets the pointer itself.
    const r = this.recOf(type);
    return this.ctx.tables.typing.unfold(r?.kind === "ref" ? r.to : this.plainOf(type));
  }

  // Whether a field read or method call is a link of an optional chain: written `?.`, or after
  // one in the same chain. Such a link reads what the Option holds, and gives an Option, empty
  // when the chain was.
  private linked(e: Ref<Extract<Expr, { kind: "member" }>>): boolean {
    return e.optional || this.chained(e.object);
  }

  private chained(given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.chainedNow(now) : this.chainedNow(given);
  }
  private chainedNow(e: Ref<Expr>): boolean {
    for (let x = e; x.kind === "member" || x.kind === "call"; x = x.kind === "member" ? x.object : x.callee) {
      if (x.kind === "member" && x.optional) return true;
    }
    return false;
  }

  // What a link of an optional chain gives: an Option of what it reads.
  /** @throws {CompileError} */
  private optional(this: Mut<this>, t: Type, at: Ref<Expr>): Type {
    if (this.ctx.tables.typing.holdsRef(t) && !this.isRefType(t)) throw unsupported("Options holding references", at);
    return this.ctx.tables.typing.unionType([t, "null"]);
  }

  // The object a link reads, as what its Option holds.
  /** @throws {CompileError} */
  private unwrapped(this: Mut<this>, object: Ref<Expr>, written: boolean): Type {
    const option = this.value(object);
    if (!this.ctx.tables.typing.isOption(option)) {
      if (written) throw new CompileError("E0108", `'?.' reads through an Option, and this is a '${this.ctx.tables.typing.show(option)}', which is never empty; use '.'`, object.start, object.end);
      return option;
    }
    const inner = this.held(option);
    this.ctx.coercions.set(cloneExpr(object), inner);
    return inner;
  }

  // A method of an interface, called while checking a generic body at its definition on a
  // value of a type parameter bounded by it, or of an interface a call returned. Each
  // instance resolves the call to its concrete type's method.
  /** @throws {CompileError} */
  private traitCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, receiver: ParamType | InterfaceType): { type: Type; what: string } {
    const r = this.ctx.tables.typing.rec(receiver);
    const trait = this.recOf(r.kind === "param" ? r.bound : receiver);
    const found = trait?.kind === "interface" ? trait.methods.find((m) => m.name === callee.name) : undefined;
    if ((found === undefined)) throw new CompileError("E0502", `property '${shownName(callee.name)}' does not exist on type '${r.name}'${didYouMean(callee.name, this.memberNames(receiver))}`, callee.start, callee.end);
    const stored = r.kind === "param" ? r.concrete : undefined;
    this.omittableCall(e, callee, found, r.name);
    // An instance whose type leaves an optional method out never calls it.
    const absent = found.omittable === true && this.lacks(stored, callee.name);
    if (absent) (this.ctx.instance.absent ??= new NodeSet()).add(e);
    // A generic method's call infers its types, then in an instance runs the concrete method's.
    if (found.generic) {
      const { type, throws } = this.familyCall(e, { generic: found.generic }, `'${callee.name}'`);
      if (!absent && typeof stored !== "string" && this.recOf(stored)?.kind === "class") return { type: this.concreteMethod(e, callee, stored as ClassType, type, throws), what: `'${callee.name}'` };
      if (!absent && throws) this.ctx.raise(e, throws, `'${callee.name}'`);
      return { type, what: `'${callee.name}'` };
    }
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "expected 0 type arguments", e.start, e.end);
    if (e.args.length !== found.params.length) {
      throw new CompileError("E0501", `expected ${found.params.length} argument${found.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const type = this.value(a);
      this.coerce(a, type, found.params[i]!, `argument of type '${this.ctx.tables.typing.show(type)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(found.params[i]!)}'`);
    });
    // A reference an interface's method returns borrows from its receiver, as may the future a
    // `Promise<T>` describes, which in the definition is checked as one borrowing it.
    const promised = this.ctx.tables.typing.promiseElement(found.returns);
    if (this.ctx.tables.typing.holdsRef(found.returns) || promised !== undefined) this.ctx.borrowsFrom.set(e, [callee.object, ...e.args.filter((a) => this.lends(a))]);
    if (!absent && typeof stored !== "string" && this.recOf(stored)?.kind === "class") return { type: this.concreteMethod(e, callee, stored as ClassType, found.returns, found.throws), what: `'${callee.name}'` };
    if (!absent && found.throws && promised === undefined) this.ctx.raise(e, found.throws, `'${callee.name}'`);
    return { type: promised !== undefined ? this.ctx.tables.typing.lentPromise(promised) : found.returns, what: `'${callee.name}'` };
  }

  // Whether an instance's concrete type for a type parameter leaves out a method: an object,
  // or a class without it.
  /** @throws {CompileError} */
  private lacks(this: Mut<this>, stored: Type | undefined, name: string): boolean {
    return stored !== undefined && (this.recOf(stored)?.kind !== "class" || (this.inheritedOf(stored as ClassType, "methods", name) === undefined));
  }

  // `h.m !== undefined`, `h.m === null` or `typeof h.m === "function"` on an interface's optional
  // method tests whether the value's type has it; read any other way, a method is called.
  /** @throws {CompileError} */
  private presence(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): boolean {
    if (e.op !== "===" && e.op !== "!==") return false;
    const test = typeofTest(e);
    const empty = (x: Expr) => isEmpty(x, this.ctx.locals as NodeMap<Expr, LocalId>);
    const named = test?.name.kind === "string" ? test.name.value : undefined;
    if (test && named !== "function" && named !== "undefined") return false;
    if (!test && !empty(e.left) && !empty(e.right)) return false;
    const member = this.ctx.tables.rewrites.current(test ? test.operand : empty(e.right) ? e.left : e.right);
    if (member.kind !== "member" || member.optional || this.chained(member.object)) return false;
    // A class's or an enum's name reads a static, not a method.
    if (member.object.kind === "ident" && (this.ctx.lookup(member.object.name, undefined) === undefined)) return false;
    if (member.object.kind === "ident") this.ctx.exprsState.objects.add(member.object);
    const object = this.value(member.object);
    const r = this.recOf(object);
    const t = this.ctx.tables.typing.unfold(r?.kind === "ref" ? r.to : this.plainOf(object));
    const held = this.recOf(t);
    const trait = this.recOf(held?.kind === "dyn" ? held.of : held?.kind === "param" ? held.bound : t);
    const m = trait?.kind === "interface" ? trait.methods.find((x) => x.name === member.name) : undefined;
    if (!m?.omittable) {
      this.ctx.exprsState.once.add(member.object);
      return false;
    }
    // A Dyn's table has no slot for a method no Dyn can call, so it can't say whether one is there.
    if (held?.kind === "dyn" && (m.generic || (this.recOf(m.returns)?.kind === "interface" && this.ctx.tables.typing.promiseElement(m.returns) === undefined))) {
      throw new CompileError("E0211", `'${m.name}' can't be called through a Dyn, ${m.generic ? "being generic" : "returning an interface type"}, so a Dyn can't tell whether it is there; take a type parameter bounded by '${(trait as { name: string }).name}' instead`, member.start, member.end);
    }
    const when = test ? (e.op === "===") === (named === "function") : e.op === "!==";
    this.ctx.tables.presenceTests.set(e, { object: member.object, name: member.name, when });
    if (held?.kind === "param" && this.lacks(held.concrete, member.name)) (this.ctx.instance.absent ??= new NodeSet()).add(e);
    return true;
  }

  // `h.m?.()` calls only an optional method, which a plain call may call only where a check
  // found it there.
  /** @throws {CompileError} */
  private omittableCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, m: Method, shown: string) {
    if (!e.optional) {
      if ((m.omittable !== undefined) && !this.ctx.present(callee.object, m.name)) throw new CompileError("E0108", `'${m.name}' may be missing, since '${shown}' declares it optional; call it as '${this.placeText(callee)}?.()', or check '${this.placeText(callee)} !== undefined' first`, callee.start, callee.end);
      return;
    }
    if ((m.omittable === undefined)) throw new CompileError("E0505", `'${m.name}' is always there in '${shown}', so it is called without '?.'`, e.start, e.end);
    if (this.linked(callee)) throw unsupported("optional calls in an optional chain", e);
    if ((m.owned === true)) throw unsupported("optional calls of methods taking their object over", e);
    if (this.ctx.tables.typing.promiseElement(m.returns) !== undefined) throw unsupported("optional calls of methods giving a Promise", e);
    this.ctx.tables.optionalCalls.add(e);
  }

  // In an instance, a call through a type parameter runs its concrete class's method. An
  // interface it returns is, as for any call, the one concrete type the method returns.
  /** @throws {CompileError} */
  private concreteMethod(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, c: ClassType, returns: Type, declaredThrows?: Type): Type {
    const target = this.inheritedOf(c, "methods", callee.name)!;
    if ((target.self!.owned === true)) this.takesOver(callee.object, callee.name);
    else if (target.self!.mutable) this.mutates(callee.object, callee.name);
    const instance = this.ctx.instantiate(target.bodyId, e.typeArgs, e.args, e.args.map((a) => this.ctx.coercions.get(a) ?? this.ctx.types.get(a)!), e);
    this.ctx.calls.set(e, instance);
    if (declaredThrows && !target.async && this.ctx.tables.typing.promiseElement(returns) === undefined) this.ctx.raise(e, declaredThrows, `'${callee.name}'`);
    const error = this.ctx.errorOf(instance);
    if (error && error !== declaredThrows && !target.async) this.ctx.raise(e, error, `'${callee.name}'`);
    const r = this.recOf(returns);
    if (r?.kind !== "interface") return returns;
    return this.ctx.tables.typing.wrapped(r.name, returns as InterfaceType, this.ctx.tables.typing.lower(this.ctx.returnOf(instance, e)));
  }

  // An owning method takes its object over, which can't happen through a borrow.
  /** @throws {CompileError} */
  private takesOver(object: Ref<Expr>, name: string) {
    const type = this.ctx.types.get(object);
    if (typeof type !== "string" && type !== undefined && this.ctx.tables.typing.rec(type).kind === "ref") {
      throw new CompileError("E0202", `can't call '${name}' through the reference '${this.placeText(object)}': it takes its object over, and a reference only borrows it; call it on the value itself`, object.start, object.end);
    }
    if ((object.kind === "this" || object.kind === "super") && (this.ctx.self?.owned !== true)) {
      throw new CompileError("E0202", `can't call '${name}' on 'this' here: it takes its object over, and this method only borrows 'this'; declare 'this: Own<this>' to give it away`, object.start, object.end);
    }
  }

  // A mutating method's receiver must be a place that could change, or a temporary.
  /** @throws {CompileError} */
  private mutates(this: Mut<this>, object: Ref<Expr>, name: string) {
    const type = this.ctx.types.get(object);
    if (typeof type !== "string" && type !== undefined && this.ctx.tables.typing.rec(type).kind === "ref" && !this.ctx.tables.typing.rec(type as RefType).mutable) {
      throw new CompileError("E0206", `cannot call '${name}' on '${this.placeText(object)}' because it is a shared reference ('Ref'), which only reads`, object.start, object.end);
    }
    if (object.kind === "conditional") {
      throw new CompileError("E0212", `can't call '${name}' on a '?:', which would change a copy; call it in each branch`, object.start, object.end);
    }
    // `x!` gives a copy of what x holds, which a change wouldn't reach.
    const through = this.copied(object);
    if ((through !== undefined)) throw new CompileError("E0212", `can't call '${name}' through '${through}', which would change a copy; check '!== null' first, or call it with '?.'`, object.start, object.end);
    if (this.readCopy(object)) throw new CompileError("E0211", `'${name}' changes its object, and this one is read through a Dyn, which gives a copy; change it through a method`, object.start, object.end);
    intoMember(this.ctx.tables.typing, object, this.ctx.types, `call '${name}' on`);
    if (this.place(object)) this.changeable(object, `call '${name}' on`);
  }

  // The `!` or `??` a place is read through, if any, which gives a copy of what the place holds,
  // so a change through it would be lost. A temporary has no place to change.
  private copied(this: Mut<this>, given: Ref<Expr>, through?: string): string | undefined {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.copiedNow(now, through) : this.copiedNow(given, through);
  }
  private copiedNow(this: Mut<this>, e: Ref<Expr>, through?: string): string | undefined {
    switch (e.kind) {
      // A getter's result is a temporary.
      case "member":
        return this.ctx.calls.has(e) ? undefined : this.copied(e.object, through);
      case "nonNull":
        return this.copied(e.expr, redundantBang(e) ? through : "!");
      case "as": {
        const [from, to] = [this.ctx.coercions.get(e.expr) ?? this.ctx.types.get(e.expr), this.ctx.types.get(e)];
        const narrows = from !== undefined && to !== undefined && this.recOf(from)?.kind === "union" && !this.ctx.tables.typing.fits(from, to);
        return this.copied(e.expr, narrows ? "as" : through);
      }
      case "binary":
        return e.op === "??" ? (this.copied(e.left, "??") ?? this.copied(e.right, "??")) : undefined;
      case "conditional":
        return (this.ctx.types.has(e.then) ? this.copied(e.then, through) : undefined) ?? (this.ctx.types.has(e.else) ? this.copied(e.else, through) : undefined);
      case "this":
        return through;
      case "ident":
        return through && this.ctx.lookup(e.name, undefined) ? through : undefined;
      default:
        return undefined;
    }
  }

  // A class's static property, `C.x`: a `static readonly` field, the const `C.x`, or a static
  // accessor, the static methods `get x` and `set x`. Reads and writes of one are rewritten in
  // place into a read of that const or a call of those methods, forms the rest of the compiler knows.
  
  // The nearest class declaring `x` decides what it is, as in TypeScript: a class declaring only
  // a setter hides its base's getter.
  private staticProperty(this: Mut<this>, e: Ref<Expr>): Static | undefined {
    if (e.kind !== "member" || e.optional || e.object.kind !== "ident" || (this.ctx.lookup(e.object.name, undefined) !== undefined)) return undefined;
    const c = this.ctx.tables.arenas.classOf(this.ctx.classes.get(e.object.name));
    return c && this.staticOf(c, e.name);
  }

  private staticOf(c: ClassInfo, name: string): Static | undefined {
    for (let b: ClassInfo | undefined = c; (b !== undefined); b = this.ctx.tables.arenas.classOf(b.base)) {
      const field = b.staticFields.get(name);
      if (field) return { field, declaring: b };
      const getter = this.ctx.tables.arenas.bodyOf(b.statics.get(`get ${name}`));
      const setter = this.ctx.tables.arenas.bodyOf(b.statics.get(`set ${name}`));
      if (getter || setter) return { getter, setter, declaring: b };
    }
    return undefined;
  }

  // The class, or the base it extends, holding the Map or Set its `extends` names.
  /** @throws {CompileError} */
  private embeddedOf(this: Mut<this>, t: Type | undefined): ClassInfo | undefined {
    if (t === undefined || this.recOf(t)?.kind !== "class") return undefined;
    for (let b: ClassInfo | undefined = this.cls(t as ClassType); b; b = this.ctx.tables.arenas.classOf(b.base)) if (b.embedded) return b;
    return undefined;
  }

  // Whether `name` on a class reaches the Map or Set it embeds: neither it nor its bases declare it.
  // Only the collection's own members are: `clone`, `equals` and the like stay the class's.
  /** @throws {CompileError} */
  private delegated(this: Mut<this>, t: Type | undefined, name: string): boolean {
    const embedding = this.embeddedOf(t);
    if ((embedding === undefined) || !collectionMember(embedding, name)) return false;
    const c = this.cls(t as ClassType);
    return (this.ctx.tables.typing.field(t as ClassType, name) === undefined) && !(["methods", "getters", "setters"] as const).some((table) => inherited(this.ctx.tables.arenas, c, table, name));
  }

  // Whether `super.name` reaches the embedded Map or Set: no base between declares it.
  /** @throws {CompileError} */
  private superDelegated(this: Mut<this>, name: string): boolean {
    const self = this.ctx.self?.type;
    const embedding = self && this.embeddedOf(self);
    if (!embedding || !collectionMember(embedding, name)) return false;
    const base = this.ctx.tables.arenas.classOf(this.cls(self).base);
    return !base || !(this.ctx.tables.typing.field(base.type, name) || (["methods", "getters", "setters"] as const).some((table) => inherited(this.ctx.tables.arenas, base, table, name)));
  }

  // `x.name` as `x`'s embedded collection's `name`; `super.name` as `this`'s.
  private throughEmbedded(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): Extract<Expr, { kind: "member" }> {
    const at = { start: e.object.start, end: e.object.end };
    const object: Expr = e.object.kind === "super" ? { id: nextId(this.ctx.tables.ids), kind: "this", ...at } : e.object;
    return { ...e, id: nextId(this.ctx.tables.ids), object: { id: nextId(this.ctx.tables.ids), kind: "member", object, name: EMBEDDED, optional: false, ...at } };
  }

  // Replaces `e` with `to`, keeping its own span and id.
  private become(this: Mut<this>, e: Ref<Expr>, to: Expr): Expr {
    return this.ctx.tables.rewrites.replaceAt(idOfExpr(e), withIdExpr(to, 0, 0, [e.start, e.end]));
  }

  // Checks a call made in place of another expression.
  /** @throws {CompileError} */
  private callMade(this: Mut<this>, made: Ref<Expr>): { type: Type; what: string } {
    if (made.kind === "call") return this.call(made);
    return { type: this.typeOf(made), what: "this expression" };
  }

  // The dictionary an Option of one holds.
  private optionalDict(t: Type | undefined): MapType | undefined {
    const r = this.recOf(t);
    if (r?.kind !== "union" || r.members.length !== 2 || !r.members.includes("null")) return undefined;
    return this.dictOf(r.members.find((m) => m !== "null")!);
  }

  // The dictionary a value is, or a reference to one is.
  private dictOf(t: Type): MapType | undefined {
    const r = this.recOf(t);
    const held = r?.kind === "ref" ? r.to : t;
    return this.recOf(held)?.kind === "map" && (this.ctx.tables.typing.rec(held as MapType).dict !== undefined) ? held as MapType : undefined;
  }

  // `e`, a dictionary's read, write, delete or key test, become the call of its Map method.
  private dictCall(this: Mut<this>, e: Ref<Expr>, object: Ref<Expr>, name: string, args: Expr[]): Expr {
    const method = this.dictMethod(object, name, args, { start: e.start, end: e.end });
    const call = this.become(e, method);
    this.ctx.tables.dictCalls.add(cloneExpr(call));
    return call;
  }

  private dictMethod(this: Mut<this>, object: Ref<Expr>, name: string, args: Expr[], at: Ref<Span>): Call {
    const id = nextId(this.ctx.tables.ids);
    const call: Call = { id, kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: cloneExpr(object), name, optional: false, start: at.start, end: at.end }, args, typeArgs: [], optional: false, start: at.start, end: at.end };
    this.ctx.tables.dictCalls.add(cloneExpr(call));
    return call;
  }

  // `o[k]` or `o.k` on a dictionary, being written or deleted: its object, checked, and its key.
  /** @throws {CompileError} */
  private dictEntry(this: Mut<this>, written: Ref<Expr>): { place: Expr; object: Expr; key: Expr } | undefined {
    const place = this.bare(written);
    if ((place.kind !== "index" && place.kind !== "member") || place.optional) return undefined;
    // A name that isn't a variable may be a class or an enum, which the write's own check reads.
    if (place.object.kind === "ident" && (this.ctx.lookup(place.object.name, undefined) === undefined)) return undefined;
    if (place.object.kind === "ident") this.ctx.exprsState.objects.add(place.object);
    const t = this.value(place.object);
    this.ctx.exprsState.once.add(place.object);
    if (!this.dictOf(t)) return undefined;
    const key: Expr = place.kind === "index" ? this.dictKey(place.index) : { id: nextId(this.ctx.tables.ids), kind: "string", value: place.name, start: place.start, end: place.end };
    return { place, object: place.object, key };
  }

  // A dictionary's key, checked to be a string where it is written.
  /** @throws {CompileError} */
  private dictKey(this: Mut<this>, key: Ref<Expr>): Expr {
    const t = this.value(key);
    this.coerce(key, t, "string", `a dictionary's keys are strings, not '${this.ctx.tables.typing.show(t)}'`);
    this.ctx.exprsState.once.add(cloneExpr(key));
    return key;
  }

  // `source[Symbol.iterator]()`, when `held` is a class with that method: what iterating it runs.
  /** @throws {CompileError} */
  iteratorCall(this: Mut<this>, source: Ref<Expr>, held: Type): Expr | undefined {
    const t = this.ctx.tables.typing.lower(held);
    const r = this.recOf(t);
    // A parameter of an interface declaring the method has it in every instance.
    const bound = r?.kind === "param" && this.ctx.tables.typing.iterableElement(t) === undefined ? this.recOf(r.bound) : undefined;
    const has = r?.kind === "class" ? this.inheritedOf(t as ClassType, "methods", ITERATOR) !== undefined : bound?.kind === "interface" && bound.methods.some((m) => m.name === ITERATOR);
    if (!has) return undefined;
    const at = { start: source.start, end: source.end };
    return { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: source, name: ITERATOR, optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
  }

  // The Map or Set a class extending one embeds, which iterating the class iterates unless the
  // class declares its own `[Symbol.iterator]`.
  /** @throws {CompileError} */
  embeddedIterated(this: Mut<this>, source: Ref<Expr>, held: Type): Expr | undefined {
    const t = this.ctx.tables.typing.lower(held);
    if ((this.embeddedOf(t) === undefined) || this.inheritedOf(t as ClassType, "methods", ITERATOR)) return undefined;
    return { id: nextId(this.ctx.tables.ids), kind: "member", object: source, name: EMBEDDED, optional: false, start: source.start, end: source.end };
  }

  // A dictionary isn't iterable, as a plain object isn't in JavaScript.
  notIterable(at: Ref<Span>): CompileError {
    return new CompileError("E0119", "a dictionary can't be looped over or spread, as a plain object can't; use 'Object.keys', 'Object.values' or 'Object.entries'", at.start, at.end);
  }

  // Why a dictionary's entry can't be updated in place.
  private dictWrite(place: Ref<Expr>): CompileError {
    return new CompileError("E0801", `a dictionary's entry is read as an Option, so it isn't updated in place; read it, then write it back, as in '${this.placeText(place)} = (${this.placeText(place)} ?? 0) + 1'`, place.start, place.end);
  }

  // `o[k]` on a dictionary reads the entry under k as an Option, as the Map's `get` does.
  /** @throws {CompileError} */
  private undict(this: Mut<this>, given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.undictNow(now) : this.undictNow(given);
  }
  /** @throws {CompileError} */
  private undictNow(this: Mut<this>, e: Ref<Expr>): boolean {
    if (e.kind !== "index") return false;
    const through = this.value(e.object);
    this.ctx.exprsState.once.add(e.object);
    if ((this.dictOf(through) === undefined)) return false;
    if (e.optional) throw unsupported("optional index expressions", e);
    if (this.ctx.exprsState.writing === e.id) throw this.dictWrite(e);
    this.dictCall(e, e.object, "get", [this.dictKey(e.index)]);
    return true;
  }

  /** @throws {CompileError} */
  private staticRead(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, found: Static): Expr {
    const at = { start: e.start, end: e.end };
    if ((found.field !== undefined)) {
      this.visible(found.field.access, found.declaring!.type, e.name, { start: e.start, end: e.end });
      return { id: nextId(this.ctx.tables.ids), kind: "ident", name: `${this.ctx.tables.typing.rec(found.declaring!.type).name}.${e.name}`, ...at };
    }
    if (!found.getter) {
      const base = this.ctx.tables.arenas.classOf(found.declaring.base);
      const hidden = base && this.staticOf(base, e.name)?.getter;
      throw new CompileError("E0208", hidden ? `'${this.ctx.tables.typing.rec(found.declaring.type).name}' declares only a setter for '${e.name}', which hides the getter of its base; declare a getter in '${this.ctx.tables.typing.rec(found.declaring.type).name}' too` : `property '${e.name}' has a setter but no getter`, e.start, e.end);
    }
    this.visible(found.getter.access, found.declaring.type, e.name, e);
    return this.staticCall(e, "get", []);
  }

  private staticCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, kind: "get" | "set", args: Ref<Expr[]>): Expr {
    const at = { start: e.start, end: e.end };
    return { id: nextId(this.ctx.tables.ids), kind: "call", callee: { id: nextId(this.ctx.tables.ids), kind: "member", object: e.object, name: `${kind} ${e.name}`, optional: false, ...at }, typeArgs: [], args, optional: false, ...at };
  }

  // `C.x = v`, `C.x += v` and `C.x++` on a static setter call it with the value to store. Whether
  // the write was rewritten.
  /** @throws {CompileError} */
  private staticWrite(this: Mut<this>, e: Ref<Extract<Expr, { kind: "assign" | "update" }>>): boolean {
    const target = e.kind === "assign" ? e.target : e.operand;
    const found = this.staticProperty(target);
    if ((found === undefined)) return false;
    const member = target as Extract<Expr, { kind: "member" }>;
    if ((found.setter === undefined)) throw new CompileError("E0208", `cannot assign to '${member.name}' because it is a read-only property`, member.start, member.end);
    this.visible(found.setter.access, found.declaring.type, member.name, member);
    const op = e.kind === "update" ? (e.op === "++" ? "+" : "-") : ASSIGNMENTS[e.op];
    if (!op) throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
    const at = { start: e.start, end: e.end };
    const right: Expr = e.kind === "update" ? { id: nextId(this.ctx.tables.ids), kind: "int", value: 1n, ...at } : e.value;
    const given: Expr = op === "=" ? right : { id: nextId(this.ctx.tables.ids), kind: "binary", op, left: this.staticRead(member, found), right, ...at };
    this.become(e, this.staticCall(member, "set", [given]));
    return true;
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  /** @throws {CompileError} */
  private method(this: Mut<this>, callee: Ref<Extract<Expr, { kind: "member" }>>, receiver: Type | undefined): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && (this.ctx.lookup(object.name, undefined) === undefined) ? (this.ctx.tables.arenas.classOf(this.ctx.classes.get(object.name) ?? this.ctx.definedClass(object.name))) : undefined;
    if ((named !== undefined)) {
      const found = inherited(this.ctx.tables.arenas, named, "statics", name);
      const property = (found !== undefined) ? undefined : this.staticOf(named, name);
      if (property) throw new CompileError("E0706", `'${name}' is a static ${property.field ? "field" : "accessor"} of '${this.ctx.tables.typing.rec(property.declaring.type).name}', not a method; read it as '${this.ctx.tables.typing.rec(named.type).name}.${name}'`, callee.start, callee.end);
      if (!found) throw new CompileError("E0502", `property '${name}' does not exist on type 'typeof ${this.ctx.tables.typing.rec(named.type).name}'${didYouMean(name, this.staticNames(named))}`, callee.start, callee.end);
      this.visible(found.access, found.declared ?? found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return this.superMethod(callee);
    const type = receiver!;
    const tr = this.recOf(type);
    const found = tr?.kind === "class" ? this.inheritedOf(type as ClassType, "methods", name) : undefined;
    if (!found && tr?.kind === "class" && tr.name === "RequestCookies" && this.ctx.tables.arenas.bodyOf(this.cls(type as ClassType).constructor).start >= STD_BASE && (name === "set" || name === "delete")) {
      throw new CompileError("E0502", `a request's cookies can't be changed, so 'RequestCookies' has no method '${name}'; ${name} the cookie on the response instead, as 'res.cookies.${name}(...)'`, callee.start, callee.end);
    }
    if (tr?.kind === "unknown") throw this.unnarrowed(callee);
    if (!found) throw new CompileError("E0502", `'${this.ctx.tables.typing.show(type)}' has no method '${name}'${didYouMean(name, this.memberNames(type))}`, callee.start, callee.end);
    this.visible(found.access, found.declared ?? found.owner!, name, callee);
    if (found.self!.owned) this.takesOver(object, name);
    else if (found.self!.mutable) this.mutates(object, name);
    return found;
  }

  // `super.m()` runs the base's `m` on the embedded base.
  /** @throws {CompileError} */
  private superMethod(this: Mut<this>, callee: Ref<Extract<Expr, { kind: "member" }>>): Body {
    // In a copy of a base's member, `super` is the base of the class it was written in.
    const base = this.recOf((this.ctx.owner && this.ctx.self && this.ctx.tables.typing.derives(this.ctx.self.type, this.ctx.owner) ? this.ctx.owner : this.ctx.self?.type))?.base;
    if (!base) throw new CompileError("E0708", "'super' can only be used in a class that extends another", callee.start, callee.end);
    if (!this.ctx.thisReady(callee.object)) throw new CompileError("E0703", "'super' can't be used until every field is assigned", callee.object.start, callee.object.end);
    let found = this.inheritedOf(base, "methods", callee.name);
    if (!found) throw new CompileError("E0502", `'${this.ctx.tables.typing.rec(base).name}' has no method '${callee.name}'${didYouMean(callee.name, this.memberNames(base))}`, callee.start, callee.end);
    if (found.abstract) throw new CompileError("E0701", `'${callee.name}' is abstract in '${this.ctx.tables.typing.rec(found.owner!).name}', so 'super.${callee.name}()' has nothing to run`, callee.start, callee.end);
    // A template runs as this class's own copy of it, on this class's `this`.
    const original = this.ctx.tables.arenas.bodyOf(found.copyOf) ?? found;
    const copied = (original.template === true || selfTyped(original)) && !this.ctx.tables.typing.rec(this.ctx.self!.type).abstract;
    if (copied) found = this.ctx.tables.arenas.bodyOf(copyFor(this.ctx.tables, this.cls(this.ctx.self!.type).classId, original.bodyId));
    this.visible(found.access, found.declared ?? found.owner!, callee.name, callee);
    if (found.self!.mutable && !this.ctx.self!.mutable) {
      throw new CompileError("E0206", `cannot call '${callee.name}' on 'super' because 'this' is read-only here; declare 'this: Mut<this>'`, callee.start, callee.end);
    }
    // It may change any of this object's fields, as a method called on `this` may.
    if (found.self!.mutable) this.changesThis("", `call '${callee.name}' on`, callee.object);
    this.ctx.types.set(callee.object, copied ? this.ctx.self!.type : base);
    if (found.self!.owned) this.takesOver(callee.object, callee.name);
    return found;
  }

  // Inside an abstract class's code, its copies included, `this.name` naming one of its abstract
  // members is typed by the declaration, which each implementation's result is converted to.
  /** @throws {CompileError} */
  private abstractDeclaration(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, table: "methods" | "getters"): Body | undefined {
    if (e.object.kind !== "this" || (this.recOf(this.ctx.owner)?.abstract === undefined)) return undefined;
    const declared = this.inheritedOf(this.ctx.owner!, table, e.name);
    return (declared?.abstract !== undefined) ? declared : undefined;
  }

  // TypeScript's access rules: a private member is reachable only from inside its class, and
  // a protected one also from the classes that embed it.
  /** @throws {CompileError} */
  private visible(this: Mut<this>, access: Access | undefined, declaring: ClassType, name: string, at: Ref<Span>) {
    // Only delegation reads the embedded collection, from wherever the class is used.
    if (name === EMBEDDED || this.accessible(access, declaring, name)) return;
    const message = name.startsWith("#")
      ? `property '${shownName(name)}' is not accessible outside class '${this.ctx.tables.typing.rec(declaring).name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${this.ctx.tables.typing.rec(declaring).name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError("E0709", message, at.start, at.end);
  }

  // Access is by declaration, as in TypeScript, so any two instances of one generic class share it.
  private sameClass(a: ClassType, b: ClassType): boolean {
    const g = this.ctx.tables.typing.rec(a).generic;
    return a === b || (g !== undefined && g.name === this.ctx.tables.typing.rec(b).generic?.name);
  }

  /** @throws {CompileError} */
  private accessible(this: Mut<this>, access: Access | undefined, declaring: ClassType, name: string): boolean {
    if ((access === undefined) || access === "public" || (this.ctx.owner && this.sameClass(this.ctx.owner, declaring))) return true;
    if (access === "protected" && this.ctx.owner) for (let b: ClassType | undefined = this.ctx.tables.typing.rec(this.ctx.owner).base; b; b = this.ctx.tables.typing.rec(b).base) if (this.sameClass(b, declaring)) return true;
    // A base reaches a subclass's implementation of its abstract member.
    return access === "protected" && this.ctx.owner !== undefined && this.ctx.tables.typing.derives(declaring, this.ctx.owner) && abstractIn(this.ctx.tables.arenas, this.cls(this.ctx.owner), name);
  }

  // The members of a type this body can reach, for suggesting one: an object's fields; a
  // class's fields, methods and accessors with its bases', those private or protected only where
  // accessible; an interface's or a Dyn's fields and methods.
  /** @throws {CompileError} */
  private memberNames(this: Mut<this>, t: Type | undefined): string[] {
    if (t === undefined || typeof t === "string") return [];
    const r = this.ctx.tables.typing.rec(t);
    if (r.kind === "ref") return this.memberNames(r.to);
    if (r.kind === "param") return this.memberNames(r.bound);
    if (r.kind === "dyn") return this.memberNames(r.of);
    if (r.kind === "interface") return [...r.fields, ...r.methods].map((m) => m.name);
    if (r.kind === "object") return r.fields.map((f) => f.name);
    if (r.kind !== "class") return [];
    const names: string[] = [];
    for (let c: ClassInfo | undefined = this.cls(t as ClassType); c; c = this.ctx.tables.arenas.classOf(c.base)) {
      const declaring = c.type;
      names.push(...this.ctx.tables.typing.rec(declaring).fields.filter((f) => this.accessible(f.access, declaring, f.name)).map((f) => shownName(f.name)));
      for (const table of [c.methods, c.getters, c.setters]) for (const [name, body] of table) if (this.accessible(this.ctx.tables.arenas.bodyOf(body).access, declaring, name)) names.push(shownName(name));
    }
    return names;
  }

  // A class's static members, with its bases', for suggesting one.
  /** @throws {CompileError} */
  private staticNames(this: Mut<this>, c: ClassInfo): string[] {
    const names: string[] = [];
    for (let b: ClassInfo | undefined = c; (b !== undefined); b = this.ctx.tables.arenas.classOf(b.base)) {
      for (const [name, body] of b.statics) if (this.accessible(this.ctx.tables.arenas.bodyOf(body).access, b.type, name)) names.push(shownName(name.replace(/^[gs]et /, "")));
      for (const [name, f] of b.staticFields) if (this.accessible(f.access, b.type, name)) names.push(shownName(name));
    }
    return names;
  }

  // The class whose own fields include `name`: `t` itself or a base it embeds.
  private declaring(t: ClassType, name: string): ClassType {
    const { fields, base } = this.ctx.tables.typing.rec(t);
    return fields.some((f) => f.name === name) || (base === undefined) ? t : this.declaring(base, name);
  }

  /** @throws {CompileError} */
  private args(this: Mut<this>, list: Ref<Expr[]>, argTypes: Ref<Type[]>, target: InstanceId, at: Ref<Span>): void {
    // A package's function takes a callback or a Promise as its signature made it for JS, a
    // stored one JS keeps.
    const js = bodyOf(this.ctx.tables.arenas, this.inst(target)).js !== undefined && this.inst(target).concrete;
    if (js) this.ctx.returnOf(target, at);
    const signature = js ? this.inst(target).signature : undefined;
    const params = signature !== undefined && signature.length > 0 ? signature.slice() : this.ctx.paramTypes(target);
    this.arity(list.length, bodyOf(this.ctx.tables.arenas, this.inst(target)).params, at);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const type = argTypes[i]!;
      const expected = params[i]!;
      if (this.isRefType(expected) && this.ctx.tables.typing.rec(expected).mutable) this.readOnlySubarray(a);
      const declared = cloneParam(bodyOf(this.ctx.tables.arenas, this.inst(target)).params[i]!);
      const shown = this.defaultedArg(a, type, declared) ?? expected;
      this.coerce(a, type, expected, `argument of type '${this.ctx.tables.typing.show(type)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(shown)}'`);
    }
  }

  // A parameter with a default takes a value of its declared type, which this gives: leaving the
  // argument out gives the default, so a null or an Option where none is declared is refused.
  /** @throws {CompileError} */
  private defaultedArg(a: Ref<Expr>, type: Type, p: Ref<Param>): Type | undefined {
    const declared = this.ctx.tables.declaredTypes.get(p);
    if ((declared === undefined) || holdsNull(this.ctx.tables.typing, declared)) return declared;
    if (holdsNull(this.ctx.tables.typing, type)) throw new CompileError("E0108", "this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default", a.start, a.end);
    return declared;
  }

  /** @throws {CompileError} */
  value(this: Mut<this>, given: Ref<Expr>): Type {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.valueKeyed(now) : this.valueKeyed(given);
  }
  /** @throws {CompileError} */
  private valueKeyed(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind === "object" && this.computesKeys(e)) {
      const keyed = this.keyed(e);
      return this.valueNow(keyed);
    }
    return this.valueNow(e);
  }
  /** @throws {CompileError} */
  private valueNow(this: Mut<this>, e: Ref<Expr>): Type {
    if (this.ctx.exprsState.once.delete(e)) return this.ctx.types.get(e)!;
    const type = this.typeOf(e);
    // An abstract class's code sees `this` as the abstract class, which exists only embedded in
    // a subclass, so a value of that type, such as `this.clone()`, can't be made there.
    if ((this.recOf(this.ctx.owner)?.abstract !== undefined) && type === this.ctx.owner && e.kind !== "this" && e.kind !== "super") {
      throw new CompileError("E0701", `this would make a value of the abstract class '${this.ctx.tables.typing.rec(this.ctx.owner).name}', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there`, e.start, e.end);
    }
    this.ctx.types.set(cloneExpr(e), type);
    return type;
  }

  // An object literal with computed keys, as the same literal with each key's name written.
  /** @throws {CompileError} */
  private keyed(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>): Expr {
    let props: ObjectProp[] = [];
    for (const p of e.props) {
      if (p.kind === "shorthand" || p.kind === "spread" || typeof p.key === "string") props.push(cloneObjectProp(p));
      else {
        const key = this.knownKey(p.key);
        props.push(this.ctx.tables.rewrites.replaceObjectProp(p, withKey(p, key)));
      }
    }
    return this.ctx.tables.rewrites.replace(e, { id: e.id, kind: "object", props, start: e.start, end: e.end });
  }

  // Whether an object literal has a computed key, which `keyed` makes known.
  private computesKeys(e: Ref<Extract<Expr, { kind: "object" }>>): boolean {
    for (const p of e.props) if (p.kind !== "shorthand" && p.kind !== "spread" && typeof p.key !== "string") return true;
    return false;
  }

  // The name a computed key gives: a literal's, or one a const, an `as const` value or an enum
  // member holds, as its literal type says.
  /** @throws {CompileError} */
  knownKey(this: Mut<this>, key: Ref<Expr>): string {
    return knownKey(key, (leaf) => {
      const t = this.value(leaf);
      const r = this.recOf(t);
      if (r?.kind === "literal") return String(r.value);
      // A const holding a number is typed by its number type, so its name comes from its value.
      const local = leaf.kind === "ident" ? this.ctx.lookup(leaf.name, undefined) : undefined;
      const number = local !== undefined ? this.ctx.tables.numberKeys.get(local) : undefined;
      if (number !== undefined) return number;
      if (leaf.kind === "ident" && !local && isNumeric(t) && this.ctx.tables.topKeys) return this.ctx.tables.topKeys(leaf);
      throw unknownKey(leaf, `this is a '${this.ctx.tables.typing.show(t)}'`);
    });
  }

  /** @throws {CompileError} */
  private typeOf(this: Mut<this>, e: Ref<Expr>): Type {
    switch (e.kind) {
      // A literal is an i64 unless where it is written gives it another number type.
      case "int":
        if (e.value > I64_MAX) this.ctx.exprsState.oversized.push({ id: e.id, kind: "int", value: e.value, start: e.start, end: e.end });
        return "i64";
      case "float":
        return "f64";
      case "bigint":
        return "bigint";
      // `x satisfies T` checks x against T and keeps x's own type, as TypeScript does.
      case "satisfies": {
        const wanted = this.ctx.resolveType(e.type);
        this.expect(e.expr, wanted);
        const t = this.value(e.expr);
        if (!this.ctx.tables.typing.fits(t, wanted)) throw new CompileError("E0101", `type '${this.ctx.tables.typing.show(t)}' does not satisfy the expected type '${this.ctx.tables.typing.show(wanted)}'`, e.expr.start, e.expr.end);
        return t;
      }
      case "regex":
        return this.regexLiteral(e.pattern, e.flags, e);
      case "destructure":
        throw new CompileError("E0004", "a destructuring assignment can only be a statement of its own, as in '[a, b] = [b, a];', since its value can't be used here", e.start, e.end);
      case "null":
        return "null";
      // A throw expression never gives a value, so it fits wherever it is.
      case "throw":
        this.ctx.thrown(e, e.value);
        return "never";
      // `x!` is what an Option holds; it panics when there is nothing. On a value that can't be
      // empty, as `xs[i]!` written for TypeScript's unchecked indexes, it is that value itself.
      case "nonNull": {
        const narrows = e.narrows;
        if ((narrows !== undefined)) return this.narrowedReturn(e.expr, narrows);
        const given = this.value(e.expr);
        if (this.redundant(e, given)) return given;
        return this.held(this.loaded(e.expr, given) as UnionType);
      }
      case "bool":
        return "boolean";
      case "ident": {
        // A nested function used as a value is a closure made here, from what it uses as it is
        // here, which it borrows from here on.
        const nested = this.nestedFunction(e.name);
        if (nested !== undefined) {
          this.nestedEnv(e, nested, e);
          return this.lc(nested).type;
        }
        const localId = this.ctx.lookup(e.name, e);
        const local = localId === undefined ? undefined : this.lc(localId);
        // A generic arrow a const holds, as a value, is the function it was lifted to.
        if (local !== undefined && local.generic !== undefined) return this.typeOf(this.ctx.tables.rewrites.replace(e, { ...e, name: this.ctx.tables.arenas.bodyOf(local.generic).name }));
        if (!local && e.name === "undefined") return "null";
        // A package's const, read from JS.
        const jsConst = local ? undefined : this.bodyNamed(e.name);
        if (jsConst?.js?.const) {
          const type = this.ctx.tables.typing.jsView(this.ctx.resolveType(jsConst.returnType!));
          if (this.ctx.tables.typing.jsConverts(type)) this.ctx.tables.jsExports.set(e, jsConst.js);
          else this.ctx.tables.jsUses.push(e);
          return type;
        }
        // A top-level const: its value, computed while compiling. An aggregate is read where it
        // lives, through a reference, as a const can't change.
        const constant = local ? undefined : this.bodyNamed(`const ${e.name}`);
        if (constant) {
          const instance = this.ctx.instanceOf(constant.bodyId, undefined);
          this.ctx.calls.set(e, instance);
          const type = this.ctx.returnOf(instance, e);
          return this.ctx.tables.typing.isCopy(type) || type === "string" ? type : this.ctx.tables.typing.refType(type, false);
        }
        // A declared function named as a value is a closure calling it.
        const declared = local ? undefined : this.bodyNamed(e.name);
        if (declared?.overloads) throw new CompileError("E0801", `'${e.name}' is overloaded, so it can't be used as a value yet; pass an arrow that calls it, as in '(x) => ${e.name}(x)'`, e.start, e.end);
        if (declared && !declared.comptime && genericIn(declared)) return this.genericValue(declared, e);
        if (declared !== undefined && declared.comptime === undefined) {
          const made = this.functionValue(e, declared.bodyId);
          return made !== undefined ? this.typeOf(made) : this.typeOf(e);
        }
        if (!local) {
          const message = this.ctx.byName.has(e.name) ? "functions can't be used as values yet"
            : this.ctx.classes.has(e.name) ? "classes can't be used as values yet; construct one with 'new'"
            : this.ctx.enums.has(e.name) ? "an enum can't be used as a value; name one of its members"
            : `cannot find name '${e.name}'${didYouMean(e.name, this.ctx.names(e.start))}`;
          throw new CompileError("E0401", message, e.start, e.end);
        }
        if (!this.ctx.reachable(local.localId)) {
          throw new CompileError("E0403", `'${e.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, e.start, e.end);
        }
        this.ctx.locals.set(e, local.localId);
        const lr = this.recOf(local.type);
        const held = lr?.kind === "ref" ? lr.to : local.type;
        if (this.ctx.sharing && local.param && !this.ctx.exprsState.objects.has(e) && this.ctx.tables.typing.interiorMutable(held)) {
          throw new CompileError("E0304", this.ctx.counting ? `inside an Rc's 'update', use '${e.name}' only through its fields: its interior-mutable parts are borrowed where they live, and another name for it could replace them` : `inside a shared value's 'update', use '${e.name}' only through its fields: other tasks borrow its interior-mutable parts without the lock, and another name for it could replace them`, e.start, e.end);
        }
        const read = this.ctx.exprsState.asDeclared.has(e) ? undefined : this.ctx.narrowed(local.localId);
        if (read !== undefined) this.ctx.narrowRead(local.localId, e);
        // A JsValue narrowed by `typeof` to one kind of value is read out of JS, as a new value
        // each time; one narrowed to several stays a JsValue.
        const js = this.ctx.tables.typing.jsRead(local.type, read);
        if (js === "one") this.ctx.copiesOut.add(e);
        if (js === "several") return this.stillJs(local.type);
        return read ?? local.type;
      }
      // Its literal type, which a string takes it as.
      case "string":
        return this.ctx.tables.typing.literalType(e.value);
      // A string's one-unit string at a `usize` index.
      case "index": {
        if (e.object.kind === "ident") this.ctx.exprsState.objects.add(cloneExpr(e.object));
        // An enum's reverse mapping, `Color[0]`, has no meaning yet.
        if (e.object.kind === "ident" && (this.ctx.lookup(e.object.name, undefined) === undefined) && this.ctx.enums.has(e.object.name)) throw unsupported(EXPRESSION_FORMS.index, e);
        if (this.untuple(e) || this.undict(e) || this.ctx.tables.rewrites.current(e) !== e) return this.typeOf(this.ctx.tables.rewrites.current(e));
        const through = this.value(e.object);
        const object = this.isRefType(through) ? this.ctx.tables.typing.rec(through).to : through;
        // A fixed array's element, checked against its known length when the program runs.
        if (this.isFixed(object)) {
          if (e.optional) throw unsupported("optional index expressions", e);
          const index = this.value(e.index);
          this.coerce(e.index, index, "usize", `a fixed array's index is a 'usize', not '${this.ctx.tables.typing.show(index)}'`);
          return this.ctx.tables.typing.unfolded(this.ctx.tables.typing.rec(object).element);
        }
        const array = this.isArray(object);
        if (this.ctx.tables.typing.isPlainJs(object)) throw new CompileError("E1005", `a 'JsValue' could be anything, as an 'unknown' could, so its elements are read with 'at': '${this.placeText(e.object)}.at(i)'`, e.start, e.end);
        if (!stringLike(this.ctx.tables.typing, object) && !array) throw unsupported(EXPRESSION_FORMS.index, e);
        if (e.optional) throw unsupported("optional index expressions", e);
        if (array && object !== through) this.ctx.coercions.set(e.object, object);
        if (!array) this.text(e.object, object, false);
        const index = this.value(e.index);
        this.coerce(e.index, index, "usize", `${array ? "an array" : "a string"}'s index is a 'usize', not '${this.ctx.tables.typing.show(index)}'`);
        return array ? this.ctx.tables.typing.unfolded(this.ctx.tables.typing.rec(object).element) : "string";
      }
      // Text alone is a literal; with substitutions, a new string.
      case "template":
        if (e.exprs.length === 0) return this.ctx.tables.typing.literalType(e.quasis[0]!);
        for (const x of e.exprs) this.joined(x, this.operand(x), "a template");
        return "string";
      case "member": {
        if (e.object.kind === "super" && this.superDelegated(e.name)) return this.typeOf(this.become(e, this.throughEmbedded(e)));
        // A static property of a package's class.
        const jsClass = e.object.kind === "ident" && (this.ctx.lookup(e.object.name, undefined) === undefined) ? this.ctx.tables.jsClasses.get(e.object.name) : undefined;
        if (jsClass) {
          const m = this.jsStatic(jsClass, e.name, e);
          if (m.kind !== "property") throw new CompileError("E0503", `'${e.name}' is a method of '${jsClass.name}'; call it`, e.start, e.end);
          const declared = m.type ? this.ctx.resolveType(m.type) : this.ctx.tables.typing.blockType("JsValue");
          return this.crossing(this.ctx.tables.typing.jsView(m.optional ? this.ctx.tables.typing.unionType([declared, "null"]) : declared), `'${jsClass.name}.${e.name}' is a`, e);
        }
        if (e.object.kind === "ident" && isTypedName(e.object.name) && (this.ctx.lookup(e.object.name, undefined) === undefined) && !this.ctx.classes.has(e.object.name)) {
          if (e.name !== "BYTES_PER_ELEMENT" || e.object.name === "ArrayBuffer") throw new CompileError("E0502", `'${e.object.name}' has no static property '${shownName(e.name)}'`, e.start, e.end);
          return this.typeOf(this.become(e, { id: nextId(this.ctx.tables.ids), kind: "int", value: BigInt(typedSize(e.object.name)), start: e.start, end: e.end }));
        }
        if (this.isMath(e.object)) {
          if (MATH_CONSTANTS[e.name] === undefined) throw new CompileError("E0503", `'Math.${e.name}' is a function, or not in Fish yet; the constants are ${Object.keys(MATH_CONSTANTS).join(", ")}`, e.start, e.end);
          this.ctx.tables.maths.add(e);
          return "f64";
        }
        const property = this.staticProperty(e);
        if (property) {
          return this.typeOf(this.become(e, this.staticRead(e, property)));
        }
        // `Color.Red` names an enum member, whose value is known; the enum's name is no value.
        const named = e.object.kind === "ident" && (this.ctx.lookup(e.object.name, undefined) === undefined) ? this.ctx.enums.get(e.object.name) : undefined;
        if (named?.data) return this.variant(e, named, true);
        if (named && e.object.kind === "ident") {
          const found = this.ctx.enumMember(e.object.name, e.name);
          if (!found) throw new CompileError("E0502", `property '${e.name}' does not exist on enum '${e.object.name}'${didYouMean(e.name, this.ctx.enumMemberNames(e.object.name))}`, e.start, e.end);
          return found;
        }
        if (e.object.kind === "ident") this.ctx.exprsState.objects.add(cloneExpr(e.object));
        const through = this.linked(e) ? this.unwrapped(e.object, e.optional) : this.value(e.object);
        const tr = this.recOf(through);
        const object = this.ctx.tables.typing.unfold(tr?.kind === "ref" ? tr.to : through);
        if (object === "never") return "never";
        const or = this.recOf(object);
        // A field read through a reference loads what it points to; a getter gets the pointer.
        if (or?.kind === "unknown") throw this.unnarrowed(e);
        if (or?.kind === "shared") return this.sharedField(e, object as SharedType);
        if (or?.kind === "block") return this.blockProperty(e, object as BlockType);
        if (or?.kind === "dyn") return this.dynField(e, object as DynType);
        const rx = this.asRegex(object);
        if (rx) {
          if (object !== through) this.ctx.coercions.set(e.object, object);
          return this.regexMember(e, rx, this.ctx.tables.typing.lower(object) !== rx);
        }
        const load = () => object !== through && this.ctx.coercions.set(e.object, object);
        const shared = or?.kind === "union" ? unionField(this.ctx.tables.typing, object as UnionType, e.name, e) : undefined;
        if (shared) {
          load();
          return this.linked(e) ? this.optional(shared, e) : shared;
        }
        if (or?.kind === "class") this.cls(object as ClassType);
        // A dictionary's property is the entry under that key, as `o[k]` reads it.
        if (or?.kind === "map" && or.dict) {
          if (this.linked(e)) throw unsupported("optional chains reading a dictionary", e);
          if (this.ctx.exprsState.writing === e.id) throw this.dictWrite(e);
          this.ctx.exprsState.once.add(e.object);
          return this.typeOf(this.dictCall(e, e.object, "get", [{ id: nextId(this.ctx.tables.ids), kind: "string", value: e.name, start: e.start, end: e.end }]));
        }
        // A Map's or a Set's one property is its size, the number of entries it holds.
        if (or?.kind === "map") {
          if ((or.set ? SET_METHODS : MAP_METHODS).has(e.name)) throw new CompileError("E0503", `'${or.set ? "Set" : "Map"}' methods can only be called, like 'm.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "size") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(object)}'${didYouMean(e.name, ["size", ...(or.set ? SET_METHODS : MAP_METHODS)])}`, e.start, e.end);
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A tuple's one property is its length: the count of its elements, up to the last
        // optional one there.
        if (this.ctx.tables.typing.isTuple(object) && !this.ctx.tables.typing.rec(object as ObjectType).match && e.name === "length") {
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A fixed array's one property is its length, known while compiling.
        if (this.isFixed(object)) {
          if (e.name !== "length") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(object)}'${didYouMean(e.name, ["length"])}`, e.start, e.end);
          load();
          return "usize";
        }
        // An array's properties are its length and its capacity, the room before a push grows it;
        // capacity isn't JavaScript's.
        if (this.isArray(object)) {
          const typed = this.ctx.tables.typing.typedName(object);
          if (typed && TYPED_MEMBERS.has(e.name)) return this.typedMember(e, typed);
          if (ARRAY_METHODS.has(e.name)) throw new CompileError("E0503", `array methods can only be called, like 'a.${e.name}(...)'`, e.start, e.end);
          // A shared value's array is read as a copy, which has only the room it needs.
          if (e.name === "capacity" && this.ctx.copiesOut.has(e.object)) throw new CompileError("E0304", `a shared value's array is read as a copy, so read its capacity inside '${this.placeText(e.object).split(".")[0]}.update(...)'`, e.start, e.end);
          if (e.name !== "length" && e.name !== "capacity") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(object)}'${didYouMean(e.name, ["length", "capacity", ...ARRAY_METHODS])}`, e.start, e.end);
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A string's one property is its length in UTF-16 code units, a type parameter's bounded
        // by strings included.
        const plain = this.plainOf(object);
        if (stringLike(this.ctx.tables.typing, plain)) {
          if (stringMethods(this.ctx.tables.typing)[e.name]) throw new CompileError("E0503", `string methods can only be called, like 's.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "length") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type 'string'${didYouMean(e.name, ["length", ...Object.keys(stringMethods(this.ctx.tables.typing))])}`, e.start, e.end);
          this.text(e.object, plain, this.linked(e));
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        if (this.delegated(object, e.name)) return this.typeOf(this.become(e, this.throughEmbedded(e)));
        const found = or === undefined || or.kind === "closure" ? undefined : this.ctx.tables.typing.field(object as Exclude<Type, string>, e.name);
        const c = or?.kind === "class" ? this.cls(object as ClassType) : undefined;
        const getter = !found && c ? inherited(this.ctx.tables.arenas, c, "getters", e.name) : undefined;
        if (getter) {
          this.visible(getter.access, getter.declared ?? getter.owner!, e.name, e);
          this.ctx.calls.set(e, this.ctx.instanceOf(getter.bodyId, undefined));
          const returns = this.ctx.returnOf(this.ctx.instanceOf((this.abstractDeclaration(e, "getters") ?? getter).bodyId, undefined), e);
          // A getter's reference borrows from its object.
          if (this.ctx.tables.typing.holdsRef(returns)) this.ctx.borrowsFrom.set(e, [e.object]);
          return this.linked(e) ? this.optional(returns, e) : returns;
        }
        if (!found && c && inherited(this.ctx.tables.arenas, c, "methods", e.name)) throw new CompileError("E0801", "methods can't be used as values yet; call it", e.start, e.end);
        if (!found && c && inherited(this.ctx.tables.arenas, c, "setters", e.name)) throw new CompileError("E0208", `property '${e.name}' has a setter but no getter`, e.start, e.end);
        if (!found) throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(object)}'${didYouMean(e.name, this.memberNames(object))}`, e.start, e.end);
        if (or?.kind === "class") this.visible(found.access, this.declaring(object as ClassType, e.name), e.name, e);
        // Through a type parameter the field has its bound's type, and in an instance the
        // concrete class may give it with a getter.
        const stored = this.ctx.tables.typing.lower(object);
        const sr = this.recOf(stored);
        if (stored !== object && sr?.kind === "class" && !this.ctx.tables.typing.field(stored as ClassType, e.name)) {
          const instance = this.ctx.instanceOf((this.inheritedOf(stored as ClassType, "getters", e.name)!).bodyId, undefined);
          this.ctx.returnOf(instance, e);
          this.ctx.calls.set(e, instance);
        }
        if (!this.ctx.calls.has(e)) load();
        if (this.linked(e)) return this.optional(this.ctx.tables.typing.unfolded(found.type), e);
        const narrowed = this.ctx.calls.has(e) || this.ctx.exprsState.asDeclared.has(e) ? undefined : this.ctx.narrowedField(e);
        if (narrowed === undefined) {
          this.ctx.instance.narrowedFields?.delete(e);
          return this.ctx.tables.typing.unfolded(found.type);
        }
        (this.ctx.instance.narrowedFields ??= new NodeMap()).set(e, this.ctx.tables.typing.unfolded(found.type));
        return narrowed;
      }
      case "object": {
        const tuple = this.ctx.exprsState.tuples.get(e);
        if (tuple) return this.tupleLiteral(e, tuple);
        if ((this.ctx.exprsState.shaped.has(e) || this.ctx.tables.pairs.has(e)) && this.ctx.tables.tupleLiterals.has(e)) return this.tupleLiteral(e, this.shapedTuple(e, this.partTypes(e)));
        if (e.props.some((p) => p.kind === "spread")) return this.objectSpread(e);
        return this.ctx.tables.typing.objectType(fields(e.props.map((p) => this.property(p)), e.props));
      }
      // An array literal holds its elements' types, each widened as a `let` widens; with none, a
      // declared type has to say what it holds.
      case "array": {
        if (e.elements.some((x) => x === undefined)) throw unsupported("holes in array literals", e);
        const fromObject = this.ctx.tables.objectReads.get(e);
        if (fromObject && !this.ctx.exprsState.wanted.has(e)) this.expect(e, this.objectRead(fromObject.name, fromObject.object).type);
        const tuple = this.ctx.exprsState.tuples.get(e);
        if (tuple) return this.tupleLiteral(e, tuple);
        // A pair in `new Map([[k, v]])` is a tuple of what it holds.
        if (this.ctx.tables.pairs.has(e)) {
          const parts = (e.elements as Expr[]).map((x) => {
            const t = this.ctx.tables.typing.widenLet(this.value(x));
            this.ctx.exprsState.once.add(x);
            return t;
          });
          return this.tupleLiteral(e, this.ctx.tables.typing.tupleType(parts));
        }
        // `Array.of<T>(...)`: an array of T, its elements checked against it.
        const written = this.ctx.tables.ofElements.get(e);
        if (written) {
          // Resolved as an array's element is, so references and functions get the same rules.
          const element = this.ctx.tables.typing.rec(this.ctx.resolveType({ id: nextId(this.ctx.tables.ids), kind: "array", element: written, start: written.start, end: written.end } as TypeNode) as ArrayType).element;
          for (const x of e.elements as Expr[]) {
            this.expect(x, element);
            const t = this.value(x);
            this.coerce(x, t, element, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(element)}'`);
          }
          return this.ctx.tables.typing.arrayType(element);
        }
        const inline = this.ctx.exprsState.fixedLiterals.get(e);
        if (inline) {
          const given = e.elements as Expr[];
          if (given.length !== this.ctx.tables.typing.rec(inline).size) throw new CompileError("E0117", `type '${this.ctx.tables.typing.show(inline)}' holds ${this.ctx.tables.typing.rec(inline).size} element${this.ctx.tables.typing.rec(inline).size === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
          const spread = given.find((x) => x.kind === "spread");
          if (spread) throw unsupported("spread elements in fixed array literals", spread);
          for (const x of given) {
            const t = this.value(x);
            this.coerce(x, t, this.ctx.tables.typing.rec(inline).element, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(inline).element)}'`);
          }
          return inline;
        }
        if (this.ctx.exprsState.shaped.has(e) && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
          return this.tupleLiteral(e, this.shapedTuple(e, this.partTypes(e)));
        }
        const elements = e.elements as Expr[];
        // A spread gives an array's elements: those of an array itself, or of what a string, a
        // generator, a Map or a Set gives, as `Array.from` would. Its elements type the others
        // when nothing else does.
        const spreads = new NodeMap<Expr, Type>();
        for (const x of elements) if (x.kind === "spread") spreads.set(x, this.spreadElements(x));
        const first = [...spreads.values()][0];
        if (first !== undefined && !this.ctx.exprsState.wanted.has(e)) for (const x of elements) if (x.kind !== "spread") this.expect(x, first);
        // Closures meeting the callable an annotation expects of each element are boxed into it.
        const want = this.ctx.exprsState.wanted.get(e);
        const callable = typeof want !== "string" && this.recOf(want)?.kind === "dyn" && this.ctx.tables.typing.callableOf.has(this.ctx.tables.typing.rec(want as DynType).of) ? want : undefined;
        const promise = typeof want !== "string" && this.recOf(want)?.kind === "dyn" && this.ctx.tables.typing.promiseElement(this.ctx.tables.typing.rec(want as DynType).of) !== undefined ? want : undefined;
        const given = elements.map((x) => {
          const spread = spreads.get(x);
          if (spread !== undefined) return spread;
          const t = this.value(x);
          const boxed = typeof t !== "string" && ((this.ctx.tables.typing.rec(t).kind === "closure" && callable) || (this.ctx.tables.typing.rec(t).kind === "future" && promise));
          if (boxed) {
            const into = (callable ?? promise)!;
            this.coerce(x, t, into, `type '${this.ctx.tables.typing.show(t)}' is not assignable to type '${this.ctx.tables.typing.show(into)}'`);
            return into;
          }
          if (typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "closure") throw unsupported("arrays of functions", x);
          if (this.ctx.tables.typing.holdsRef(t)) throw unsupported("arrays of references", x);
          const widened = this.ctx.tables.typing.widenLet(t);
          if (widened !== t) this.coerce(x, t, widened, "");
          return widened;
        });
        const fromSpreads = spreads.size > 0 && !this.ctx.exprsState.wanted.has(e);
        const element = given.length === 0 ? "never" : fromSpreads ? this.ctx.tables.typing.unionType([...spreads.values()]) : this.ctx.tables.typing.unionType(given);
        elements.forEach((x, i) => {
          if (given[i] === element || this.ctx.tables.typing.sameLowered(given[i]!, element)) return;
          // A spread's elements are each converted to the array's type, which has to hold them.
          if (spreads.has(x)) {
            if (!this.ctx.tables.typing.fits(given[i]!, element)) throw new CompileError("E0101", `this spread gives '${this.ctx.tables.typing.show(given[i]!)}' elements, which an array of '${this.ctx.tables.typing.show(element)}' can't hold`, x.start, x.end);
            return;
          }
          this.coerce(x, this.ctx.types.get(x)!, element, `type '${this.ctx.tables.typing.show(this.ctx.types.get(x)!)}' is not assignable to type '${this.ctx.tables.typing.show(element)}', the type of the spread's elements`);
        });
        return this.ctx.tables.typing.arrayType(element);
      }
      case "arrow":
        // A generic arrow is a family of functions: a generic function value, named by the
        // function it is lifted to.
        if (e.typeParams.some((p) => !isLifetime(p))) {
          return this.typeOf(this.ctx.liftArrow(e));
        }
        return this.ctx.closure(e, this.ctx.exprsState.expecting.get(e), this.ctx.exprsState.unsafeDepth > 0, this.ctx.exprsState.owning.has(e));
      // `as` converts between numbers as Rust's does; a boolean or an enum member converts to
      // an integer.
      case "as": {
        if (isConstAssertion(e)) return this.constAssertion(e.expr);
        const resolved = this.ctx.resolveType(e.type);
        // A type parameter bounded by a union or primitive is reached as its bound is at its
        // definition, and as its argument in each instance.
        const plain = this.plainOf(resolved);
        if (plain !== resolved) {
          this.converted(e, plain);
          return resolved;
        }
        return this.converted(e, resolved);
      }
      case "this":
        if (!this.ctx.self) throw new CompileError("E0708", "'this' can only be used inside a class", e.start, e.end);
        if (!this.ctx.thisReady(e)) throw new CompileError("E0703", "'this' can't be used until every field is assigned", e.start, e.end);
        this.ctx.noteThis(e);
        return this.ctx.self.type;
      case "new":
        return this.newValue(e);
      case "tagged":
        if (this.isQuote(e)) return this.quote(e, e.tag.kind === "ident" && e.tag.name === "quoteType");
        return this.typeOf(this.untag(e));
      case "call": {
        const { type, what } = this.call(e);
        if (type === "void") throw new CompileError("E0118", `${what} does not return a value`, e.start, e.end);
        return type;
      }
      case "match":
        return this.match(e, true);
      case "pipe":
        return this.pipe(e, true);
      case "unsafe":
        this.ctx.exprsState.unsafeDepth++;
        try {
          return this.value(e.expr);
        } finally {
          this.ctx.exprsState.unsafeDepth--;
        }
      // Checked as the code it is; it runs while compiling, and codegen bakes its value.
      case "comptime":
        this.ctx.enterComptime();
        try {
          return this.value(e.expr);
        } finally {
          this.ctx.leaveComptime();
        }
      case "yield":
        if (this.ctx.generator && this.ctx.yieldable.has(e)) return this.ctx.yielding(e);
        if (this.ctx.generator) throw unsupported("'yield' inside expressions", e);
        throw new CompileError("E0606", "'yield' can only be used inside a 'function*'", e.start, e.end);
      case "unary": {
        if (e.op === "await") {
          const gives = this.awaited(e);
          if (gives === "void") throw new CompileError("E0305", "this Promise gives nothing once awaited, so its value can't be used", e.start, e.end);
          return gives;
        }
        const deleted = e.op === "delete" ? this.dictEntry(e.operand) : undefined;
        // JavaScript's delete gives true whether or not the key was there.
        if (deleted) {
          const at = { start: e.start, end: e.end };
          const removed = this.dictMethod(deleted.object, "delete", [deleted.key], e);
          return this.typeOf(this.become(e, { id: nextId(this.ctx.tables.ids), kind: "binary", op: "||", left: removed, right: { id: nextId(this.ctx.tables.ids), kind: "bool", value: true, ...at }, ...at }));
        }
        if (e.op !== "-" && e.op !== "!" && e.op !== "~") throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
        const operand = this.operand(e.operand);
        // A brand's operators work on its base; a unit negated keeps its unit.
        const type = this.ctx.tables.typing.unbranded(operand);
        // The smallest i64 is written as the negation of a literal one past the largest.
        if (e.op === "-" && e.operand.kind === "int" && e.operand.value === I64_MAX + 1n) this.ctx.exprsState.fitted.add(e.operand);
        if (e.op === "!" ? type !== "boolean" : type !== "bigint" && (e.op === "~" ? !isInteger(type) : !isNumeric(type))) {
          throw new CompileError("E0103", `operator '${e.op}' cannot be applied to type '${this.ctx.tables.typing.show(type)}'`, e.start, e.end);
        }
        if (e.op === "-" && isInteger(type) && !integerInfo(type).signed) {
          throw new CompileError("E0110", `'${this.ctx.tables.typing.show(type)}' is unsigned, so it can't be negated; convert it to a signed type with 'as' first`, e.start, e.end);
        }
        const brand = this.recOf(operand);
        return e.op === "-" && brand?.kind === "brand" && brand.unit ? operand : type;
      }
      case "assign": {
        if (this.staticWrite(e)) throw new CompileError("E0705", "a static setter gives no value, so an assignment to it can only be a statement of its own", e.start, e.end);
        const op = ASSIGNMENTS[e.op];
        if (!op) throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
        const entry = this.dictEntry(e.target);
        if (entry) {
          if (op !== "=") throw this.dictWrite(entry.place);
          if (this.ctx.exprsState.statementAssign !== e.id) throw new CompileError("E0801", "writing a dictionary's entry gives no value to use, so write it as a statement of its own", e.start, e.end);
          return this.typeOf(this.dictCall(e, entry.object, "set", [entry.key, e.value]));
        }
        const target = this.assignable(e.target, op !== "=");
        const place = this.bare(e.target);
        if (op === "=") this.expect(e.value, target);
        const assigned = op === "=" ? this.value(e.value) : this.read(e.value);
        if (op === "=") this.readOnlySubarray(e.value);
        // A variable whose type is still open takes the integer type assigned to it.
        if (op === "=" && isInteger(assigned) && assigned !== target && this.ctx.infer(place, assigned)) return assigned;
        const type = op === "=" ? assigned
          : op === "+" && this.ctx.tables.typing.unbranded(target) === "string" ? this.join(place, target, e.value, this.widen(e.value, assigned))
          : op === "**" ? this.power(place, target, e.value, this.widen(e.value, assigned), e)
          : binaryType(this.ctx.tables.typing, op, ...this.sameNumbers(place, target, e.value, this.widen(e.value, assigned)), e);
        // A parameter typed by an object type or interface takes any value with its members, so
        // what it holds may have more fields than any value written here.
        const param = place.kind === "ident" ? this.localAt(place) : undefined;
        if (op === "=" && param?.param && this.recOf(target)?.kind === "param" && !this.ctx.tables.typing.fits(type, target)) {
          throw new CompileError("E0101", `'${param.name}' takes any value with the members of '${this.ctx.tables.typing.show(target)}', which may have more, so it can't be given a '${this.ctx.tables.typing.show(type)}'; declare 'let ${param.name}2: ${this.ctx.tables.typing.show(target)} = ${param.name}' to hold just those`, e.start, e.end);
        }
        this.coerce(e.value, type, target, `type '${this.ctx.tables.typing.show(type)}' is not assignable to type '${this.ctx.tables.typing.show(target)}'`);
        // A handle's property is written in JS, with the value converted.
        if (this.ctx.tables.jsMembers.has(place)) {
          this.givenToJs(e.value, assigned);
          // What JS is given is JS's to keep, so nothing is left to be the assignment's value.
          if (this.ctx.tables.typing.keptByJs(target) && this.ctx.exprsState.statementAssign !== e.id) throw new CompileError("E1005", `a callback or a Promise written to property '${(place as { name: string }).name}' goes to JS, so the assignment has no value to use; write it as a statement of its own`, e.start, e.end);
        }
        const local = place.kind === "ident" ? this.localAt(place) : undefined;
        if (local && typeof local.type !== "string" && this.ctx.tables.typing.rec(local.type).kind === "ref" && !this.ctx.coercions.has(place)) this.rebind(local, e.value);
        const narrow = local && this.ctx.narrowed(local.localId);
        if (local && op === "=" && this.ctx.coercions.has(place) && narrow && this.isRefType(narrow) && !this.ctx.tables.typing.fits(type, this.ctx.tables.typing.rec(narrow).to)) this.ctx.rewritten(local.localId, e);
        if (local && op === "=") this.ctx.forget(local.localId, e);
        return target;
      }
      case "update": {
        if (this.staticWrite(e)) throw new CompileError("E0705", "a static setter gives no value, so an assignment to it can only be a statement of its own", e.start, e.end);
        const entry = this.dictEntry(e.operand);
        if (entry) throw this.dictWrite(entry.place);
        const target = this.assignable(e.operand, true);
        // A loose brand takes back the base `++` gives; a strict one or a unit only through `as`.
        const brand = this.recOf(target);
        if (brand?.kind === "brand" && isNumeric(brand.base)) {
          if (brand.loose) return target;
          throw new CompileError("E0103", `operator '${e.op}' gives a '${this.ctx.tables.typing.show(brand.base)}', which a '${this.ctx.tables.typing.show(target)}' is made from only with 'as'; write it as an assignment, like 'x = (x ${e.op[0]} 1) as ${this.ctx.tables.typing.show(target)}'`, e.start, e.end);
        }
        if (!isNumeric(target) && target !== "bigint") throw new CompileError("E0103", `operator '${e.op}' cannot be applied to type '${this.ctx.tables.typing.show(target)}'`, e.start, e.end);
        return target;
      }
      case "conditional": {
        this.condition(e.cond);
        const proven = this.ctx.proves(e.cond);
        if (ruledOut(proven.yes)) return this.valueAssuming(proven.no, e.else, false);
        if (ruledOut(proven.no)) return this.valueAssuming(proven.yes, e.then, false);
        let then = this.valueAssuming(proven.yes, e.then, false);
        let otherwise = this.valueAssuming(proven.no, e.else, false);
        [then, otherwise] = this.sameNumbers(e.then, then, e.else, otherwise);
        if (then === otherwise) return then;
        // Two references lend shared what both point to, or a type both fit; otherwise a side
        // that borrows gives its value.
        const isRef = (t: Type) => typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "ref";
        if (isRef(then) && isRef(otherwise)) {
          const [a, b] = [this.ctx.tables.typing.rec(then as RefType).to, this.ctx.tables.typing.rec(otherwise as RefType).to];
          if (this.ctx.tables.typing.rec(then as RefType).mutable && this.ctx.tables.typing.rec(otherwise as RefType).mutable && this.ctx.tables.typing.lower(a) === this.ctx.tables.typing.lower(b)) return then;
          const bound = (t: Type) => {
            const r = this.recOf(t);
            return r?.kind === "param" ? r.bound : undefined;
          };
          const common = [a, b, bound(a), bound(b)].find((t) => t && this.ctx.tables.typing.fits(a, t) && this.ctx.tables.typing.fits(b, t));
          if (common) {
            const shared = this.ctx.tables.typing.refType(common, false);
            this.coerce(e.then, then, shared, "");
            this.coerce(e.else, otherwise, shared, "");
            return shared;
          }
        }
        // A reference against nothing is a reference or nothing.
        const option = isRef(then) && otherwise === "null" ? this.ctx.tables.typing.unionType([then, "null"]) : isRef(otherwise) && then === "null" ? this.ctx.tables.typing.unionType([otherwise, "null"]) : undefined;
        if (option) {
          this.coerce(e.then, then, option, "");
          this.coerce(e.else, otherwise, option, "");
          return option;
        }
        if (isRef(then) || isRef(otherwise)) [then, otherwise] = [this.loaded(e.then, then), this.loaded(e.else, otherwise)];
        if (then === otherwise) return then;
        // A tuple of literals, as `as const` writes one, beside a tuple it fits is that tuple, since a
        // union of tuples can't be destructured.
        if (this.ctx.tables.typing.isTuple(then) && this.ctx.tables.typing.isTuple(otherwise)) {
          const wider = this.ctx.tables.typing.fits(otherwise, then) ? then : this.ctx.tables.typing.fits(then, otherwise) ? otherwise : undefined;
          if (wider !== undefined) {
            this.coerce(e.then, then, wider, "");
            this.coerce(e.else, otherwise, wider, "");
            return wider;
          }
        }
        return bothSides(this, e, then, otherwise);
      }
      case "binary":
        if (this.presence(e)) return "boolean";
        // Each instance of an isDeepStrictEqual checks its own operands' types.
        if (this.ctx.tables.deepEqualities.has(e)) {
          for (const a of [e.left, e.right]) {
            const t = this.value(a);
            this.ctx.exprsState.once.add(a);
            if (holdsFloat(this.ctx.tables.typing, t)) throw new CompileError("E0801", "'isDeepStrictEqual' over floats isn't supported yet: Node's compares them as Object.is does, NaN equal to NaN and -0 apart from 0, unlike '==='", a.start, a.end);
          }
        }
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError("E0802", `'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (e.op === "&&" || e.op === "||") {
          // The right side runs only when the left is true, for `&&`, or false, for `||`.
          const left = this.operand(e.left);
          const proven = this.ctx.proves(e.left);
          return binaryType(this.ctx.tables.typing, e.op, left, this.valueAssuming(e.op === "&&" ? proven.yes : proven.no, e.right, true), e);
        }
        if (e.op === "===" || e.op === "!==") {
          try {
            return this.compared(e);
          } catch (err) {
            // A check against `null` or a literal that a narrowed variable can't be is redundant, as
            // TypeScript allows, so the variable is compared as declared.
            if (!(err instanceof CompileError && err.code === "E0112") || !this.asDeclared(e)) throw err;
            return this.compared(e);
          }
        }
        if (e.op === "instanceof") return instanceofCheck(e, this);
        if (e.op === "**") return this.power(e.left, this.operand(e.left), e.right, this.operand(e.right), e);
        if (e.op === "??") return this.orElse(e);
        if (e.op === "in" && e.left.kind === "privateName") {
          throw new CompileError("E0802", `'${e.left.name} in' can't be used: Fish has no run-time reflection, and a value's class is known while compiling`, e.start, e.end);
        }
        if (e.op === "in") {
          if (e.right.kind === "ident") this.ctx.exprsState.objects.add(e.right);
          const tested = this.value(e.right);
          this.ctx.exprsState.once.add(e.right);
          if (this.dictOf(tested)) return this.typeOf(this.dictCall(e, e.right, "has", [this.dictKey(e.left)]));
          return keyCheck(e, this);
        }
        if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
        if (e.op === "+") {
          const [left, right] = [this.operand(e.left), this.operand(e.right)];
          if (stringLike(this.ctx.tables.typing, left) || stringLike(this.ctx.tables.typing, right) || enumText(this.ctx.tables.typing, left) || enumText(this.ctx.tables.typing, right)) return this.join(e.left, left, e.right, right);
        }
        return binaryType(this.ctx.tables.typing, e.op, ...this.sameNumbers(e.left, this.operand(e.left), e.right, this.operand(e.right), false), e);
      // A spread anywhere but in an array literal or a call filling a rest parameter.
      case "spread":
        throw new CompileError("E0408", "'...' spreads into an array literal, or as an argument into a rest parameter, as in 'function f(...xs: T[])'; it can't be used here yet", e.start, e.end);
      case "meta":
        if (e.name === "import.meta") throw new CompileError("E0801", `meta properties are not supported yet; 'import.meta' is read through its members ${IMPORT_META_MEMBERS.join(", ")}, or destructured into them`, e.start, e.end);
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
      default:
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
    }
  }

  // A fresh object literal's literal properties take the number types of the fields they meet,
  // in nested literals too; the literal's type is then made again from its properties.
  // The part of an object literal that gives its field `name`: the last that has it. A spread of
  // an object-typed parameter has its bound's fields, each instance being checked with its own.
  private winner(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>, name: string): ObjectProp | undefined {
    return e.props.findLast((q) => {
      if (q.kind === "property") return q.key === name;
      if (q.kind === "shorthand") return q.name === name;
      if (q.kind !== "spread") return false;
      const t = this.ctx.types.get(q.value)!;
      const low = this.heldBy(t)!;
      const lr = this.recOf(low);
      const br = lr?.kind === "param" ? this.recOf(lr.bound) : undefined;
      const source = br?.kind === "object" ? (lr as ParamRecord).bound! : low;
      return typeof source === "string" || (br?.kind !== "object" && lr?.kind === "param") || this.ctx.tables.typing.field(source, name) !== undefined;
    });
  }

  /** @throws {CompileError} */
  private adaptFields(this: Mut<this>, e: Ref<Expr>, type: Type, to: Type): Type {
    to = this.ctx.tables.typing.unfolded(to);
    // An object literal meeting a union adapts to the member it names, then joins the union.
    if (e.kind === "object") to = this.memberNamed(e, to) ?? to;
    if (e.kind !== "object" || typeof to === "string" || (this.ctx.tables.typing.rec(to).kind !== "object" && this.ctx.tables.typing.rec(to).kind !== "class")) return type;
    // Only a property no later part replaces gives its field, so only that one adapts.
    const winners = e.props.filter((p): p is Extract<ObjectProp, { kind: "property" }> =>
      p.kind === "property" && typeof p.key === "string" && this.winner(e, p.key) === p);
    let changed = false;
    for (const p of winners) {
      const key = p.key as string;
      const want = this.ctx.tables.typing.field(to, key)?.type;
      const have = this.ctx.types.get(p.value)!;
      // A string literal widened for the object keeps its literal type where one is wanted.
      if (want && want !== "string" && this.ctx.coercions.get(p.value) === "string" && this.ctx.tables.typing.fits(have, want)) {
        this.ctx.coercions.delete(p.value);
        changed = true;
        continue;
      }
      if (!want || have === want) continue;
      // An array literal meeting a union becomes the union's array, which then joins the union.
      const adapted = this.adapt(p.value, want) ? want : this.literalArray(p.value, have, want) ? this.ctx.types.get(p.value)! : this.adaptFields(p.value, have, want);
      if (adapted !== have) {
        this.ctx.types.set(p.value, adapted);
        changed = true;
      }
    }
    if (!changed) return type;
    const fields = this.ctx.tables.typing.rec(type as ObjectType).fields.map((f) => {
      const p = winners.find((q) => q.key === f.name);
      return p ? { ...f, type: this.ctx.coercions.get(p.value) ?? this.ctx.types.get(p.value)! } : f;
    });
    // A tuple stays one, its rest taken from its adapted array.
    const tuple = type as ObjectType;
    const many = fields.find((f) => f.name === "...")?.type as ArrayType | undefined;
    const remade = this.ctx.tables.typing.isTuple(tuple) && !this.ctx.tables.typing.rec(tuple).match ? this.ctx.tables.typing.tupleType(tupleElements(fields), this.ctx.tables.typing.rec(tuple).required, this.recOf(many)?.element) : this.ctx.tables.typing.objectType(fields);
    this.ctx.types.set(e, remade);
    return remade;
  }

  // `**` raises an integer to a `u32` power, like Rust's `pow`, and a float to a float power of
  // its own type, like `powf`. A literal base takes its type from the exponent's only when that
  // is a float.
  /** @throws {CompileError} */
  private power(this: Mut<this>, base: Ref<Expr>, left: Type, exponent: Ref<Expr>, right: Type, at: Ref<Expr>): Type {
    // A bigint's exponent is a bigint, as in JavaScript.
    if (left === "bigint" || right === "bigint") return binaryType(this.ctx.tables.typing, "*", left, right, { start: at.start, end: at.end });
    if (isFloat(right) && left !== right && this.adapt(base, right)) left = right;
    // A power of literals alone may still become a float where it is written, so an exponent
    // a u32 can't hold waits to see.
    if (isInteger(left) && right !== "u32" && this.literalOnly(base, false) && this.literalOnly(exponent, false)) {
      try {
        if (this.adapt(exponent, "u32")) right = "u32";
      } catch {
        this.ctx.exprsState.powers.push([at, exponent]);
        return left;
      }
    }
    if (isInteger(left) && right !== "u32" && this.adapt(exponent, "u32")) right = "u32";
    if (isFloat(left) && left !== right && this.adapt(exponent, left)) right = left;
    if (isInteger(left) && right !== "u32") {
      throw new CompileError("E0110", `the exponent of '**' on an integer is a 'u32', as in Rust's 'pow', not '${this.ctx.tables.typing.show(right)}'; convert it with 'as u32'`, exponent.start, exponent.end);
    }
    if (!isNumeric(left) || (isFloat(left) && left !== right)) {
      throw new CompileError("E0103", `operator '**' cannot be applied to types '${this.ctx.tables.typing.show(left)}' and '${this.ctx.tables.typing.show(right)}'`, at.start, at.end);
    }
    return left;
  }

  // What an Option holds when it isn't empty.
  private held(this: Mut<this>, option: UnionType): Type {
    return this.ctx.tables.typing.unionType(this.ctx.tables.typing.rec(option).members.filter((m) => m !== "null"));
  }

  // `a ?? b` is what `a` holds, or `b` when `a` is empty, which only then runs. With an Option
  // for `b`, the result may still be empty.
  /** @throws {CompileError} */
  private orElse(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): Type {
    // A destructuring default in a generic instance meets the Option its type parameter is.
    const left = this.read(e.left);
    const option = this.ctx.tables.unusedDefaults.has(e) ? this.ctx.tables.typing.lower(left) : left;
    // A default a destructuring assignment adds is only for an Option's absence.
    // Its default is still checked, as TypeScript checks it.
    if (!this.ctx.tables.typing.isOption(this.ctx.tables.typing.lower(option)) && this.ctx.tables.unusedDefaults.has(e)) {
      this.value(e.right);
      return option;
    }
    // An unknown may hold null, and is still an unknown once a default replaces it.
    const unknown = this.ctx.tables.typing.isUnknown(option);
    if (!this.ctx.tables.typing.isOption(option) && !unknown) throw new CompileError("E0108", `the left side of '??' is a '${this.ctx.tables.typing.show(option)}', which is never empty; '??' gives a default for an Option`, e.left.start, e.left.end);
    const inner = unknown ? option : this.held(option as UnionType);
    // A parameter's default is checked as an argument for it would be; a nullable one's is null.
    const declared = this.ctx.tables.fallbacks.get(e);
    if ((declared !== undefined)) {
      const to = holdsNull(this.ctx.tables.typing, this.ctx.resolveType(declared)) ? option : inner;
      this.expect(e.right, to);
      const fallback = this.value(e.right);
      this.coerce(e.right, fallback, to, `a default of type '${this.ctx.tables.typing.show(fallback)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(to)}'`);
      return to;
    }
    const fallback = this.value(e.right);
    // An Option of a reference takes a place to lend as its fallback.
    const to = this.ctx.tables.typing.fits(fallback, inner) || this.adaptable(e.right, inner) || (this.isRefType(inner) && this.ctx.tables.typing.fits(fallback, this.ctx.tables.typing.rec(inner).to)) ? inner : option;
    this.coerce(e.right, fallback, to, `type '${this.ctx.tables.typing.show(fallback)}' is not assignable to type '${this.ctx.tables.typing.show(to)}', what '${this.ctx.tables.typing.show(option)}' holds`);
    return to;
  }

  // A brand's base, which `Math` works on as it would on any of its values; a unit stays, since
  // what `Math` gives would lose it.
  private brandBase(t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "brand" && (r.unit === undefined) ? r.base : t;
  }

  // Whether an expression of only literals could take this number type.
  private adaptable(given: Ref<Expr>, to: Type): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.adaptableNow(now, to) : this.adaptableNow(given, to);
  }
  private adaptableNow(e: Ref<Expr>, to: Type): boolean {
    return isNumeric(to) && this.literalOnly(e, isFloat(to));
  }

  // An array literal takes a declared element type, each element meeting it.
  /** @throws {CompileError} */
  private literalArray(this: Mut<this>, e: Ref<Expr>, type: Type, to: Type): boolean {
    // Meeting a union, it takes the union's one array member, and then joins the union.
    const tr = this.recOf(to);
    const members = tr?.kind === "union" ? tr.members.filter((m): m is ArrayType => this.isArray(m)) : [];
    if (e.kind === "array" && this.isArray(type) && members.length === 1 && this.literalArray(e, type, members[0]!)) {
      this.coerce(e, members[0]!, to, "");
      return true;
    }
    if (e.kind !== "array" || !this.isArray(type) || !this.isArray(to) || type === to) return false;
    // Each element meets the declared type afresh, replacing how it met the literal's own.
    for (const x of e.elements as Expr[]) {
      this.ctx.coercions.delete(x);
      this.coerce(x, this.ctx.types.get(x)!, this.ctx.tables.typing.rec(to).element, `type '${this.ctx.tables.typing.show(this.ctx.types.get(x)!)}' is not assignable to type '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(to).element)}'`);
    }
    this.ctx.types.set(e, to);
    return true;
  }

  // `v === null` and `v === undefined` test a JsValue for JS's two empty values, which Fish's one
  // empty value can't tell apart.
  /** @throws {CompileError} */
  private jsEmpty(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): Type | undefined {
    for (const [subject, other] of [[e.left, e.right], [e.right, e.left]] as const) {
      if (!isEmpty(other, this.ctx.locals as NodeMap<Expr, LocalId>)) continue;
      const t = this.value(subject);
      this.ctx.exprsState.once.add(subject);
      if (!this.ctx.tables.typing.isPlainJs(this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t)) return undefined;
      this.ctx.exprsState.once.delete(subject);
      this.value(other);
      this.ctx.tables.jsEmptyTests.set(e, [subject, other.kind === "null" ? "null" : "undefined"]);
      return "boolean";
    }
    return undefined;
  }

  // `===` between values holding objects, arrays or instances compares them by value, as Fish's
  // Eq does, where TypeScript compares objects by identity: every part has to compare, and the
  // wider value is compared as the narrower.
  /** @throws {CompileError} */
  private equality(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): Type | undefined {
    const [left, right] = [this.value(e.left), this.value(e.right)];
    this.ctx.exprsState.once.add(e.left);
    this.ctx.exprsState.once.add(e.right);
    const deref = (t: Type) => this.ctx.tables.typing.unfold(this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t);
    const [l, r] = [deref(left), deref(right)];
    if (!objectsMeet(this.ctx.tables.typing, l, r)) return undefined;
    this.ctx.exprsState.once.delete(e.left);
    this.ctx.exprsState.once.delete(e.right);
    for (const t of [l, r]) {
      const part = this.ctx.tables.typing.unequal(t, (c) => this.comparesAsValue(c));
      if ((part !== undefined)) throw new CompileError("E0112", `values of type '${this.ctx.tables.typing.show(part)}' can't be compared with '${e.op}': ${this.uncomparable(part)}`, e.start, e.end);
    }
    // A comparison over type parameters is checked again in each instance, once they're concrete.
    if (openParam(this.ctx.tables.typing, l, true) || openParam(this.ctx.tables.typing, r, true)) return "boolean";
    // A type parameter is compared as the type it stands for in this instance, and a union
    // holding one as the union that flattens into.
    const concrete = (t: Type): Type => {
      const r = this.recOf(t);
      if (r?.kind === "param" && r.concrete) return concrete(r.concrete);
      return r?.kind === "union" && holdsArgument(this.ctx.tables.typing, t as UnionType) ? this.ctx.tables.typing.lower(t) : t;
    };
    const [cl, cr] = [concrete(l), concrete(r)];
    const common = this.ctx.tables.typing.fits(cl, cr) ? cr : this.ctx.tables.typing.fits(cr, cl) ? cl : undefined;
    // Two unions that share a member compare as unions do, member by member.
    const members = (t: Type) => {
      const r = this.recOf(t);
      return r?.kind === "union" ? r.members : [t];
    };
    const overlap = members(cl).some((x) => members(cr).some((y) => this.ctx.tables.typing.fits(x, y) || this.ctx.tables.typing.fits(y, x)));
    if (!common && !overlap) throw new CompileError("E0112", `this comparison appears to be unintentional because the types '${this.ctx.tables.typing.show(l)}' and '${this.ctx.tables.typing.show(r)}' have no overlap`, e.start, e.end);
    // A reference is compared through, reading the value it borrows.
    const [a, b] = [this.loaded(e.left, left), this.loaded(e.right, right)];
    if (common && a !== common) this.coerce(e.left, a, common, "");
    if (common && b !== common) this.coerce(e.right, b, common, "");
    return "boolean";
  }

  // Why values of a type can't be compared.
  private uncomparable(t: Type): string {
    const rust = rustClassOf(this.ctx.tables.typing, t);
    if ((rust !== undefined)) return `a Rust '${rust.name}' isn't compared from Fish; compare what its methods give`;
    const r = this.recOf(t);
    if (r?.kind === "class") return `a class compares through 'equals(other: Ref<this>): boolean', which '${r.name}' doesn't have; add one, or '@derive(Eq)'`;
    if (r?.kind === "variant") return "an enum holding values compares when it has '@derive(Eq)'";
    if (r?.kind === "map") return `a ${r.set ? "Set" : (r.dict !== undefined) ? "dictionary" : "Map"} isn't compared by value; compare its entries`;
    if (r?.kind === "shared" && r.which === "Rc") return "it has no value equality; 'Rc.ptrEq(a, b)' tells whether two Rcs share one value";
    return "it has no value equality";
  }

  // Whether a class or a data enum's values compare: a class through its `equals`, an enum
  // when it derives Eq.
  /** @throws {CompileError} */
  private comparesAsValue(this: Mut<this>, t: ClassType | VariantType): boolean {
    if ((rustClassOf(this.ctx.tables.typing, t) !== undefined)) return false;
    const r = this.ctx.tables.typing.rec(t);
    if (r.kind === "variant") return [...this.ctx.enums.values()].some((e) => e.data?.name === r.enum && e.data.eq);
    const known = this.ctx.tables.equalities.get(t as ClassType);
    if (known) return true;
    const method = this.inheritedOf(t as ClassType, "methods", "equals");
    if (!method) return false;
    const instance = this.ctx.instanceOf(method.bodyId, undefined);
    const [arg, ...more] = this.ctx.paramTypes(instance);
    const ar = this.recOf(arg);
    const to = ar?.kind === "ref" ? this.recOf(ar.to) : undefined;
    const shaped = !method.self?.mutable && !method.self?.owned && more.length === 0 && ar?.kind === "ref" && !ar.mutable && (this.ctx.tables.typing.lower(ar.to) === this.ctx.tables.typing.lower(t) || (to?.kind === "class" && this.ctx.tables.typing.derives(t as ClassType, ar.to as ClassType))) && this.ctx.returnOf(instance, method) === "boolean";
    if (!shaped) throw new CompileError("E0702", `'${r.name}.equals' is what '===' compares instances with, so it takes 'other: Ref<this>' and returns a boolean`, method.start, method.end);
    this.ctx.tables.equalities.set(t as ClassType, instance);
    return true;
  }

  // `+` with a string on either side joins the two into a new string.
  /** @throws {CompileError} */
  private join(this: Mut<this>, a: Ref<Expr>, left: Type, b: Ref<Expr>, right: Type): Type {
    this.joined(a, left, "'+'");
    this.joined(b, right, "'+'");
    return "string";
  }

  // Values printed, or formatted as util.format does: what isn't a scalar is shown as Node's
  // util.inspect shows it.
  /** @throws {CompileError} */
  private shown(this: Mut<this>, args: Ref<Expr[]>) {
    for (const a of args) {
      const type = a.kind === "string" ? "void" : this.read(a);
      if (this.ctx.tables.typing.holdsPart(type, (u) => rustClassOf(this.ctx.tables.typing, u) !== undefined, true)) throw new CompileError("E1004", `printing a '${this.ctx.tables.typing.show(type)}' isn't supported, since it holds a Rust value; print what its methods give`, a.start, a.end);
      if (this.printable(type)) continue;
      this.ctx.tables.printed.add(cloneExpr(a));
      const part = this.ctx.tables.typing.uninspectable(type);
      if ((part === undefined)) continue;
      throw new CompileError("E0510", typeof part !== "string" && (this.ctx.tables.typing.rec(part).kind === "function" || this.ctx.tables.typing.rec(part).kind === "closure" || this.ctx.tables.typing.rec(part).kind === "dyn") ? "printing a function isn't supported yet" : `printing a '${this.ctx.tables.typing.show(part)}' isn't supported yet`, a.start, a.end);
    }
  }

  // `%j`, JSON, in a literal format, where it would take an argument.
  /** @throws {CompileError} */
  private unformattable(args: Ref<Expr[]>) {
    const [first] = args;
    if (first?.kind !== "string" || args.length < 2 || !formatPlan(first.value, args.length).specs.includes("j")) return;
    throw new CompileError("E0801", "'%j' in a format isn't supported yet; pass 'JSON.stringify(x)' to '%s' instead", first.start, first.end);
  }

  // A value written into a string: text, or a number or boolean written as JavaScript would.
  /** @throws {CompileError} */
  private joined(this: Mut<this>, given: Ref<Expr>, type: Type, into: string): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.joinedNow(now, type, into);
    else this.joinedNow(given, type, into);
  }
  /** @throws {CompileError} */
  private joinedNow(this: Mut<this>, e: Ref<Expr>, type: Type, into: string): void {
    if (this.ctx.tables.typing.unbranded(type) !== type) return this.joined(e, this.ctx.tables.typing.unbranded(type), into);
    if (stringLike(this.ctx.tables.typing, type) || enumText(this.ctx.tables.typing, type)) {
      if (type !== "string") this.coerce(e, type, "string", "");
      return;
    }
    // A value of no type is in code an instance never reaches.
    if (isNumeric(type) || type === "boolean" || type === "bigint" || type === "never") return;
    throw new CompileError("E0510", `${into} works with strings, numbers and booleans, not '${this.ctx.tables.typing.show(type)}'`, e.start, e.end);
  }

  // Two operands of different number types meet as one when either is only literals. String
  // literals meet as strings, unless two different ones are compared for equality.
  /** @throws {CompileError} */
  private sameNumbers(this: Mut<this>, a: Ref<Expr>, left: Type, b: Ref<Expr>, right: Type, equality = false): [Type, Type] {
    if (isText(this.ctx.tables.typing, left) && isText(this.ctx.tables.typing, right) && (!equality || (left !== right && (left === "string" || right === "string")))) {
      if (left !== "string") this.coerce(a, left, "string", "");
      if (right !== "string") this.coerce(b, right, "string", "");
      return ["string", "string"];
    }
    if (left === right) return [left, right];
    // A literal meeting a brand takes its base, which is what operators on a brand work in.
    const [lb, rb] = [this.ctx.tables.typing.unbranded(left), this.ctx.tables.typing.unbranded(right)];
    if (this.adapt(b, lb)) return [left, lb];
    if (this.adapt(a, rb)) return [rb, right];
    return [left, right];
  }

  // A value meeting a declared type must fit it. A wider one is copied down to it, except
  // that a fresh object literal may not name extra properties, as in TypeScript.
  /** @throws {CompileError} */
  coerce(this: Mut<this>, given: Ref<Expr>, type: Type, to: Type, message: string): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.coerceNow(now, type, to, message);
    else this.coerceNow(given, type, to, message);
  }
  /** @throws {CompileError} */
  private coerceNow(this: Mut<this>, e: Ref<Expr>, type: Type, to: Type, message: string): void {
    const tr = this.recOf(to);
    // A tuple's length is a 'usize', and also the literal of its count where that is known, as
    // in 'const n: 2 = t.length'.
    if (tr?.kind === "literal" && this.tupleLength(e) === to) {
      this.ctx.types.set(cloneExpr(e), to);
      return;
    }
    // A reference that changes its value's form points at a copy in a slot of the function,
    // which an async function loses each time it stops.
    if (this.ctx.async && tr?.kind === "ref" && !this.isRefType(type) && this.ctx.tables.typing.lower(type) !== this.ctx.tables.typing.lower(tr.to) && this.ctx.tables.typing.fits(type, tr.to)) {
      throw unsupported("references that convert their value inside async functions", e);
    }
    // `unsafe { expr }` is `expr`, which meets the type itself.
    if (e.kind === "unsafe") {
      this.coerce(e.expr, type, to, message);
      if (type !== to) this.ctx.types.set(e, this.ctx.coercions.has(e.expr) ? this.ctx.coercions.get(e.expr)! : this.ctx.types.get(e.expr)!);
      return;
    }
    // A widening `as` or a `satisfies` around a `?:` lends the place either side chooses, as the
    // `?:` alone does; lent as a whole, it would lend a copy no borrow keeps track of.
    if ((tr?.kind === "ref" || this.ctx.tables.typing.optionRef(to)) && this.handsOnChoice(e)) {
      const inner = this.ctx.tables.rewrites.current((e as Extract<Expr, { kind: "as" | "satisfies" }>).expr);
      this.ctx.coercions.delete(e);
      this.ctx.coercions.delete(inner);
      // What is lent is the operand, so a message naming the wrapper's type names the operand's.
      const named = `type '${this.ctx.tables.typing.show(type)}'`;
      const said = message.startsWith(named) ? `type '${this.ctx.tables.typing.show(this.ctx.types.get(inner)!)}'${message.slice(named.length)}` : message;
      this.coerce(inner, this.ctx.types.get(inner)!, to, said);
      this.ctx.types.set(e, this.ctx.coercions.get(inner) ?? this.ctx.types.get(inner)!);
      return;
    }
    // A recursive type's value meeting another type is the type it stands for, read out of
    // its block.
    const held = this.recOf(type);
    if (held?.kind === "recursive" && type !== to && !(tr?.kind === "union" && tr.members.includes(type))) {
      this.ctx.coercions.delete(e);
      this.coerce(e, held.of, to, message);
      if (!this.ctx.coercions.has(e)) this.ctx.coercions.set(e, held.of);
      return;
    }
    // At a definition, a type parameter bounded by a union or primitive meets types as its bound.
    if (held?.kind === "param" && held.within && type !== to) {
      this.coerce(e, held.concrete!, to, message);
      return;
    }
    // A value meeting a recursive type meets the type it stands for, then moves into a block.
    if (tr?.kind === "recursive" && type !== to) {
      this.coerce(e, type, tr.of, message);
      this.ctx.coercions.set(e, to);
      return;
    }
    // A derived `equals` lends its argument to the base's, which reads the embedded base.
    const from = held?.kind === "ref" ? this.recOf(held.to) : undefined;
    const into = tr?.kind === "ref" ? this.recOf(tr.to) : undefined;
    if (this.ctx.tables.upcasts.has(`${e.start}:${e.end}`) && tr?.kind === "ref" && !tr.mutable && from?.kind === "class" && into?.kind === "class" && this.ctx.tables.typing.derives(this.ctx.tables.typing.rec(type as RefType).to as ClassType, tr.to as ClassType)) return;
    // A mutable reference lent on must be reachable only through mutable references.
    if (tr?.kind === "ref" && tr.mutable && held?.kind === "ref" && held.mutable && this.rooted(e) && this.place(e)) this.changeable(e, "mutably borrow");
    if (type === to || this.ctx.tables.typing.sameLowered(type, to) || this.ctx.tables.typing.sameCallable(type, to)) return;
    // An array literal takes the array of JS values it meets element by element, as any does.
    if (e.kind === "array" && tr?.kind === "array" && this.holdsJs(to) && this.literalArray(e, type, to)) return;
    // An Option or array of JS values takes what each of its members would.
    if (tr?.kind !== "block" && this.holdsJs(to) && !this.ctx.tables.typing.fits(type, to) && this.passesJs(type, to)) {
      this.ctx.coercions.set(e, to);
      return;
    }
    // Any value that crosses to JS is a JsValue there, as TypeScript's 'any' takes anything, and
    // a Fish value of a shape's fields becomes a new JS object of that shape.
    if (tr?.kind === "block" && tr.which === "JsValue") {
      // A borrowed handle passes as the handle, counted again.
      if (from?.kind === "block" && from.which === "JsValue") type = this.ctx.tables.typing.rec(type as RefType).to;
      const shape = this.ctx.tables.typing.jsShape(to);
      if (shape ? this.takesShape(type, shape) : this.ctx.tables.typing.uncrossable(type) === undefined) {
        this.ctx.coercions.set(e, to);
        return;
      }
      const field = shape && this.missingField(type, shape);
      throw new CompileError("E0101", field ? `${message}: ${field}` : message, e.start, e.end);
    }
    if (this.adapt(e, to)) return;
    type = this.adaptFields(e, type, to);
    if (type === to) return;
    if (this.literalArray(e, type, to)) return;
    // A `?:` that doesn't fit as a whole, as two string literals don't fit a union of literals
    // once joined as a 'string', fits when each side does.
    if (e.kind === "conditional" && !this.ctx.tables.typing.fits(type, to)) {
      for (const side of [e.then, e.else].filter((s) => this.ctx.types.has(s))) {
        this.ctx.coercions.delete(side);
        this.coerce(side, this.ctx.types.get(side)!, to, message);
      }
      this.ctx.types.set(e, to);
      return;
    }
    if (isNumeric(type) && isNumeric(to)) throw new CompileError("E0101", `${message}; convert it with 'as ${this.ctx.tables.typing.show(to)}'`, e.start, e.end);
    // A brand is made from its base only by saying so.
    if (tr?.kind === "brand" && !tr.loose && message !== "" && (type === tr.base || (isNumeric(type) && isNumeric(tr.base)))) throw new CompileError("E0101", `${message}; make one with 'as ${this.ctx.tables.typing.show(to)}'`, e.start, e.end);
    if (tr?.kind === "ref" && (typeof type === "string" || this.ctx.tables.typing.rec(type).kind !== "ref")) {
      this.borrow(e, type, to as RefType, message);
      return;
    }
    // A place meeting a reference or nothing is lent, as one meeting the reference is.
    const lent = this.ctx.tables.typing.optionRef(to);
    // A `?:` lends a place either side chooses into it, as it does into a reference.
    if (lent && e.kind === "conditional" && this.ctx.tables.typing.optionRef(type) === undefined && [e.then, e.else].some((x) => this.ctx.types.has(x) && this.rooted(x))) {
      for (const side of [e.then, e.else].filter((s) => this.ctx.types.has(s))) {
        this.ctx.coercions.delete(side);
        this.coerce(side, this.ctx.types.get(side)!, to, message);
      }
      this.ctx.types.set(e, to);
      return;
    }
    if (lent && type !== "null" && !this.ctx.tables.typing.optionRef(type) && (typeof type === "string" || this.ctx.tables.typing.rec(type).kind !== "ref")) {
      this.borrow(e, type, lent, message);
      this.ctx.coercions.set(e, to);
      return;
    }
    // A reference gives its value where one is wanted only by copying it: nothing moves out of
    // a borrow.
    const ref = this.recOf(type);
    if (ref?.kind === "ref" && (tr === undefined || tr.kind !== "ref") && !lent) {
      if (!this.ctx.tables.typing.isCopy(ref.to) && this.ctx.tables.typing.fits(ref.to, to)) {
        throw new CompileError("E0202", `can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy`, e.start, e.end);
      }
      this.ctx.coercions.set(e, ref.to);
      this.coerce(e, ref.to, to, message);
      return;
    }
    // In an instance, a member of the union a type parameter stands for goes into that union, as
    // a value awaited from a promise of `T | null` does once narrowed.
    const argument = this.recOf(tr?.kind === "param" && tr.concrete && !this.ctx.tables.typing.fits(type, to) ? this.ctx.tables.typing.lower(to) : undefined);
    if (argument?.kind === "union") {
      intoUnion(e, type, this.ctx.tables.typing.lower(to) as UnionType, message, this);
      return;
    }
    if (tr?.kind === "union") {
      // A value no member takes as it is goes into the union's one Dyn, boxed.
      const dyns = tr.members.flatMap((m) => {
        const r = this.recOf(m);
        return r?.kind === "dyn" ? [m as DynType] : [];
      });
      const kind = this.recOf(type)?.kind;
      const boxable = kind === "class" || kind === "generator";
      if (boxable && dyns.length === 1 && this.ctx.tables.typing.membersFor(type, to as UnionType).length === 0 && !this.ctx.tables.typing.callableOf.has(this.ctx.tables.typing.rec(dyns[0]!).of)) {
        this.boxing(e, type, dyns[0]!, message);
        this.ctx.tables.boxedMembers.set(e, dyns[0]!);
        this.ctx.coercions.set(e, to);
        return;
      }
      const member = e.kind === "object" ? this.lentMember(e, to as UnionType) : undefined;
      if (member) type = this.lendFields(e as Extract<Expr, { kind: "object" }>, member, message);
      const lending = e.kind === "object" && !member && tr.members.some((m) => this.recOf(m)?.kind === "object" && this.ctx.tables.typing.holdsRef(m));
      try {
        intoUnion(e, type, to as UnionType, message, this);
      } catch (err) {
        // A literal that could have lent to a member holding references fails for want of a tag.
        if (!lending || !(err instanceof CompileError) || err.code !== "E0101") throw err;
        throw new CompileError("E0101", `can't choose which member of '${this.ctx.tables.typing.show(to)}' this object goes into: a member holding references is chosen by its literal fields, like 'of: "a"', so give each member one and write its value here as a literal`, e.start, e.end);
      }
      return;
    }
    // A literal type takes exactly its value, so only a literal expression of that value fits.
    if (tr?.kind === "literal") {
      if (literalValue(e) !== tr.value) throw new CompileError("E0101", message, e.start, e.end);
      this.ctx.coercions.set(e, to);
      return;
    }
    if (e.kind === "object" && tr?.kind === "object" && this.ctx.tables.typing.holdsRef(to)) type = this.lendFields(e, to as ObjectType, message);
    const shape = !this.ctx.tables.typing.fits(type, to) ? literalShape(this.ctx.tables.typing, e, to, this.ctx.types) : undefined;
    if (shape) {
      applyShape(shape, this.ctx.coercions, this.ctx.types);
      type = shape.type;
    }
    if (tr?.kind === "function") {
      if (!this.ctx.tables.typing.fits(type, to)) throw new CompileError("E0101", message, e.start, e.end);
      return;
    }
    if (tr?.kind === "dyn") return this.boxing(e, type, to as DynType, message);
    if (tr?.kind === "interface") {
      const reason = unsatisfied(type, to as InterfaceType, this.ctx.members(), e);
      if (reason) throw new CompileError("E0101", `${message}: ${reason}`, e.start, e.end);
      this.excess(e, to);
      return;
    }
    const sub = this.recOf(type);
    if (sub?.kind === "class" && tr?.kind === "map" && this.embeddedOf(type)) {
      throw new CompileError("E0704", `'${sub.name}' extends '${this.ctx.tables.typing.show(to)}' by embedding one, so it can't be used as '${this.ctx.tables.typing.show(to)}'; take '${sub.name}' itself, or hold the collection in a field and pass that`, e.start, e.end);
    }
    if (sub?.kind === "class" && tr?.kind === "class" && this.ctx.tables.typing.derives(type as ClassType, to as ClassType)) {
      throw new CompileError("E0704", `'${sub.name}' extends '${tr.name}' by embedding one, so it can't be used as '${tr.name}'; extract an interface both classes implement`, e.start, e.end);
    }
    if (sub?.kind === "ref" && tr?.kind === "ref" && !this.ctx.tables.typing.fits(type, to)) {
      // A shared reference to something narrower lends a copy of what this one points to.
      if (!tr.mutable && this.ctx.tables.typing.fits(sub.to, tr.to)) {
        this.ctx.coercions.set(e, to);
        return;
      }
      if (!tr.mutable) throw new CompileError("E0101", message, e.start, e.end);
      const reason = !sub.mutable ? "a shared reference can't lend itself as mutable" : `only a reference to exactly '${this.ctx.tables.typing.show(tr.to)}' can be lent mutably`;
      throw new CompileError("E0101", `${message}: ${reason}`, e.start, e.end);
    }
    if (!this.ctx.tables.typing.fits(type, to) && !this.builds(e, type, to)) throw new CompileError("E0101", message, e.start, e.end);
    // An instance's concrete class may give a field its bound declares with a getter, which
    // copying field by field can't read, so that copy is rejected in the instance.
    if (this.ctx.tables.typing.lower(type) !== type && !this.ctx.tables.typing.fits(this.ctx.tables.typing.lower(type), this.ctx.tables.typing.lower(to))) throw new CompileError("E0101", message, e.start, e.end);
    this.excess(e, to);
    this.ctx.coercions.set(e, to);
  }

  /** @throws {CompileError} */
  private compared(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): Type {
    const special = this.jsEmpty(e) ?? typeofComparison(e, this) ?? this.equality(e) ?? unionComparison(e, this);
    return special ?? binaryType(this.ctx.tables.typing, e.op, ...this.sameNumbers(e.left, this.operand(e.left), e.right, this.operand(e.right), true), e);
  }

  // Marks a narrowed variable compared with `null` or a literal to be read as declared; false when
  // there is none.
  private asDeclared(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): boolean {
    let marked = false;
    for (const [side, other] of [[e.left, e.right], [e.right, e.left]] as const) {
      const local = side.kind === "ident" ? this.localAt(side) : undefined;
      const plain = isEmpty(other, this.ctx.locals as NodeMap<Expr, LocalId>) || literalValue(other) !== undefined;
      if (!local || !plain || this.ctx.types.get(side) === local.type || this.ctx.narrowed(local.localId) === undefined) continue;
      this.ctx.exprsState.asDeclared.add(side);
      marked = true;
    }
    return marked;
  }

  // A value meeting a reference is lent rather than handed over. A place is lent where it
  // lives, so it must be exactly the type borrowed; a temporary is converted first. Lending
  // mutably needs a place that could be assigned.
  /** @throws {CompileError} */
  private borrow(this: Mut<this>, given: Ref<Expr>, type: Type, to: RefType, message: string): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.borrowNow(now, type, to, message);
    else this.borrowNow(given, type, to, message);
  }
  /** @throws {CompileError} */
  private borrowNow(this: Mut<this>, e: Ref<Expr>, type: Type, to: RefType, message: string): void {
    // A `?:` choosing between places lends whichever it chooses, where it lives.
    if (e.kind === "conditional" && [e.then, e.else].some((s) => this.ctx.types.has(s) && this.rooted(s))) {
      // A side read as its value before is lent instead.
      for (const side of [e.then, e.else].filter((s) => this.ctx.types.has(s))) {
        this.ctx.coercions.delete(side);
        this.coerce(side, this.ctx.types.get(side)!, to, message);
      }
      this.ctx.types.set(cloneExpr(e), to);
      return;
    }
    // A literal lent is a temporary: it meets the type referred to, as its own literals do.
    if ((e.kind === "object" || e.kind === "array") && !this.ctx.tables.typing.fits(type, this.ctx.tables.typing.rec(to).to)) {
      this.coerce(e, type, this.ctx.tables.typing.rec(to).to, message);
      type = this.ctx.coercions.get(e) ?? this.ctx.types.get(e)!;
    }
    // A narrowed variable lent mutably is lent whole, as declared.
    const lent = e.kind === "ident" && this.ctx.tables.typing.rec(to).mutable ? this.localAt(e) : undefined;
    // Lent as the member a check narrowed it to, it keeps that member, and the check holds.
    if (lent && !this.ctx.tables.typing.holdsRef(lent.type) && this.ctx.tables.typing.sameLowered(lent.type, this.ctx.tables.typing.rec(to).to)) {
      this.ctx.lendsWhole(lent.localId, e);
      this.ctx.types.set(e, lent.type);
      type = lent.type;
    }
    // So is a narrowed field.
    const whole = e.kind === "member" && this.ctx.tables.typing.rec(to).mutable && this.isNarrowedField(e) ? this.ctx.tables.typing.unfolded(this.stored(e)) : undefined;
    if (whole !== undefined && this.ctx.tables.typing.sameLowered(whole, this.ctx.tables.typing.rec(to).to)) {
      this.ctx.instance.narrowedFields!.delete(e);
      this.ctx.types.set(e, whole);
      type = whole;
    }
    const exact = this.ctx.tables.typing.sameLowered(type, this.ctx.tables.typing.rec(to).to);
    // A type that holds itself may lend a part of a parameter's value as the parameter's type,
    // which each instance checks against the type it is made for.
    const part = this.ctx.tables.typing.partOfItself(type, this.ctx.tables.typing.rec(to).to);
    if (!exact && !part && !this.ctx.tables.typing.fits(type, this.ctx.tables.typing.rec(to).to)) throw new CompileError("E0101", message, e.start, e.end);
    const unlocked = this.ctx.tables.typing.rec(to).mutable ? this.ctx.tables.typing.unlocks(type, this.ctx.tables.typing.rec(to).to) : undefined;
    if (unlocked) throw new CompileError("E0206", `'${unlocked}' is read-only here, so it can't be lent mutably as '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(to).to)}', which could change it`, e.start, e.end);
    const through = this.ctx.tables.typing.rec(to).mutable ? this.copied(e) : undefined;
    if (through) throw new CompileError("E0206", `can't lend this mutably through '${through}', which would lend a copy; check '!== null' first and lend the variable`, e.start, e.end);
    if (this.ctx.tables.typing.rec(to).mutable && this.readCopy(e)) throw new CompileError("E0211", "this is part of a value read through a Dyn, which gives a copy, so lending it mutably would change only the copy; change it through a method", e.start, e.end);
    // A shared borrow of anything but such a place lends a copy, but a mutable one of anything
    // that isn't a temporary must reach the place.
    if (this.ctx.tables.typing.rec(to).mutable && this.rooted(e)) {
      if (!this.place(e) || !this.inPlace(e, to)) {
        throw new CompileError("E0101", `${message}: only a place holding exactly '${this.ctx.tables.typing.show(this.ctx.tables.typing.rec(to).to)}' can be lent mutably`, e.start, e.end);
      }
      this.changeable(e, "mutably borrow");
    }
    this.ctx.coercions.set(e, to);
  }

  // Whether an argument lends references to what it is passed to: borrowed, a reference, or
  // a value holding references.
  private lends(a: Ref<Expr>): boolean {
    return this.ctx.tables.typing.holdsRef(this.ctx.coercions.get(a) ?? this.ctx.types.get(a)!);
  }

  // Whether an `as` that only widens, or a `satisfies`, hands on a `?:` its operand chooses, through
  // any further such wrappers or `unsafe { }`.
  private handsOnChoice(e: Ref<Expr>): boolean {
    if (e.kind === "as" && (isConstAssertion(e) || !this.widening(e))) return false;
    if (e.kind !== "as" && e.kind !== "satisfies") return false;
    let inner = this.ctx.tables.rewrites.current(e.expr);
    while (inner.kind === "unsafe" || inner.kind === "satisfies" || (inner.kind === "as" && !isConstAssertion(inner) && this.widening(inner))) inner = this.ctx.tables.rewrites.current(inner.expr);
    return inner.kind === "conditional";
  }

  // Whether an `as` widens, rather than converting a number, a bigint or a pointer or checking
  // a union's tag.
  private widening(this: Mut<this>, e: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): boolean {
    const [from, to] = [this.ctx.coercions.get(e.expr) ?? this.ctx.types.get(e.expr), this.ctx.types.get(e)];
    if (from !== undefined && to !== undefined && this.recOf(from)?.kind === "union" && from !== to && !this.ctx.tables.typing.fits(from, to)) return false;
    return to !== undefined && !isNumeric(to) && to !== "bigint" && this.recOf(to)?.kind !== "pointer";
  }

  // Whether an expression reaches into a variable or `this`, rather than being a temporary.
  private rooted(this: Mut<this>, given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.rootedNow(now) : this.rootedNow(given);
  }
  private rootedNow(this: Mut<this>, e: Ref<Expr>): boolean {
    while ((e.kind === "member" && !this.ctx.calls.has(e)) || this.element(e)) e = e.object;
    return e.kind === "this" || (e.kind === "ident" && this.ctx.lookup(e.name, undefined) !== undefined);
  }

  // Whether a check narrowed a field read.
  private isNarrowedField(e: Ref<Expr>): boolean {
    return this.ctx.instance.narrowedFields?.has(e) ?? false;
  }

  // Whether lending a place to `to` points to where it lives, rather than to a copy: it holds
  // exactly that type, and isn't a variable or field narrowed to part of a union.
  /** @throws {CompileError} */
  private inPlace(e: Ref<Expr>, to: RefType): boolean {
    const type = this.ctx.types.get(e)!;
    const local = e.kind === "ident" ? this.localAt(e) : undefined;
    const ref = this.recOf(type);
    const held = ref?.kind === "ref" ? ref.to : type;
    if (local && local.type !== type && this.recOf(held)?.kind === "union") return false;
    // A field narrowed to one member lives inside its union, where it is stored as declared.
    const declared = this.ctx.instance.narrowedFields?.get(e);
    if (declared !== undefined && (this.recOf(type)?.kind === "union" || this.ctx.tables.typing.lower(this.ctx.tables.typing.unfolded(this.stored(e))) !== this.ctx.tables.typing.lower(declared))) return false;
    // A field read through a type parameter may be stored as a different type by the concrete
    // type; at a definition, where nothing is concrete, each instance decides.
    if (e.kind === "member" && declared === undefined && this.ctx.tables.typing.lower(this.stored(e)) !== this.ctx.tables.typing.lower(type)) return false;
    return typeof type !== "string" && this.ctx.tables.typing.rec(type).kind === "ref" ? this.ctx.tables.typing.fits(type, to) : (this.ctx.tables.typing.sameLowered(type, this.ctx.tables.typing.rec(to).to) && this.ctx.tables.typing.sameLowered(this.ctx.tables.typing.rec(to).to, type)) || this.ctx.tables.typing.partOfItself(type, this.ctx.tables.typing.rec(to).to);
  }

  // Without lifetimes, a reference variable can only be pointed at something that lives as long
  // as it: a place lent where it lives, or another reference variable, declared in its own
  // scope or an enclosing one.
  /** @throws {CompileError} */
  private rebind(this: Mut<this>, target: Local, e: Ref<Expr>) {
    const to = target.type as RefType;
    // A `?:`, or a call's result, lives as long as what it points into.
    if (e.kind === "conditional") {
      if (this.ctx.types.has(e.then)) this.rebind(target, e.then);
      if (this.ctx.types.has(e.else)) this.rebind(target, e.else);
      return;
    }
    const from = this.ctx.borrowsFrom.get(e);
    if (from) {
      from.forEach((s) => this.rebind(target, s));
      return;
    }
    let root: Expr = e;
    while (root.kind === "member" && !this.ctx.calls.has(root)) root = root.object;
    const local = root.kind === "ident" ? this.localAt(root) : undefined;
    const lives = root.kind === "this" || (local !== undefined && this.ctx.depthOf(local.localId) <= this.ctx.depthOf(target.localId));
    if (!lives || !this.place(e) || !this.inPlace(e, to)) {
      throw new CompileError("E0204", `'${target.name}' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as '${target.name}'`, e.start, e.end);
    }
  }

  // The member holding references an object literal meeting a union goes into: the one object
  // member whose literal fields its literal properties all match, as a tag picks it.
  private lentMember(e: Ref<Extract<Expr, { kind: "object" }>>, to: UnionType): ObjectType | undefined {
    const found = this.ctx.tables.typing.rec(to).members.filter((m): m is ObjectType => {
      if (this.recOf(m)?.kind !== "object" || !this.ctx.tables.typing.holdsRef(m)) return false;
      return this.ctx.tables.typing.rec(m as ObjectType).fields.every((f) => {
        const r = this.recOf(f.type);
        if (r?.kind !== "literal") return true;
        const p = this.winner(e, f.name);
        return p?.kind === "property" && literalValue(p.value) === r.value;
      });
    });
    return found.length === 1 ? found[0] : undefined;
  }

  // An object literal meeting a type with fields holding references lends each property to
  // its field, so the literal holds what it borrows.
  /** @throws {CompileError} */
  private lendFields(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>, to: ObjectType, message: string): Type {
    const own = this.ctx.types.get(e) as ObjectType;
    const lent = this.ctx.tables.typing.rec(own).fields.map((f) => {
      const want = this.ctx.tables.typing.field(to, f.name)?.type;
      const p = this.winner(e, f.name);
      if ((want === undefined) || (p === undefined) || p.kind === "spread" || !this.ctx.tables.typing.holdsRef(want) || this.ctx.tables.typing.fits(f.type, want)) return f;
      if (p.kind === "property") this.coerce(p.value, this.ctx.types.get(p.value)!, want, message);
      else if (p.kind === "shorthand") {
        // A shorthand lends its variable where it lives, so only as exactly what it holds.
        const local = this.localAt(p)!;
        const wr = this.recOf(want);
        if (wr?.kind !== "ref" || wr.mutable || this.ctx.tables.typing.lower(local.type) !== this.ctx.tables.typing.lower(wr.to)) {
          throw new CompileError("E0101", `${message}: write '${p.name}: ${p.name}' to lend '${p.name}' here`, p.start, p.end);
        }
      }
      return { ...f, type: want };
    });
    const type = this.ctx.tables.typing.objectType(lent);
    this.ctx.types.set(e, type);
    return type;
  }

  // An object literal builds a class it is declared as, without its constructor, when it
  // gives every field and the class has no field hidden from it. Nested literals may build
  // the classes of nested fields.
  /** @throws {CompileError} */
  private builds(this: Mut<this>, given: Ref<Expr>, type: Type, to: Type): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.buildsNow(now, type, to) : this.buildsNow(given, type, to);
  }
  /** @throws {CompileError} */
  private buildsNow(this: Mut<this>, e: Ref<Expr>, type: Type, to: Type): boolean {
    const c = this.recOf(to);
    if (e.kind !== "object" || typeof type === "string" || c?.kind !== "class") return false;
    this.cls(to as ClassType);
    for (const f of this.ctx.tables.typing.allFields(to as ClassType)) {
      if ((f.access ?? "public") !== "public") {
        throw new CompileError("E0709", `an object literal can't build '${c.name}' because '${f.name}' is ${f.access}; use 'new'`, e.start, e.end);
      }
      const given = this.ctx.tables.typing.field(type, f.name);
      if (!given) {
        throw new CompileError("E0101", `property '${f.name}' is missing in type '${this.ctx.tables.typing.show(type)}' but required in type '${c.name}'`, e.start, e.end);
      }
      const prop = e.props.find((p) => p.kind === "property" && p.key === f.name);
      if (!this.ctx.tables.typing.fits(given.type, f.type) && !(prop?.kind === "property" && this.builds(prop.value, given.type, f.type))) {
        throw new CompileError("E0101", `type '${this.ctx.tables.typing.show(given.type)}' is not assignable to type '${this.ctx.tables.typing.show(f.type)}'`, (prop ?? e).start, (prop ?? e).end);
      }
    }
    return true;
  }

  /** @throws {CompileError} */
  excess(this: Mut<this>, given: Ref<Expr>, to: Type): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.excessNow(now, to);
    else this.excessNow(given, to);
  }
  /** @throws {CompileError} */
  private excessNow(this: Mut<this>, e: Ref<Expr>, to: Type): void {
    to = this.ctx.tables.typing.unfold(to);
    if (e.kind !== "object" || typeof to === "string" || this.ctx.tables.typing.isUnknown(to)) return;
    // Against a union, a name no member has is excess, and the literal is checked as the one
    // member that has all its names, when one does.
    const u = this.ctx.tables.typing.rec(to);
    if (u.kind === "union") {
      let objects: Exclude<Type, string>[] = [];
      for (const member of u.members) {
        const t = this.ctx.tables.typing.unfold(member);
        const m = this.recOf(t);
        if (typeof t !== "string" && (m?.kind === "object" || m?.kind === "class")) objects.push(t);
      }
      if (objects.length === 0) return;
      let whole: Exclude<Type, string>[] = objects.slice();
      for (const p of e.props) {
        if (p.kind === "spread") continue;
        const name = propName(p);
        if (!objects.some((m) => this.ctx.tables.typing.field(m, name) !== undefined)) {
          throw new CompileError("E0101", `object literal may only specify known properties, and '${name}' does not exist in type '${this.ctx.tables.typing.show(to)}'`, p.start, p.end);
        }
        whole = whole.filter((m) => this.ctx.tables.typing.field(m, name) !== undefined);
      }
      if (whole.length === 1) this.excess(e, whole[0]!);
      return;
    }
    for (const p of e.props) {
      // A spread's fields aren't checked as excess, as in TypeScript.
      if (p.kind === "spread") continue;
      const name = propName(p);
      const found = this.ctx.tables.typing.field(to, name);
      if (found === undefined) {
        throw new CompileError("E0101", `object literal may only specify known properties, and '${name}' does not exist in type '${this.ctx.tables.typing.show(to)}'`, p.start, p.end);
      }
      if (p.kind === "property") this.excess(p.value, found.type);
    }
  }

  // Properties are checked in source order, which is the order they run in.
  // `{ ...a, x: 1, ...b }`: the fields of each part in order, a later one replacing an earlier one
  // of its name. A spread takes an object's fields, or an instance's public ones.
  /** @throws {CompileError} */
  private objectSpread(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>): Type {
    const merged = new Map<string, Field>();
    const written = new Set<string>();
    // The spread a field comes from, when that spread copies a place rather than taking over a
    // value made for it.
    const copied = new Map<string, ObjectProp>();
    for (const p of e.props) {
      if (p.kind !== "spread") {
        const f = this.property(p);
        if (written.has(f.name)) throw new CompileError("E0402", `duplicate property '${f.name}'`, p.start, p.end);
        written.add(f.name);
        merged.delete(f.name);
        merged.set(f.name, f);
        copied.delete(f.name);
        continue;
      }
      const t = this.value(p.value);
      const low = this.ctx.tables.typing.lowerKeepingBrands(this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t);
      // An object-typed parameter stands for any type with its fields, which its bound names.
      const lr = this.recOf(low);
      const br = lr?.kind === "param" ? this.recOf(lr.bound) : undefined;
      const heldType = br?.kind === "object" ? (lr as ParamRecord).bound! : low;
      const held = this.recOf(heldType);
      if (held === undefined || (held.kind !== "object" && held.kind !== "class") || this.ctx.tables.typing.isTuple(heldType)) {
        throw new CompileError("E0119", `'...' in an object literal spreads an object or an instance, not '${this.ctx.tables.typing.show(t)}'`, p.start, p.end);
      }
      if (this.ctx.tables.typing.holdsRef(heldType)) throw unsupported("spreads of values holding references", p);
      if (rustClassOf(this.ctx.tables.typing, heldType)) throw new CompileError("E1004", `a Rust '${rustClassOf(this.ctx.tables.typing, heldType)!.name}' has no fields Fish can read, so it can't be spread; call its methods for what it holds`, p.start, p.end);
      const parts = held.kind === "class" ? this.ctx.tables.typing.allFields(heldType as ClassType).filter((f) => (f.access ?? "public") === "public") : held.fields;
      const place = this.copiesPlace(p.value);
      for (const f of parts) {
        merged.delete(f.name);
        merged.set(f.name, { name: f.name, type: f.type });
        if (place) copied.set(f.name, p);
        else copied.delete(f.name);
      }
    }
    // A spread of a place copies the fields it gives, which must be ones a clone may copy; its
    // Dyns copy one by one, as an array method's elements do.
    for (const [name, p] of copied) this.clonable(merged.get(name)!.type, p, undefined, true);
    return this.ctx.tables.typing.objectType([...merged.values()]);
  }

  // Whether a value may be a place's, which taking it copies: a place, or any branch of `!`,
  // `?:`, `??` or a `match` giving one, a match arm's block through its `return`s. A place here
  // is what codegen copies rather than takes over: any field read but a getter's, a shared
  // value's copy or one the runtime computes, through unions and optional chains too.
  private copiesPlace(this: Mut<this>, e: Ref<Expr>): boolean {
    // A reference, whatever gives it, is read where its value lives; an assignment gives its
    // target's value.
    const given = this.ctx.types.get(e);
    if ((given !== undefined && this.isRefType(given)) || e.kind === "assign") return true;
    if (e.kind === "nonNull" || (e.kind === "as" && this.recOf(this.ctx.coercions.get(e.expr) ?? this.ctx.types.get(e.expr))?.kind === "union" && !this.ctx.tables.typing.fits(this.ctx.coercions.get(e.expr) ?? this.ctx.types.get(e.expr)!, given!))) return this.copiesPlace(e.expr);
    if (e.kind === "conditional") return (this.ctx.types.has(e.then) && this.copiesPlace(e.then)) || (this.ctx.types.has(e.else) && this.copiesPlace(e.else));
    if (e.kind === "binary" && e.op === "??") return this.copiesPlace(e.left) || this.copiesPlace(e.right);
    if (e.kind === "match") return e.arms.some((a) => (a.body.kind === "block" ? this.armReturns(a.body).some((x) => this.copiesPlace(x)) : this.copiesPlace(a.body)));
    if (e.kind === "member") return !this.ctx.calls.has(e) && !this.ctx.copiesOut.has(e) && !this.ctx.tables.computed.has(e);
    if (e.kind === "index") return this.element(e);
    return e.kind === "ident" || e.kind === "this";
  }

  // The values a match arm's block gives, through its own `return`s, not those of functions in it.
  private armReturns(block: Ref<Stmt>): Expr[] {
    const found: Expr[] = [];
    walkWhile({ of: "stmt", node: block }, (n) => {
      if ((n.of === "expr" && n.node.kind === "arrow") || (n.of === "stmt" && n.node.kind === "function")) return false;
      if (n.of === "stmt" && n.node.kind === "return" && (n.node.value !== undefined)) found.push(n.node.value);
      return true;
    });
    return found;
  }

  /** @throws {CompileError} */
  private property(this: Mut<this>, p: Ref<ObjectProp>): Field {
    const field = this.propertyField(p);
    // A generic function value is held as it is, captures nothing, and is called by name.
    const fr = this.recOf(field.type);
    if (fr?.kind === "closure" && (fr.generic !== undefined)) return field;
    // A value for a field the object's type holds a Dyn in is boxed into it.
    const boxed = p.kind === "property" ? this.ctx.exprsState.wanted.get(p.value) : undefined;
    // `null`, or an Option, already is what an optional Dyn field holds.
    const plain = this.ctx.tables.typing.lower(field.type);
    const already = plain === "null" || (typeof plain !== "string" && this.ctx.tables.typing.rec(plain).kind === "union") || (boxed !== undefined && plain === this.ctx.tables.typing.lower(boxed));
    if (p.kind === "property" && boxed !== undefined && typeof boxed !== "string" && this.recOf(boxed)?.kind === "dyn" && !already) {
      this.coerce(p.value, field.type, boxed, `type '${this.ctx.tables.typing.show(field.type)}' is not assignable to type '${this.ctx.tables.typing.show(boxed)}'`);
      return { ...field, type: boxed };
    }
    // An arrow written for a field the object's type stores a callable in is boxed into it.
    const want = p.kind === "property" ? this.ctx.exprsState.wanted.get(p.value) : undefined;
    if (typeof field.type !== "string" && this.ctx.tables.typing.rec(field.type).kind === "closure" && (want !== undefined) && this.isCallable(want)) {
      this.coerce((p as Extract<ObjectProp, { kind: "property" }>).value, field.type, want, `type '${this.ctx.tables.typing.show(field.type)}' is not assignable to type '${this.ctx.tables.typing.show(want)}'`);
      return { ...field, type: want };
    }
    // With no type to say which, a sync arrow is stored as a callable of its own signature.
    const fn = this.recOf(field.type);
    if (fn?.kind === "closure" && p.kind === "property" && this.recOf(fn.returns)?.kind !== "future") {
      const own = this.ctx.tables.typing.callableFrom({ kind: "function", name: fn.name, names: fn.params.map((_, i) => `p${i}`), params: fn.params, returns: fn.returns, ...(fn.throws && { throws: fn.throws }), fields: [] });
      this.coerce(p.value, field.type, own, `type '${this.ctx.tables.typing.show(field.type)}' is not assignable to type '${this.ctx.tables.typing.show(own)}'`);
      return { ...field, type: own };
    }
    if (typeof field.type !== "string" && this.ctx.tables.typing.rec(field.type).kind === "closure") throw unsupported("functions stored in objects", p);
    return field;
  }

  /** @throws {CompileError} */
  private propertyField(this: Mut<this>, p: Ref<ObjectProp>): Field {
    if (p.kind === "property") {
      // An object stores its fields, so an arrow written in one owns what it captures.
      if (p.value.kind === "arrow") this.ctx.exprsState.owning.add(p.value);
      const type = this.value(p.value);
      // A value written `as const` keeps its literal type.
      if (isConstAssertion(this.ctx.tables.rewrites.current(p.value))) return { name: p.key as string, type };
      const widened = this.ctx.tables.typing.widenLet(type);
      if (widened !== type) this.coerce(p.value, type, widened, "");
      return { name: p.key as string, type: widened };
    }
    if (p.kind !== "shorthand") {
      throw unsupported(p.kind === "spread" ? "spread elements" : p.kind === "method" ? "methods in object literals" : "accessors in object literals", p);
    }
    if ((p.default !== undefined)) throw new CompileError("E0004", "'=' in an object literal is only valid in a destructuring pattern", p.start, p.end);
    // A shorthand reads its variable like a name does: within its switch case, narrowed, and
    // widened from an enum member to the enum like any property.
    const localId = this.ctx.lookup(p.name, p);
    const local = localId === undefined ? undefined : this.lc(localId);
    if (!local) throw new CompileError("E0401", `cannot find name '${p.name}'${didYouMean(p.name, this.ctx.names(p.start))}`, p.start, p.end);
    if (!this.ctx.reachable(local.localId)) {
      throw new CompileError("E0403", `'${p.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, p.start, p.end);
    }
    this.ctx.locals.set(p, local.localId);
    const js = this.ctx.tables.typing.jsRead(local.type, this.ctx.narrowed(local.localId));
    if (js === "one") throw new CompileError("E1005", `'${p.name}' is read out of JS as a '${this.ctx.tables.typing.show(this.ctx.narrowed(local.localId)!)}' here; write '${p.name}: ${p.name}'`, p.start, p.end);
    if (js === "several") return { name: p.name, type: this.stillJs(local.type) };
    return { name: p.name, type: this.ctx.tables.typing.widenEnum(this.ctx.narrowed(local.localId) ?? local.type) };
  }

  // What a variable holding a JsValue reads as where `typeof` left several kinds of JS value:
  // the JsValue, taken out of a union holding it, through a reference too.
  private stillJs(this: Mut<this>, t: Type): Type {
    if (this.isRefType(t)) {
      const to = this.stillJs(this.ctx.tables.typing.rec(t).to);
      return this.ctx.tables.typing.refType(to, this.ctx.tables.typing.rec(t).mutable);
    }
    const u = this.recOf(t);
    return u?.kind === "union" ? u.members.find((t) => this.ctx.tables.typing.isPlainJs(t))! : t;
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  /** @throws {CompileError} */
  private assignable(this: Mut<this>, target: Ref<Expr>, reads: boolean): Type {
    const now = this.ctx.tables.rewrites.rewritten(target);
    return now !== undefined ? this.assignableWritten(target, now, reads) : this.assignableWritten(target, target, reads);
  }
  // The place a write changes is what it names, through a `!`.
  /** @throws {CompileError} */
  private assignableWritten(this: Mut<this>, target: Ref<Expr>, written: Ref<Expr>, reads: boolean): Type {
    if (written.kind !== "nonNull") return this.assignableAt(target, written, reads);
    const now = this.ctx.tables.rewrites.rewritten(written.expr);
    return now !== undefined ? this.assignableAt(target, now, reads) : this.assignableAt(target, written.expr, reads);
  }
  /** @throws {CompileError} */
  private assignableAt(this: Mut<this>, target: Ref<Expr>, place: Ref<Expr>, reads: boolean): Type {
    const outer = this.ctx.exprsState.writing;
    const updating = this.ctx.exprsState.updating;
    this.ctx.exprsState.writing = target.id;
    this.ctx.exprsState.updating = reads ? place.id : undefined;
    try {
      const type = this.assignableTo(target, reads);
      // A field narrowed to one member, read and written back as `+=` does, keeps that member in
      // its union's payload; any other write is of the place as declared.
      const declared = reads ? this.ctx.instance.narrowedFields?.get(place) : undefined;
      const kept = declared === undefined ? undefined : this.ctx.narrowedField(place);
      const stored = kept !== undefined && this.recOf(kept)?.kind !== "union" ? this.stored(place) : undefined;
    if (kept !== undefined && stored !== undefined && this.ctx.tables.typing.lower(this.ctx.tables.typing.unfolded(stored)) === this.ctx.tables.typing.lower(declared!)) {
        this.ctx.types.set(cloneExpr(place), kept);
        return kept;
      }
      this.ctx.instance.narrowedFields?.delete(place);
      if (reads && this.ctx.tables.jsMembers.has(target)) throw unsupported("compound assignments to a package's properties", target);
      return type;
    } finally {
      this.ctx.exprsState.writing = outer;
      this.ctx.exprsState.updating = updating;
    }
  }

  // Whether a `!` is on a value that can't be empty, decided where the `!` is first checked and
  // marked there. Only `null` itself is always empty.
  /** @throws {CompileError} */
  private redundant(this: Mut<this>, e: Ref<Extract<Expr, { kind: "nonNull" }>>, given: Type): boolean {
    if ((this.ctx.tables.rewrites.current(e) as Bang).redundant === undefined) this.ctx.asWritten();
    const bang = this.ctx.tables.rewrites.current(e) as Bang;
    if (bang.redundant !== undefined) return bang.redundant;
    const held = this.isRefType(given) ? this.ctx.tables.typing.rec(given).to : given;
    if (held === "null") throw new CompileError("E0108", "'!' takes the value out of an Option, and this is a 'null', which is always empty", e.start, e.end);
    const marked: Bang = { ...bang, redundant: !this.ctx.tables.typing.isOption(held) };
    this.ctx.tables.rewrites.replace(e, marked as Expr);
    return marked.redundant!;
  }

  /** @throws {CompileError} */
  private assignableTo(this: Mut<this>, target: Ref<Expr>, reads: boolean): Type {
    // Only a `!` that can't fail is a place: the place it is written on.
    if (target.kind === "nonNull") {
      const type = this.assignableTo(target.expr, reads);
      if (!this.redundant(target, this.ctx.types.get(target.expr)!)) throw new CompileError("E0003", "can only assign to a variable or a field", target.start, target.end);
      this.ctx.types.set(target, this.ctx.types.get(target.expr)!);
      return type;
    }
    this.untuple(target);
    target = this.ctx.tables.rewrites.current(target);
    if ((target.kind === "member" || target.kind === "index") && target.object.kind === "ident") this.ctx.exprsState.objects.add(target.object);
    const setter = target.kind === "member" ? this.accessor(target) : undefined;
    intoMember(this.ctx.tables.typing, target, this.ctx.types);
    const indexed = target.kind === "index" ? this.read(target.object) : undefined;
    if (indexed !== undefined && stringLike(this.ctx.tables.typing, indexed)) {
      throw new CompileError("E0802", "strings can't be changed; build a new one instead, joining parts with '+'", target.start, target.end);
    }
    if (indexed !== undefined && this.ctx.tables.typing.isPlainJs(indexed)) throw new CompileError("E1005", "writing a JS value's elements isn't supported yet; a 'JsValue' is read with 'at'", target.start, target.end);
    const holder = target.kind === "member" ? this.ctx.types.get(target.object) : undefined;
    if (holder && this.isArray(this.isRefType(holder) ? this.ctx.tables.typing.rec(holder).to : holder)) {
      const { name } = target as { name: string };
      const capacity = name === "capacity";
      if (TYPED_MEMBERS.has(name)) throw new CompileError("E0208", `a typed array's '${name}' can't be set`, target.start, target.end);
      throw new CompileError("E0208", capacity ? "an array's 'capacity' can't be set; use 'reserve(n)' to make room, or 'shrinkToFit()' to give it back" : "an array's 'length' can't be set; use 'pop()' to remove elements, or 'push' to add them", target.start, target.end);
    }
    const table = holder && (this.isRefType(holder) ? this.ctx.tables.typing.rec(holder).to : holder);
    if (table && typeof table !== "string" && this.ctx.tables.typing.rec(table).kind === "map") {
      throw new CompileError("E0208", "a Map's or a Set's 'size' can't be set; use 'delete' or 'clear' to remove entries", target.start, target.end);
    }
    if (holder && stringLike(this.ctx.tables.typing, this.isRefType(holder) ? this.ctx.tables.typing.rec(holder).to : holder)) {
      throw new CompileError("E0802", `a string's '${(target as { name: string }).name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    }
    // A top-level const, or a part of one, was computed while compiling and never changes.
    let root: Expr = target;
    while (root.kind === "member" || root.kind === "index" || root.kind === "nonNull") root = root.kind === "nonNull" ? root.expr : root.object;
    if (root.kind === "ident" && (this.ctx.lookup(root.name, undefined) === undefined) && this.ctx.byName.has(`const ${root.name}`)) {
      throw new CompileError("E0207", `'${root.name}' is a top-level const, computed while compiling, so it never changes; a global that changes is a const holding an Atomic or a Lock`, target.start, target.end);
    }
    if (!this.place(target)) throw new CompileError("E0003", "can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      const read = this.value(target);
      // Below a read through a Dyn, the place is part of a copy.
      if (!this.ctx.tables.computed.has(target) && this.readCopy(target)) throw new CompileError("E0211", "this is part of a value read through a Dyn, which gives a copy, so writing it would change only the copy; change it through a method", target.start, target.end);
      if (this.ctx.tables.computed.has(target)) {
        const holder = this.ctx.types.get((target as Extract<Expr, { kind: "member" }>).object);
        // A JS handle's property is written in JS, whatever holds the handle.
        const handle = holder === undefined ? undefined : this.ctx.tables.typing.jsShape(this.isRefType(holder) ? this.ctx.tables.typing.rec(holder).to : holder);
        const field = this.recOf(handle)?.fields.find((f) => f.name === (target as { name: string }).name);
        if (field) {
          if (field.readonly) throw new CompileError("E0208", `'${field.name}' is read-only in its declaration`, target.start, target.end);
          return this.crossing(field.type, `property '${field.name}' is a`, target);
        }
        const hr = this.recOf(holder);
        const through = hr?.kind === "dyn" || (hr?.kind === "ref" && this.recOf(hr.to)?.kind === "dyn");
        throw new CompileError(through ? "E0211" : "E0208", through ? "writing a field through a Dyn isn't supported yet; change it through a method" : `'${(target as { name: string }).name}' is read-only: the runtime keeps it`, target.start, target.end);
      }
      // A whole value assigned to a mutable reference is written through it, to what it was
      // declared to point to, whatever a check narrowed it to. An update like `+=` keeps the
      // member, so it goes through the narrowed reference.
      const declared = target.kind === "ident" && !reads ? this.localAt(target)!.type : read;
      // A constructor's assignment to a field of `this` sets the field rather than writing through it.
      const initialises = target.kind === "member" && target.object.kind === "this" && this.ctx.self?.constructor && this.ctx.tables.typing.rec(this.ctx.self.type).fields.some((f) => f.name === target.name);
      if ((target.kind === "ident" || target.kind === "member") && !initialises && this.isRefType(declared) && this.ctx.tables.typing.rec(declared).mutable) {
        // What a type parameter stands for may be wider than any value written here.
        if (this.recOf(this.ctx.tables.typing.rec(declared).to)?.kind === "param") {
          throw new CompileError("E0206", `can't assign a whole value through '${this.placeText(target)}', which may point to a wider value; assign its fields instead`, target.start, target.end);
        }
        if (target.kind === "member") this.changeable(target, "assign to");
        else if (this.ctx.captured(this.localAt(target)!.localId)) this.ctx.changesCapture(this.localAt(target)!.localId, "", "assign to", target, true);
        this.ctx.types.set(target, declared);
        this.ctx.coercions.set(target, this.ctx.tables.typing.rec(declared).to);
        return this.ctx.tables.typing.rec(declared).to;
      }
      // A whole value goes in a variable as declared, whatever a check narrowed it to.
      if (target.kind === "ident" && !reads && declared !== read && !this.isRefType(declared)) {
        this.ctx.types.set(target, declared);
        this.ctx.copiesOut.delete(target);
      }
      intoMember(this.ctx.tables.typing, target, this.ctx.types);
      this.changeable(target, "assign to");
      const type = this.stored(target);
      this.ctx.types.set(target, type);
      return type;
    }
    const type = this.ctx.paramTypes(this.ctx.instanceOf(setter.bodyId, undefined))[0]!;
    if (reads && this.value(target) !== type) {
      throw new CompileError("E0705", `the getter and setter of '${target.name}' must have the same type`, target.start, target.end);
    }
    this.changeable(target, "assign to", true);
    this.ctx.setters.set(target, this.ctx.instanceOf(setter.bodyId, undefined));
    this.ctx.types.set(target, type);
    return type;
  }

  // The type a write stores. Read through a type parameter, a field has its bound's type, but
  // in an instance it is stored as the concrete type's field, which may be narrower.
  /** @throws {CompileError} */
  private stored(this: Mut<this>, target: Ref<Expr>): Type {
    if (target.kind !== "member") return this.ctx.types.get(target)!;
    // Through a reference, what it points to stores the field; a field a check narrowed holds
    // its member inside the union.
    const written = this.isNarrowedField(target.object) ? this.ctx.types.get(target.object)! : this.stored(target.object);
    const holder = this.ctx.tables.typing.lower(written);
    const hr = this.recOf(holder);
    const object = hr?.kind === "ref" ? this.ctx.tables.typing.lower(hr.to) : holder;
    if (stringLike(this.ctx.tables.typing, object)) throw new CompileError("E0802", `a string's '${target.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    if (typeof object !== "string" && this.ctx.tables.typing.rec(object).kind === "union") {
      throw new CompileError("E0109", `can't assign to '${target.name}' through '${this.ctx.tables.typing.show(object)}'; narrow it to one member first`, target.start, target.end);
    }
    const found = typeof object !== "string" ? this.ctx.tables.typing.field(object, target.name)?.type : undefined;
    // A pattern or brand the field was declared with is what a write must match, though lowering
    // made it a string or the brand's base.
    const declared = this.ctx.types.get(target)!;
    if (found !== undefined && (this.ctx.tables.typing.holdsPattern(declared) || this.ctx.tables.typing.holdsBrand(declared)) && this.ctx.tables.typing.lower(declared) === this.ctx.tables.typing.lower(found)) return declared;
    return found !== undefined ? found : declared;
  }

  // The setter an assignment to a class member runs, if it is an accessor. A getter alone
  // makes the property read-only.
  /** @throws {CompileError} */
  private accessor(this: Mut<this>, target: Ref<Extract<Expr, { kind: "member" }>>): Body | undefined {
    const object = this.ctx.tables.typing.lower(this.value(target.object));
    const or = this.recOf(object);
    if (or?.kind !== "class" || (this.ctx.tables.typing.field(object as ClassType, target.name) !== undefined)) return undefined;
    const c = this.cls(object as ClassType);
    const setter = inherited(this.ctx.tables.arenas, c, "setters", target.name);
    if ((setter === undefined) && inherited(this.ctx.tables.arenas, c, "getters", target.name)) {
      throw new CompileError("E0208", `cannot assign to '${target.name}' because it is a read-only property`, target.start, target.end);
    }
    if (setter) this.visible(setter.access, setter.declared ?? setter.owner!, target.name, target);
    return setter;
  }

  // A variable, `this`, or a field inside one: somewhere a value lives, rather than a
  // temporary.
  // A getter's result is a temporary, so a path through one isn't a place.
  private place(this: Mut<this>, given: Ref<Expr>): boolean {
    const now = this.ctx.tables.rewrites.rewritten(given);
    return now !== undefined ? this.placeNow(now) : this.placeNow(given);
  }
  private placeNow(this: Mut<this>, e: Ref<Expr>): boolean {
    for (e = this.bare(e); (e.kind === "member" && !e.optional && !this.ctx.calls.has(e)) || this.element(e); e = this.bare(e.object)) {
      // An enum's member, and a field every member of a union shares, are values, not places.
      const object = this.ctx.types.get(e.object);
      const held = typeof object !== "string" && this.recOf(object)?.kind === "ref" ? this.ctx.tables.typing.rec(object as RefType).to : object;
      if (!held || (typeof held !== "string" && this.ctx.tables.typing.rec(held).kind === "union")) return false;
    }
    return e.kind === "this" || (e.kind === "ident" && this.ctx.lookup(e.name, undefined) !== undefined);
  }

  // Checks that a place, already typed, may change. `const` is deeply immutable, so no field
  // of a constant can change, and `this` changes only in a constructor or a method declared
  // `this: Mut<this>`.
  // A setter changes its whole object, whatever field it is named for: `setter` says one runs.
  /** @throws {CompileError} */
  private changeable(this: Mut<this>, target: Ref<Expr>, action: string, setter = false) {
    target = this.ctx.tables.rewrites.current(target);
    // Below a read through a Dyn, the place is part of a copy.
    if (this.readCopy(target) && !this.ctx.tables.computed.has(target)) throw new CompileError("E0211", `cannot ${action} this: it is part of a value read through a Dyn, which gives a copy, so the change would be lost; change it through a method`, target.start, target.end);
    let root = this.bare(target);
    let path = "";
    // The part of the path naming the field the setter is for.
    let named: string | undefined;
    // Through a mutable reference anything below it may change, whatever variable holds the
    // reference, as long as nothing above it is shared.
    let throughMut = false;
    while (root.kind === "member" || this.element(root)) {
      if (root.kind === "member") this.readonly(root, target, action);
      const holder = this.ctx.types.get(root.object);
      const referred = typeof holder !== "string" && this.recOf(holder)?.kind === "ref" ? this.ctx.tables.typing.rec(holder as RefType).to : holder;
      if (typeof referred !== "string" && this.recOf(referred)?.kind === "shared") {
        const why = (this.ctx.tables.typing.rec(referred as SharedType)).which === "shared" ? "is shared between threads" : "is an 'Rc', whose value every clone of it reads";
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(this.bare(root.object))}' ${why}; change it inside '${this.placeText(this.bare(root.object))}.update(...)'`, target.start, target.end);
      }
      if (this.ctx.sharing && this.ctx.tables.typing.interiorMutable(this.ctx.types.get(root)!) && this.isParamPath(root)) {
        const why = this.ctx.counting ? `'${this.placeText(root)}' is borrowed where it lives, outside 'update'` : `other tasks borrow '${this.placeText(root)}' without the lock`;
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' inside 'update': ${why}, so it changes only through its own methods`, target.start, target.end);
      }
      if (typeof holder !== "string" && this.recOf(holder)?.kind === "ref" && this.ctx.tables.typing.rec(holder as RefType).mutable) throughMut = true;
      else if (typeof holder !== "string" && this.recOf(holder)?.kind === "ref") {
        throw new CompileError("E0206", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(this.bare(root.object))}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
      }
      // A rest tuple's element is named by its place in the tuple, its array left unsaid.
      if (root.kind === "index" && root.index.kind === "int" && this.ctx.tables.restStarts.has(root.object)) path = `[${BigInt(this.ctx.tables.restStarts.get(root.object)!) + root.index.value}]${path}`;
      else if (!(root.kind === "member" && this.ctx.tables.restStarts.has(root))) path = `${root.kind === "member" ? (/^\d+$/.test(root.name) ? `[${root.name}]` : `.${shownName(root.name)}`) : "[...]"}${path}`;
      // The last part, the field the setter is named for.
      named ??= path;
      root = this.bare(root.object);
    }
    if (this.ctx.sharing && path === "" && this.isParamPath(root)) {
      const whole = this.ctx.types.get(root)!;
      const wr = this.recOf(whole);
      if (this.ctx.tables.typing.interiorMutable(wr?.kind === "ref" ? wr.to : whole)) {
        const why = this.ctx.counting ? "its interior-mutable fields are borrowed where they live, outside 'update'" : "other tasks borrow its interior-mutable fields without the lock";
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' as a whole inside 'update': ${why}; change its other fields one by one`, target.start, target.end);
      }
    }
    // A setter may change any field of its object, as a method taking `Mut<this>` may.
    if (setter && target.kind === "member") this.ctx.changesPath(root.kind === "ident" ? this.localAt(root)!.localId : "this", path.slice(0, path.length - named!.length), `call the setter of '${target.name}' on`, target.object);
    if (root.kind === "this" || root.kind === "super") return this.changesThis(path, action, target);
    this.changesLocal(this.localAt(root)!.localId, path, action, target, throughMut);
  }

  // A value moved into a new `Dyn`: its type implements the interface, and owns everything and
  // changes only under locks, since a Dyn hides what it holds from every later check and may
  // cross to another thread.
  /** @throws {CompileError} */
  private boxing(this: Mut<this>, given: Ref<Expr>, type: Type, to: DynType, message: string): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.boxingNow(now, type, to, message);
    else this.boxingNow(given, type, to, message);
  }
  /** @throws {CompileError} */
  private boxingNow(this: Mut<this>, e: Ref<Expr>, type: Type, to: DynType, message: string): void {
    if (this.ctx.tables.typing.promiseElement(this.ctx.tables.typing.rec(to).of) !== undefined) return this.boxingFuture(e, this.ctx.tables.typing.lower(type), to, message);
    if (this.relaying(this.ctx.tables.typing.lower(type), to)) {
      if (this.isRefType(this.ctx.types.get(e)!)) throw new CompileError("E0202", "can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
      this.ctx.tables.dynMembers.set(`${this.ctx.tables.typing.keyOf(this.ctx.tables.typing.lower(type))} ${this.ctx.tables.typing.keyOf(this.ctx.tables.typing.lower(to))}`, { methods: [], fields: [], clone: "copy" });
      return void this.ctx.coercions.set(e, to);
    }
    if (this.ctx.tables.typing.callableOf.has(this.ctx.tables.typing.rec(to).of)) this.storing(e, this.ctx.tables.typing.lower(type), to, message);
    else if (this.isRefType(this.ctx.types.get(e)!)) throw new CompileError("E0202", "can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
    const held = this.ctx.tables.typing.lower(type);
    if (typeof held !== "string" && this.ctx.tables.typing.rec(held).kind === "dyn") throw new CompileError("E0801", `a '${this.ctx.tables.typing.show(held)}' can't become a '${this.ctx.tables.typing.show(to)}' yet; box the value it was made from`, e.start, e.end);
    let rust: RustClass | undefined;
    if (this.ctx.tables.typing.holdsPart(held, (u) => (rust ??= rustClassOf(this.ctx.tables.typing, u)) !== undefined)) throw new CompileError("E1004", `a Rust '${rust!.name}' can't become a '${this.ctx.tables.typing.show(to)}' yet; call its methods on it, or take it as a generic parameter`, e.start, e.end);
    const reason = this.ctx.tables.typing.callableOf.has(this.ctx.tables.typing.rec(to).of) ? undefined : unsatisfied(type, this.ctx.tables.typing.rec(to).of, this.ctx.members(), e);
    if (reason) throw new CompileError("E0101", `${message}: ${reason}`, e.start, e.end);
    const blocker = this.unsent(held);
    if (blocker) {
      const why = typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "pointer" ? "is a raw pointer no thread can vouch for" : typeof blocker !== "string" && this.ctx.tables.typing.rec(blocker).kind === "shared" ? COUNTED_UNLOCKED : "borrows from where it was made";
      throw new CompileError("E0303", `a '${this.ctx.tables.typing.show(to)}' may cross to another thread, so it can't hold a '${this.ctx.tables.typing.show(blocker)}', which ${why}`, e.start, e.end);
    }
    // A Dyn of a generic interface made in a generic body is keyed as codegen finds it, lowered.
    if (typeof held === "string" || this.ctx.tables.typing.rec(held).kind !== "param") {
      const table = this.dynTable(e, held, this.ctx.tables.typing.lower(to) as DynType);
      this.ctx.tables.dynMembers.set(`${this.ctx.tables.typing.keyOf(held)} ${this.ctx.tables.typing.keyOf(this.ctx.tables.typing.lower(to))}`, table);
      this.ctx.dynOf(e, table);
    }
    this.ctx.coercions.set(e, to);
  }

  // A stored callable held in one taking and giving the same, that throws what it throws or
  // more: its calls are passed on through a slot of their own.
  private relaying(from: Type, to: DynType): boolean {
    const d = this.recOf(from);
    const [f, g] = [this.recOf(d?.kind === "dyn" ? this.ctx.tables.typing.callableOf.get(d.of) : undefined), this.recOf(this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(to).of))];
    if (!f || !g || !g.throws || f.params.length !== g.params.length || this.ctx.tables.typing.lower(f.returns) !== this.ctx.tables.typing.lower(g.returns)) return false;
    return f.params.every((p, i) => this.ctx.tables.typing.lower(p) === this.ctx.tables.typing.lower(g.params[i]!)) && (!f.throws || this.ctx.tables.typing.fits(f.throws, g.throws));
  }

  // A future stored as a `Promise<T>`: one an async function's call made, giving T, throwing
  // nothing, and owning what it holds, since it may be awaited on any thread.
  /** @throws {CompileError} */
  private boxingFuture(this: Mut<this>, e: Ref<Expr>, type: Type, to: DynType, message: string) {
    const r = this.recOf(type);
    if (r?.kind === "param") return this.ctx.coercions.set(e, to), undefined;
    if (r?.kind !== "future" || type === YIELD_NOW || type === SLEEP || this.ctx.tables.typing.leafOf.has(type as FutureType)) {
      const what = r?.kind === "future" ? "; store the async function's call instead" : "";
      throw new CompileError("E0101", `${message}${what}`, e.start, e.end);
    }
    if (this.ctx.tables.typing.lower(r.gives) !== this.ctx.tables.typing.lower(this.ctx.tables.typing.promiseElement(this.ctx.tables.typing.rec(to).of)!)) throw new CompileError("E0101", message, e.start, e.end);
    if (r.throws) throw new CompileError("E0602", `a stored '${this.ctx.tables.typing.show(to)}' can't throw yet, and this one can throw '${this.ctx.tables.typing.show(r.throws)}'; await it where it is made, or catch inside the async function`, e.start, e.end);
    const blocker = this.unsent(type);
    if (blocker) throw new CompileError("E0303", `a stored '${this.ctx.tables.typing.show(to)}' may be awaited on any thread, so its future can't hold a '${this.ctx.tables.typing.show(blocker)}'`, e.start, e.end);
    this.ctx.tables.dynMembers.set(`${this.ctx.tables.typing.keyOf(type)} ${this.ctx.tables.typing.keyOf(to)}`, { methods: [], fields: [], clone: undefined });
    this.ctx.coercions.set(e, to);
  }

  // A closure stored as a callable: it fits the function type, owns what it captures, changes
  // none of it, and can run any number of times.
  /** @throws {CompileError} */
  private storing(this: Mut<this>, given: Ref<Expr>, type: Type, to: DynType, message: string): void {
    const now = this.ctx.tables.rewrites.rewritten(given);
    if (now !== undefined) this.storingNow(now, type, to, message);
    else this.storingNow(given, type, to, message);
  }
  /** @throws {CompileError} */
  private storingNow(this: Mut<this>, e: Ref<Expr>, type: Type, to: DynType, message: string): void {
    const fn = this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(to).of)!;
    const c = this.recOf(type);
    if (c?.kind !== "closure") {
      // A function-typed parameter is checked when its instance knows the closure.
      if (c?.kind === "function" || c?.kind === "param") return;
      throw new CompileError("E0101", message, e.start, e.end);
    }
    if (!this.ctx.tables.typing.fits(type, fn)) throw new CompileError("E0101", message, e.start, e.end);
    const body = this.ctx.closureBody(type as ClosureType);
    // A call through a stored callable passes every argument, with no default to fall back on.
    if (bodyOf(this.ctx.tables.arenas, this.inst(body)).params.some((p) => this.ctx.tables.defaulted.has(p))) throw new CompileError("E0801", "a closure with default parameter values can't be stored as a value yet, since calls through it pass every argument; give the parameters no defaults", e.start, e.end);
    const capture = (name: string) => `'${name}'`;
    const borrowed = c.fields.find((f) => this.isRefType(f.type));
    if ((borrowed !== undefined)) throw new CompileError("E0210", `this closure borrows ${capture(borrowed.name)}, but a stored callable owns what it captures; write the closure where it is stored, so it captures by move, or as 'move (...) => ...'`, e.start, e.end);
    if ((c.once !== undefined)) throw new CompileError("E0210", `this closure moves ${capture(c.once)} out of what it captures, so it can run only once, but a stored callable may run any number of times; clone ${capture(c.once)} inside it instead`, e.start, e.end);
    const changed = this.ctx.tables.arenas.localOf([...(this.inst(body).changed ?? [])][0]);
    if (changed) throw new CompileError("E0210", `this closure changes ${capture(changed.name)}, which it captures, but a stored callable can't change what it captures; keep that state in an 'Atomic' or a 'Lock'`, e.start, e.end);
    // Each call of an async callable runs on its own copy of what it captures, which would split
    // an Atomic's or a Lock's state in two.
    const pinned = (u: Type) => {
      const r = this.recOf(u);
      return (r?.kind === "interior" && r.which !== "Cell") || (r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r?.kind === "handle";
    };
    const held = bodyOf(this.ctx.tables.arenas, this.inst(body)).async ? c.fields.find((f) => this.ctx.tables.typing.holdsPart(f.type, pinned)) : undefined;
    if (held) throw new CompileError("E0303", `this async function captures ${capture(held.name)}, which holds an Atomic, a Lock, a Semaphore or a JoinHandle; each call works on its own copy of what it captures, which would split that state, so capture a shared value holding it instead, like 'shared({ count: new Atomic(0) })'`, e.start, e.end);
  }

  // What a Dyn of this type runs for each interface member. A method may not need more of its
  // object than the interface declares, since a call through a Dyn only knows the interface,
  // and one taking an interface or function has a version per argument type, so no one slot.
  /** @throws {CompileError} */
  private dynTable(this: Mut<this>, e: Ref<Expr>, type: Type, to: DynType): DynTable {
    const r = this.recOf(type);
    const c = r?.kind === "class" ? this.cls(type as ClassType) : undefined;
    const fixed = this.ctx.tables.typing.holdsPart(type, (u) => {
      const p = this.recOf(u);
      return (p?.kind === "interior" && p.which !== "Cell") || (p?.kind === "block" && (p.which === "Semaphore" || p.which === "Permit")) || p?.kind === "handle" || p?.kind === "dyn";
    });
    // A boxed async generator's one slot is its `next()`, whose future borrows the generator in
    // the Dyn's block and is boxed in turn. A generator runs once, so it is never copied.
    if (r?.kind === "generator") {
      this.ctx.tables.dynMembers.set(`${this.ctx.tables.typing.keyOf(this.ctx.tables.typing.leafFuture("next", type as GeneratorType))} ${this.ctx.tables.typing.keyOf(this.ctx.tables.typing.lentPromise(this.ctx.tables.typing.nextResult(r.yields)))}`, { methods: [], fields: [], clone: undefined });
      return { methods: [undefined], fields: [], clone: undefined };
    }
    if (r?.kind === "closure") {
      const body = this.ctx.closureBody(type as ClosureType);
      this.futureTable(body, this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(to).of).methods[0]!.returns, false, e);
      return { methods: [body], fields: [], clone: fixed ? undefined : "copy" };
    }
    const methods = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(to).of).methods.map((m) => {
      const body = c && inherited(this.ctx.tables.arenas, c, "methods", m.name);
      // An optional method the type leaves out has an empty slot.
      if (!body) return undefined;
      // A generic method has no one function for the table; calls of it through a Dyn are refused.
      if (m.generic) return undefined;
      if (body.params.some((p) => p.comptime)) throw new CompileError("E1102", `'${this.ctx.tables.typing.show(type)}' can't be a '${this.ctx.tables.typing.show(to)}': its method '${m.name}' takes a comptime parameter, so it has a version per value and no one method a Dyn could call`, e.start, e.end);
      const refuse = (does: string, declare: string) => new CompileError("E0702", `'${this.ctx.tables.typing.show(type)}' can't be a '${this.ctx.tables.typing.show(to)}': its method '${m.name}' ${does}, which '${this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(to).of).name}' doesn't declare; declare '${declare}' on it in the interface`, e.start, e.end);
      if (body.self?.owned && !m.owned) throw refuse("takes its object over", "this: Own<this>");
      if (body.self?.mutable && !body.self.owned && !m.mutable && !m.owned) throw refuse("changes its object", "this: Mut<this>");
      // An object-typed parameter takes exactly its own type through a Dyn; an interface or a
      // function has a version per argument type, and no one to call.
      const implicit = this.ctx.implicitOf(body.bodyId);
      if ([...implicit.values()].some((b) => this.ctx.tables.typing.rec(b).kind !== "object")) throw new CompileError("E0211", `'${this.ctx.tables.typing.show(type)}' can't be a '${this.ctx.tables.typing.show(to)}': its method '${m.name}' takes an interface or a function, so it has a version per argument type and no one to call through a Dyn`, e.start, e.end);
      const instance = this.ctx.instanceOf(body.bodyId, new Map([...(body.scope ?? []), ...[...implicit].map(([i, b]): [string, Type] => [`#${i}`, b])]));
      this.futureTable(instance, m.returns, true, e);
      return instance;
    });
    const fields = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(to).of).fields.map((f) => (typeof type !== "string" && this.ctx.tables.typing.field(type, f.name) ? undefined : c && this.ctx.instanceOf((inherited(this.ctx.tables.arenas, c, "getters", f.name)!).bodyId, undefined)));
    const own = this.ctx.tables.arenas.bodyOf(c?.methods.get("clone"));
    return { methods, fields, clone: own ? this.ctx.instanceOf(own.bodyId, undefined) : fixed ? undefined : "copy" };
  }

  // `new C(...)`: a class's constructor run on a new object, or one of the built-in types.
  /** @throws {CompileError} */
  private newValue(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>): Type {
    const spread = this.spreadTuples(e);
    if (spread !== undefined) return this.typeOf(spread);
    return this.newList(e);
  }
  /** @throws {CompileError} */
  private newList(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>): Type {
    const list = e.args ?? [];
    if (e.callee.kind === "ident" && INTERIORS.has(e.callee.name) && (this.ctx.lookup(e.callee.name, undefined) === undefined) && !this.ctx.classes.has(e.callee.name)) {
      return this.interiorNew(e, e.callee.name as InteriorRecord["which"], list);
    }
    if (e.callee.kind === "ident" && (e.callee.name === "Rc" || e.callee.name === "Weak") && (this.ctx.lookup(e.callee.name, undefined) === undefined) && !this.ctx.classes.has(e.callee.name)) {
      return this.countedNew(e, e.callee.name, list);
    }
    if (e.callee.kind === "ident" && (e.callee.name === "Semaphore" || e.callee.name === "Channel") && (this.ctx.lookup(e.callee.name, undefined) === undefined) && !this.ctx.classes.has(e.callee.name)) {
      return this.blockNew(e, e.callee.name, list);
    }
    if (e.callee.kind === "ident" && (e.callee.name === "Map" || e.callee.name === "Set") && (this.ctx.lookup(e.callee.name, undefined) === undefined)) return this.mapNew(e, e.callee.name === "Set", list);
    if (e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) && this.ctx.tables.jsClasses.has(e.callee.name)) return this.jsNew(e, this.ctx.tables.jsClasses.get(e.callee.name)!);
    if (e.callee.kind === "ident" && e.callee.name === "Promise" && (this.ctx.lookup("Promise", undefined) === undefined) && !this.ctx.classes.has("Promise")) {
      return this.typeOf(this.promiseNew(e, list));
    }
    if (e.callee.kind === "ident" && e.callee.name === "RegExp" && (this.ctx.lookup("RegExp", undefined) === undefined) && !this.ctx.classes.has("RegExp")) return this.regexNew(e, list);
    if (e.callee.kind === "ident" && e.callee.name === "AbortController" && (this.ctx.lookup(e.callee.name, undefined) === undefined) && !this.ctx.classes.has(e.callee.name)) {
      if (list.length > 0 || e.typeArgs.length > 0) throw new CompileError("E0504", "'AbortController' takes no arguments", e.start, e.end);
      return this.ctx.tables.typing.blockType("AbortController");
    }
    if (e.callee.kind === "ident" && isTypedName(e.callee.name) && (this.ctx.lookup(e.callee.name, undefined) === undefined) && !this.ctx.classes.has(e.callee.name)) return this.typedNew(e, e.callee.name, list);
    const named = e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) ? this.ctx.tables.arenas.classOf(this.ctx.classes.get(e.callee.name)) : undefined;
    if (named?.node.abstract) throw new CompileError("E0701", `cannot create an instance of the abstract class '${this.ctx.tables.typing.rec(named.type).name}'`, e.start, e.end);
    const written = this.ctx.tables.arenas.bodyOf(named?.constructor)?.params ?? (e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) ? this.ctx.templateParams(e.callee.name) : undefined);
    if (written !== undefined && written.length > 0 && written[written.length - 1]!.rest && e.args !== undefined) {
      const packed = this.packRest(e, e.args, written);
      if (packed !== undefined && packed.kind === "new" && packed.args !== undefined) return this.newChecked(e, packed.args);
      return this.newChecked(e, e.args);
    }
    this.refuseSpread(list);
    return this.newChecked(e, list);
  }
  /** @throws {CompileError} */
  private newChecked(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, list: Ref<Expr[]>): Type {
    const named = e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) ? this.ctx.tables.arenas.classOf(this.ctx.classes.get(e.callee.name)) : undefined;
    if ((named !== undefined)) this.expectFrom(named.constructor, list);
    // A generic class's written type arguments type the arrows given for parameters they name,
    // as in `new Box<(n: i64) => i64>((n) => n * 2)`.
    const earlyId = (named === undefined) && e.typeArgs.length > 0 && e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) ? this.ctx.construct(e.callee.name, e.typeArgs, [], e) : undefined;
    const early = this.ctx.tables.arenas.classOf(earlyId);
    const earlyConstructor = this.ctx.tables.arenas.bodyOf(early?.constructor);
    earlyConstructor?.params.forEach((p, i) => {
      const held = p.type?.kind === "ref" && p.type.args.length === 0 ? (earlyConstructor.scope ?? early!.scope).get(p.type.name) : undefined;
      if (list[i]?.kind === "arrow" && held) this.expect(list[i]!, held);
    });
    // JavaScript's `new Array(n)` holds n holes, which Fish has no way to make.
    if (e.callee.kind === "ident" && e.callee.name === "Array" && (this.ctx.lookup("Array", undefined) === undefined) && !this.ctx.classes.has("Array")) {
      const one = list.length === 1 ? this.value(list[0]!) : undefined;
      throw new CompileError("E0104", list.length === 0 ? "'new Array()' is an empty array; write '[]', with its type where it can't be inferred, as in 'const xs: string[] = []'"
        : one !== undefined && isInteger(one) ? "'new Array(n)' would hold n empty slots, which Fish has no way to make; fill it, as in 'new Array(n).fill(0)', or use 'Array.from({ length: n }, (_, i) => ...)'"
        : list.length === 1 ? "'new Array(x)' of one value that isn't a length makes '[x]'; write 'Array.of(x)' or '[x]'"
        : "'new Array(a, b)' makes an array of its arguments; write 'Array.of(a, b)' or '[a, b]'", e.start, e.end);
    }
    const argTypes = list.map((a) => this.value(a));
    if (named && this.ctx.tables.typing.rec(named.type).name === "Date" && named.node.start >= STD_BASE) this.dateNew(e, list, argTypes);
    const c = this.ctx.tables.arenas.classOf(e.callee.kind === "ident" ? this.ctx.construct(e.callee.name, e.typeArgs, argTypes, e) : undefined);
    if (!c) throw new CompileError("E0503", `only a class can be constructed with 'new'${e.callee.kind === "ident" && (this.ctx.lookup(e.callee.name, undefined) === undefined) ? didYouMean(e.callee.name, this.ctx.classNames(e.callee.start)) : ""}`, e.callee.start, e.callee.end);
    const rust = rustClassOf(this.ctx.tables.typing, c.type);
    const made = this.ctx.tables.arenas.bodyOf(c.constructor);
    if (rust && !made.rust) throw new CompileError("E1004", `the Rust type '${rust.name}' declares no constructor; declare one, as in 'constructor(x: i64);', or make it with a static function`, e.start, e.end);
    this.ctx.constructs(made.bodyId, list, argTypes);
    const constructor = this.ctx.instantiate(made.bodyId, [], list, argTypes, e);
    this.args(list, argTypes, constructor, e);
    this.ctx.calls.set(e, constructor);
    const error = this.ctx.errorOf(constructor);
    if (error) this.ctx.raise(e, error, `'new ${this.ctx.tables.typing.rec(c.type).name}'`);
    // An instance holding references borrows from what it was built from.
    if (this.ctx.tables.typing.holdsRef(c.type)) this.ctx.borrowsFrom.set(e, list.filter((a) => this.lends(a)));
    return c.type;
  }

  // A slot giving a `Promise<T>` boxes the future its method or closure makes: borrowing the
  // Dyn's value for a method, owning its captures for a closure. Its vtable is made here.
  /** @throws {CompileError} */
  private futureTable(this: Mut<this>, target: InstanceId, returns: Type, lent: boolean, at: Ref<Expr>): void {
    const gives = this.ctx.tables.typing.promiseElement(returns);
    if (gives === undefined) return;
    const future = this.inst(target).future;
    const made = this.ctx.tables.typing.lower(future ?? this.ctx.returnOf(target, at));
    const fr = this.recOf(made);
    if (fr?.kind !== "future") throw unsupported("Dyn methods giving a Promise that isn't an async function's future", at);
    if (fr.throws) throw new CompileError("E0602", `'${bodyOf(this.ctx.tables.arenas, this.inst(target)).name}' can throw '${this.ctx.tables.typing.show(fr.throws)}', and a Promise given through a Dyn or a stored function can't throw yet`, at.start, at.end);
    const boxed = lent ? this.ctx.tables.typing.lentPromise(gives) : this.ctx.tables.typing.stored(returns);
    this.ctx.tables.dynMembers.set(`${this.ctx.tables.typing.keyOf(made)} ${this.ctx.tables.typing.keyOf(boxed)}`, { methods: [], fields: [], clone: undefined });
  }

  // A method call through a Dyn: the interface's method, run through its slot.
  /** @throws {CompileError} */
  private dynCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: DynType): { type: Type; what: string } {
    if (this.ctx.tables.typing.callableOf.has(this.ctx.tables.typing.rec(t).of)) throw new CompileError("E0503", `a stored function is called directly, as '${this.placeText(callee.object)}(...)'`, callee.start, callee.end);
    const index = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).methods.findIndex((m) => m.name === callee.name);
    const m = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).methods[index];
    if (!m) {
      const hint = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).fields.some((f) => f.name === callee.name) ? "; it is a field, read without calling" : didYouMean(callee.name, this.memberNames(t));
      throw new CompileError("E0502", `property '${shownName(callee.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'${hint}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported("optional chains calling methods through a Dyn", callee);
    this.omittableCall(e, callee, m, this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).name);
    if (m.generic) throw new CompileError("E0211", `'${m.name}' is generic, a family of methods made one per call, and a Dyn's table holds one function per method, so it can't be called through a Dyn; take a type parameter bounded by '${this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).name}' instead`, callee.start, callee.end);
    const async = this.ctx.tables.typing.promiseElement(m.returns);
    if (async !== undefined && m.owned) throw unsupported("async methods taking their object over through a Dyn", callee);
    const mr = this.recOf(m.returns);
    if (mr?.kind === "interface" && async === undefined) {
      throw new CompileError("E0115", `'${m.name}' returns the interface type '${mr.name}', which each type implementing '${this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).name}' gives its own way, so a Dyn can't call it; have it return 'Dyn<${mr.name}>'`, callee.start, callee.end);
    }
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${m.name}' takes no type arguments`, e.start, e.end);
    if (e.args.length !== m.params.length) throw new CompileError("E0501", `expected ${m.params.length} argument${m.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    // A reference it gives borrows the Dyn, unless the call frees the Dyn's block.
    if (this.ctx.tables.typing.holdsRef(m.returns)) {
      if (m.owned) throw new CompileError("E0209", `'${m.name}' takes its object over and frees it, so the reference it gives would point at nothing`, callee.start, callee.end);
      this.ctx.borrowsFrom.set(e, [callee.object]);
    }
    // A boxed async generator's `next()` runs it on, changing it.
    const mutable = m.mutable === true || this.ctx.tables.typing.generatorElement(this.ctx.tables.typing.rec(t).of, true) !== undefined;
    if (m.owned) this.takesOver(callee.object, m.name);
    else if (mutable) this.mutates(callee.object, m.name);
    e.args.forEach((a, i) => {
      const want = m.params[i]!;
      this.expect(a, want);
      const given = this.value(a);
      this.coerce(a, given, want, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(want)}'`);
    });
    this.ctx.tables.dynCalls.set(e, { index, mutable, owned: m.owned === true });
    // An async method's future, boxed, borrows the Dyn until it is done.
    if (async !== undefined) {
      this.ctx.borrowsFrom.set(e, [callee.object, ...e.args.filter((a) => this.lends(a))]);
      return { type: this.ctx.tables.typing.lentPromise(async), what: `'${m.name}'` };
    }
    if (m.throws) this.ctx.raise(e, m.throws, `'${m.name}'`);
    return { type: m.returns, what: `'${m.name}'` };
  }

  // A call of a stored callable: whatever expression gives it, run through its one slot.
  /** @throws {CompileError} */
  private callableCall(this: Mut<this>, e: Ref<Call>, callee: Ref<Expr>, t: DynType): { type: Type; what: string } {
    const fn = this.ctx.tables.typing.callableOf.get(this.ctx.tables.typing.rec(t).of)!;
    // A field holding it is read as any field is.
    if (!this.ctx.types.has(callee)) this.value(callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "a stored function takes no type arguments", e.start, e.end);
    if (e.args.length !== this.ctx.tables.typing.rec(fn).params.length) throw new CompileError("E0501", `expected ${this.ctx.tables.typing.rec(fn).params.length} argument${this.ctx.tables.typing.rec(fn).params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const want = this.ctx.tables.typing.rec(fn).params[i]!;
      this.expect(a, want);
      const given = this.value(a);
      this.coerce(a, given, want, `argument of type '${this.ctx.tables.typing.show(given)}' is not assignable to parameter of type '${this.ctx.tables.typing.show(want)}'`);
    });
    if (this.ctx.tables.typing.holdsRef(this.ctx.tables.typing.rec(fn).returns)) this.ctx.borrowsFrom.set(e, [callee]);
    this.ctx.tables.dynCalls.set(e, { index: 0, mutable: false, owned: false, callable: callee });
    const thrown = this.ctx.tables.typing.rec(fn).throws;
    if (thrown) this.ctx.raise(e, thrown, callee.kind === "ident" || callee.kind === "member" ? `'${callee.name}'` : "this function");
    // One returning a Promise gives its future boxed, owning what it holds.
    return { type: this.ctx.tables.typing.stored(this.ctx.tables.typing.rec(fn).returns), what: "this function" };
  }

  // A field read through a Dyn, through its slot: a copy of the value.
  /** @throws {CompileError} */
  private dynField(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, t: DynType): Type {
    if (this.linked(e)) throw unsupported("optional chains through a Dyn", e);
    const f = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).fields.find((x) => x.name === e.name);
    if ((f === undefined)) {
      const hint = this.ctx.tables.typing.rec(this.ctx.tables.typing.rec(t).of).methods.some((m) => m.name === e.name) ? "; it is a method, so call it" : didYouMean(e.name, this.memberNames(t));
      throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.ctx.tables.typing.show(t)}'${hint}`, e.start, e.end);
    }
    // A copy of an Atomic, a Lock or a Dyn would change apart from the original.
    if (this.ctx.tables.typing.interiorMutable(f.type) || this.ctx.tables.typing.holdsHandle(f.type)) throw new CompileError("E0211", `'${e.name}' can't be read through a Dyn, which gives a copy of it, and a copy of a '${this.ctx.tables.typing.show(f.type)}' would change apart from the one the Dyn holds; read it through a method`, e.start, e.end);
    this.ctx.tables.computed.add(cloneExpr(e));
    return f.type;
  }

  // Whether a place is inside the value a callback is passed: its parameter, or a field of it.
  private isParamPath(e: Ref<Expr>): boolean {
    while (e.kind === "member" || e.kind === "index") e = e.object;
    return e.kind === "ident" && this.localAt(e)?.param === true;
  }

  // Whether `this` may change here. A closure changing it changes it where it was made.
  /** @throws {CompileError} */
  changesThis(this: Mut<this>, path: string, action: string, target: Ref<Expr>) {
    this.ctx.changesPath("this", path, action, target);
    if (this.ctx.closing) return this.ctx.changesCapture(undefined, path, action, target, false);
    if (this.ctx.self?.mutable) return;
    throw new CompileError("E0206", `cannot ${action} 'this${shownPath(path)}' because 'this' is read-only here; declare 'this: Mut<this>'`, target.start, target.end);
  }

  // Whether a variable may change here, at `path` inside it, possibly through a mutable
  // reference. A closure changing what it captures changes the variable where it was made.
  /** @throws {CompileError} */
  changesLocal(this: Mut<this>, id: LocalId, path: string, action: string, target: Ref<Expr>, throughMut: boolean): void {
    this.ctx.changesPath(id, path, action, target);
    if (this.ctx.captured(id)) return this.ctx.changesCapture(id, path, action, target, throughMut);
    if (throughMut) return;
    const local = { name: this.lc(id).name, param: this.lc(id).param, mutable: this.lc(id).mutable };
    // A shared reference never changes what it points to; a mutable one may, whatever holds
    // it, and a method may change through it.
    const lr = this.recOf(this.lc(id).type);
    if ((path || action !== "assign to") && lr?.kind === "ref") {
      if (lr.mutable) return;
      throw new CompileError("E0206", `cannot ${action} '${local.name}${shownPath(path)}' because '${local.name}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
    }
    if (local.param && local.mutable) this.ctx.changedParams.add(id);
    if (local.param && !local.mutable) {
      if (lr?.kind === "ref") throw new CompileError("E0206", `cannot point the reference parameter '${local.name}' elsewhere; it borrows what the caller passed, so declare a 'let' for another reference`, target.start, target.end);
      const what = action === "assign to" ? "assigning to" : action === "mutably borrow" ? "mutably borrowing" : "calling a mutating method on";
      throw new CompileError("E0801", `${what} a parameter holding a reference is not supported yet; copy it into a 'let'`, target.start, target.end);
    }
    if (!local.mutable) {
      const what = path ? `'${local.name}${shownPath(path)}' because '${local.name}'` : `'${local.name}' because it`;
      throw new CompileError("E0207", `cannot ${action} ${what} is a constant`, target.start, target.end);
    }
  }

  // The literal type of `t.length` on a tuple whose count is known, if `e` is one.
  private tupleLength(this: Mut<this>, e: Ref<Expr>): Type | undefined {
    if (e.kind !== "member" || e.name !== "length" || e.optional) return undefined;
    const t = this.ctx.types.get(e.object);
    const held = t !== undefined && this.isRefType(t) ? this.ctx.tables.typing.rec(t).to : t;
    return held !== undefined && this.ctx.tables.typing.isTuple(held) ? this.ctx.tables.typing.tupleLength(held as ObjectType) : undefined;
  }

  // A readonly field can't change once constructed, nor can anything inside it. Only its own
  // class's constructor may assign it, through `this`.
  /** @throws {CompileError} */
  private readonly(e: Ref<Extract<Expr, { kind: "member" }>>, target: Ref<Expr>, action: string) {
    const found = this.ctx.types.get(e.object);
    const object = typeof found !== "string" && this.recOf(found)?.kind === "ref" ? this.ctx.tables.typing.rec(found as RefType).to : found;
    if (object && stringLike(this.ctx.tables.typing, object)) throw new CompileError("E0802", `a string's '${e.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    // Through a mutable reference, the value written is someone else's: in an instance, its
    // field is as read-only as the field of the type it really is. A copy is the body's own.
    const locked = this.ctx.tables.typing.field(object as Exclude<Type, string>, e.name)?.readonly || (this.throughMutable(e.object) && this.concreteField(e)?.readonly);
    if (typeof object === "string" || !object || !locked) return;
    if (e.id === target.id && e.object.kind === "this" && this.ctx.self?.constructor && this.ctx.tables.typing.rec(this.ctx.self.type).fields.some((f) => f.name === e.name)) return;
    if (this.ctx.tables.typing.isTuple(object)) throw new CompileError("E0208", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(e.object)}' is a '${this.ctx.tables.typing.show(object)}', whose elements are read-only`, target.start, target.end);
    const what = e.id === target.id ? `'${e.name}' because it is` : `'${this.placeText(target)}' because '${e.name}' is`;
    throw new CompileError("E0208", `cannot ${action} ${what} a read-only property`, target.start, target.end);
  }

  // Whether a place is reached through a mutable reference anywhere along its path; `this`
  // is one, to the object the method was called on.
  private throughMutable(e: Ref<Expr>): boolean {
    for (let x = e; ; x = x.object) {
      const t = this.ctx.types.get(x);
      if (typeof t !== "string" && this.recOf(t)?.kind === "ref" && this.ctx.tables.typing.rec(t as RefType).mutable) return true;
      if (x.kind !== "member") return x.kind === "this" || x.kind === "super";
    }
  }

  // A field as the concrete types along its path declare it, type parameters taken as what
  // they stand for in this instance.
  private concreteField(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): Field | undefined {
    const holder = this.concreteType(e.object);
    return (holder !== undefined) && typeof holder !== "string" ? this.ctx.tables.typing.field(holder, e.name) : undefined;
  }

  private concreteType(this: Mut<this>, e: Ref<Expr>): Type | undefined {
    const deref = (t: Type | undefined) => {
      const low = t && this.ctx.tables.typing.lower(t);
      return typeof low !== "string" && this.recOf(low)?.kind === "ref" ? this.ctx.tables.typing.lower(this.ctx.tables.typing.rec(low as RefType).to) : low;
    };
    if (e.kind !== "member") return deref(this.ctx.types.get(e));
    const holder = this.concreteType(e.object);
    return holder && typeof holder !== "string" ? deref(this.ctx.tables.typing.field(holder, e.name)?.type) : undefined;
  }

  // How a place reads in a message, like `p.inner.x`.
  private placeText(e: Ref<Expr>): string {
    if (e.kind === "index" && e.index.kind === "int" && this.ctx.tables.restStarts.has(e.object) && e.object.kind === "member") return `${this.placeText(e.object.object)}${restSuffix(this.ctx.tables.restStarts, e)}`;
    if (e.kind === "member" && this.ctx.tables.restStarts.has(e)) return `${this.placeText(e.object)}${restSuffix(this.ctx.tables.restStarts, e)}`;
    // The collection a class extending Map or Set embeds reads as the object itself.
    if (e.kind === "member" && e.name === EMBEDDED) return this.placeText(e.object);
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${this.placeText(e.object)}[${e.name}]` : `${this.placeText(e.object)}.${shownName(e.name)}`;
    if (e.kind === "index") return `${this.placeText(e.object)}[${indexText(e.index)}]`;
    if (e.kind === "nonNull") return `${this.placeText(e.expr)}!`;
    return e.kind === "ident" ? e.name : e.kind === "this" ? "this" : "(...)";
  }

  // Whether a type parameter stands for a plain value, as one bounded by a union or primitive
  // does: a primitive, literal, pattern or brand, or a union of them. One with an interface or
  // object bound offers its bound's members, even as the `never` a left-out optional stands for.
  private valueParam(r: ParamRecord): boolean {
    if (r.bound !== undefined) return false;
    const plain = (t: Type): boolean => {
      const k = this.recOf(t)?.kind;
      return k === undefined || k === "literal" || k === "pattern" || k === "brand";
    };
    const c = this.recOf(r.concrete);
    return r.within === true || (c?.kind === "union" ? c.members.every(plain) : plain(r.concrete!));
  }

  // `e as written`: a conversion between numbers or into and out of a brand, or a widening.
  /** @throws {CompileError} */
  private converted(this: Mut<this>, e: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>, written: Type): Type {
    // A function type or a `Promise<T>` makes the value a stored one, as a declared variable's does.
    const to = this.ctx.tables.typing.stored(written);
    if (to !== written) this.expect(e.expr, to);
    const from = this.operand(e.expr);
    // A raw pointer converts to another, or to and from an address, only inside `unsafe`.
    const pointer = (t: Type) => typeof t !== "string" && this.ctx.tables.typing.rec(t).kind === "pointer";
    if (pointer(to) || pointer(from)) {
      this.needsUnsafe("'as' with a raw pointer", { start: e.start, end: e.end });
      if (!((pointer(to) && (pointer(from) || isInteger(from))) || (to === "usize" && pointer(from)))) {
        throw new CompileError("E1006", `a raw pointer converts only to another raw pointer or a 'usize', not '${this.ctx.tables.typing.show(pointer(to) ? from : to)}'`, e.start, e.end);
      }
      return to;
    }
    // A reference widened or narrowed to what it points to would be a copy nobody wrote.
    const read = this.ctx.types.get(e.expr) ?? from;
    if ((this.isRefType(from) || this.isRefType(read)) && !this.ctx.tables.typing.isCopy(this.ctx.tables.typing.lower(from)) && !this.isRefType(to) && (this.ctx.tables.typing.optionRef(to) === undefined)) throw new CompileError("E0202", `'as' can't take the value out of '${this.ctx.tables.typing.show(read)}', which only borrows it; use '.clone()' for a copy`, e.start, e.end);
    const narrowsFromUnion = () => {
      const fr = this.recOf(from);
      if (fr?.kind !== "union") return false;
      const tr = this.recOf(to);
      const targets = tr?.kind === "union" ? tr.members : [to];
      return targets.length > 0 && targets.every((t) => fr.members.some((m) => m === t || this.ctx.tables.typing.unfold(m) === t || this.ctx.tables.typing.sameLowered(m, t) || this.ctx.tables.typing.sameLowered(this.ctx.tables.typing.unfold(m), t)));
    };
    // A brand is made and taken apart with 'as', between its base and what converts to it.
    const [fb, tb] = [this.ctx.tables.typing.unbranded(from), this.ctx.tables.typing.unbranded(to)];
    if (fb !== from || tb !== to) {
      if (tb !== to && this.adapt(e.expr, tb)) return to;
      if (isNumeric(fb) && isNumeric(tb)) return to;
      if (fb === tb || this.ctx.tables.typing.fits(fb, tb)) {
        if (from !== tb) this.coerce(e.expr, from, tb, "");
        return to;
      }
      if (narrowsFromUnion()) return to;
      throw new CompileError("E0111", `'${this.ctx.tables.typing.show(from)}' can't be converted to '${this.ctx.tables.typing.show(to)}' with 'as'`, e.start, e.end);
    }
    // A bigint becomes a number with 'as', truncated to an integer type's bits as
    // 'BigInt.asIntN' does; a number becomes a bigint only through 'BigInt(x)'.
    if (to === "bigint" && from !== "bigint") throw new CompileError("E0111", `'${this.ctx.tables.typing.show(from)}' converts to a bigint with 'BigInt(x)', not 'as'`, e.start, e.end);
    if (from === "bigint" && (isNumeric(to) || to === "bigint")) return to;
    // Between other types, 'as' widens, or narrows a union by checking its tag at run time.
    if (!isNumeric(to) || !isNumeric(from)) {
      if (!(from === "boolean" && isInteger(to)) && (this.ctx.tables.typing.fits(from, to) || this.ctx.tables.typing.fits(from, written))) {
        this.coerce(e.expr, from, to, "");
        return to;
      }
      if (narrowsFromUnion()) return to;
      if (this.ctx.tables.typing.fits(to, from)) throw new CompileError("E0111", `'as' can't narrow '${this.ctx.tables.typing.show(from)}' to '${this.ctx.tables.typing.show(to)}', since nothing would check it while the program runs; narrow it with a check, like 'typeof', 'instanceof' or '!== null'`, e.start, e.end);
      if (!(from === "boolean" && isInteger(to))) throw new CompileError("E0111", `'${this.ctx.tables.typing.show(from)}' can't be converted to '${this.ctx.tables.typing.show(to)}' with 'as', since neither fits the other`, e.start, e.end);
    }
    return to;
  }

  // An operator works on a literal's base type, so `1` adds like any i64. A type parameter
  // bounded by a union or primitive is used as its bound at its definition, and in an instance as
  // its argument.
  /** @throws {CompileError} */
  private operand(this: Mut<this>, e: Ref<Expr>): Type {
    const read = this.read(e);
    return this.widen(e, this.plainOf(read));
  }

  private plainOf(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "param" && (r.concrete !== undefined) && this.valueParam(r) ? ((r.within !== undefined) ? r.concrete : this.ctx.tables.typing.lowerKeepingBrands(t)) : t;
  }

  /** @throws {CompileError} */
  declares(this: Mut<this>, c: ClassType, name: string): boolean {
    const info = this.cls(c);
    return (["methods", "getters", "setters"] as const).some((table) => inherited(this.ctx.tables.arenas, info, table, name) !== undefined);
  }

  // The class a name declares, unless a variable shadows it.
  classNamed(this: Mut<this>, name: string): ClassType | undefined {
    return (this.ctx.lookup(name, undefined) !== undefined) ? undefined : this.ctx.tables.arenas.classOf(this.ctx.classes.get(name))?.type;
  }

  // A value that is only read, seen through a reference to it.
  /** @throws {CompileError} */
  read(this: Mut<this>, e: Ref<Expr>): Type {
    const type = this.value(e);
    return this.loaded(e, type);
  }

  // A checked value of `type`, loaded from where it points when it is a reference.
  private loaded(this: Mut<this>, e: Ref<Expr>, type: Type): Type {
    const r = this.recOf(type);
    if (r?.kind !== "ref") return type;
    this.ctx.coercions.set(cloneExpr(e), r.to);
    return r.to;
  }

  // An operand of an enum, a union of integer literals, works as an i64 too.
  private widen(this: Mut<this>, e: Ref<Expr>, type: Type): Type {
    // A pattern's value is a string, as is a union of patterns and string literals.
    if (this.ctx.tables.typing.holdsPattern(type) && this.ctx.tables.typing.lower(type) === "string") {
      this.ctx.coercions.set(cloneExpr(e), "string");
      return "string";
    }
    const u = this.recOf(type);
    const literals = u?.kind === "union" ? u.members : [type];
    const bases = new Set(literals.map((t) => {
      const l = this.recOf(t);
      return l?.kind === "literal" ? this.ctx.tables.typing.baseOf(t as LiteralType) : undefined;
    }));
    const base = bases.size === 1 ? [...bases][0] : undefined;
    // A string literal keeps its type, so comparing two different ones is caught.
    if (!base || base === "string") return type;
    this.ctx.coercions.set(e, base);
    return base;
  }

  // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
  /** @throws {CompileError} */
  condition(this: Mut<this>, e: Ref<Expr>) {
    const type = this.operand(e);
    if (this.ctx.tables.typing.isOption(type)) throw new CompileError("E0102", `condition must be a boolean, not the Option '${this.ctx.tables.typing.show(type)}'; check it with '!== null'`, e.start, e.end);
    if (this.ctx.tables.typing.unbranded(type) !== "boolean") {
      throw new CompileError("E0102", `condition must be a boolean, not '${this.ctx.tables.typing.show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
    }
  }
}

// A string, or a string literal that isn't an enum's member.
function isText(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string") return t === "string";
  const r = typing.rec(t);
  return r.kind === "pattern" || (r.kind === "literal" && typeof r.value === "string" && r.owner === undefined) || (r.kind === "brand" && r.base === "string");
}

// A string enum's member, or a union of them, which joins into a string as its value.
function enumText(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  if (r.kind !== "union") return r.kind === "literal" && typeof r.value === "string" && r.owner !== undefined;
  for (const m of r.members) if (!enumText(typing, m)) return false;
  return true;
}

// What a string's length, index and methods work on: text, or a union of string literals.
export function stringLike(typing: Ref<Typing>, t: Type): boolean {
  if (isText(typing, t)) return true;
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  if (r.kind !== "union") return false;
  for (const m of r.members) if (!isText(typing, m)) return false;
  return true;
}

// The blocking file calls std's node:fs is written over: their parameters, what each gives, and
// whether it throws an IoError.
function syncFileSignatures(typing: Mut<Typing>): Record<string, [Type[], Type, boolean]> {
  const bytes = typing.arrayType("u8");
  const strings = typing.arrayType("string");
  const stat = typing.tupleType(["i64", "i64", "f64", "i64"]);
  const made = typing.unionType(["string", "null"]);
  const spawned = typing.tupleType(["i64", "i64", "i64", bytes, bytes]);
  return {
    fileReadSync: [["string"], bytes, true],
    fileWriteSync: [["string", bytes], "void", true],
    pathExists: [["string"], "boolean", false],
    // Size, mode, modification time in milliseconds, and kind: 1 a file, 2 a directory, 3 a link.
    pathStat: [["string", "boolean"], stat, true],
    dirRead: [["string"], strings, true],
    pathReal: [["string"], "string", true],
    // realpath(3) itself, as fs/promises realpath calls it.
    pathRealNative: [["string"], "string", true],
    pathReadLink: [["string"], "string", true],
    dirTemp: [["string"], "string", true],
    pathRemove: [["string", "boolean", "boolean"], "void", true],
    // A path, recursive and mode, giving the first directory made, or null.
    dirMake: [["string", "boolean", "i64"], made, true],
    pathRename: [["string", "string"], "void", true],
    // From, to and the COPYFILE_ flags.
    fileCopy: [["string", "string", "i64"], "void", true],
    pathUnlink: [["string"], "void", true],
    // A path and the R_OK, W_OK and X_OK bits.
    pathAccess: [["string", "i64"], "void", true],
    // A path and a mode std has checked.
    pathChmod: [["string", "i64"], "void", true],
    // A target, the link made to it, and whether the link is symbolic.
    pathLink: [["string", "string", "boolean"], "void", true],
    // A path, atime and mtime in seconds, and whether a link is followed.
    pathUtimes: [["string", "f64", "f64", "boolean"], "void", true],
    // A command, its arguments, the working directory ("" for this one's), stdin, the runtime's
    // flags and "K=V" environment, giving the pid, exit status (-1 for a signal), signal number,
    // stdout and stderr.
    processSpawn: [["string", strings, "string", bytes, "i64", strings], spawned, true],
  };
}

// Each string method: its parameters, what it returns, and how many arguments it needs.
function stringMethods(typing: Mut<Typing>): Record<string, [Type[], Type, usize]> {
  const text = typing.unionType(["string", "null"]);
  const point = typing.unionType(["u32", "null"]);
  const strings = typing.arrayType("string");
  return {
    charCodeAt: [["usize"], "u16", 1],
    at: [["i64"], text, 1],
    charAt: [["i64"], "string", 1],
    codePointAt: [["usize"], point, 1],
    lastIndexOf: [["string", "i64"], "i64", 1],
    indexOf: [["string", "i64"], "i64", 1],
    includes: [["string", "i64"], "boolean", 1],
    startsWith: [["string", "i64"], "boolean", 1],
    endsWith: [["string", "i64"], "boolean", 1],
    split: [["string", "usize"], strings, 0],
    trim: [[], "string", 0],
    trimStart: [[], "string", 0],
    trimEnd: [[], "string", 0],
    toUpperCase: [[], "string", 0],
    toLowerCase: [[], "string", 0],
    replace: [["string", "string"], "string", 2],
    replaceAll: [["string", "string"], "string", 2],
    padStart: [["usize", "string"], "string", 1],
    padEnd: [["usize", "string"], "string", 1],
    repeat: [["usize"], "string", 1],
    slice: [["i64", "i64"], "string", 1],
    substring: [["i64", "i64"], "string", 1],
  };
}


// The methods an array has.
// A type's name with its article, as `an 'i64'` or `a 'string'`.
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} '${name}'`;

// The methods that run a callback on each element.
const CALLBACK_METHODS = new Set(["map", "filter", "find", "some", "every", "reduce", "forEach", "flatMap", "findIndex", "findLast", "findLastIndex", "reduceRight"]);
// Generators' iterator helpers, and the std function each calls.
const GENERATOR_HELPERS: Record<string, string> = {
  map: "iter map", filter: "iter filter", take: "iter take", drop: "iter drop", flatMap: "iter flat map",
  reduce: "iter reduce", toArray: "array collect", forEach: "iter for each", some: "iter some", every: "iter every", find: "iter find",
};
// The callback methods whose callback decides yes or no.
const PREDICATES = new Set(["filter", "find", "some", "every", "findIndex", "findLast", "findLastIndex"]);
// The methods that read an array's elements by value.
const READING_METHODS = new Set(["includes", "indexOf", "lastIndexOf", "join", "slice", "concat", "flat"]);
// The methods that change an array in place, beside push, pop and sort.
// The methods giving a changed copy of the array, leaving it as it is.
const COPYING_METHODS = new Set(["toReversed", "toSorted", "toSpliced", "with"]);
const CHANGING_METHODS = new Set(["shift", "unshift", "splice", "reverse", "fill", "copyWithin", "reserve", "shrinkToFit"]);
// The methods giving an iterator over an array, as generators in the prelude.
const ITERATORS: Record<string, string> = { entries: "array entries", keys: "array keys", values: "array values" };
// `u8`'s statics decoding text into bytes, and the prelude function each calls.
const BYTE_DECODERS: Record<string, string> = { fromBase64: "array from base64", fromHex: "array from hex" };
// The methods encoding a `u8[]` as text, and the prelude function each calls.
const BYTE_METHODS: Record<string, string> = { toBase64: "array to base64", toHex: "array to hex" };
// How many arguments each of a Map's and a Set's methods takes, and those changing it.
const MAP_ARGUMENTS: Record<string, usize> = { set: 2, add: 1, get: 1, has: 1, delete: 1, clear: 0, update: 2, keys: 0, values: 0, entries: 0, forEach: 1 };
export const MAP_CHANGES = new Set(["set", "add", "delete", "clear", "update"]);
// Converting floats to an integer element with 'as' saturates at its bounds, where a typed array
// in JavaScript wraps modulo 2 to its bit count; said wherever 'as' is suggested for that.
function floatInto(from: Type, to: Type): string {
  return isFloat(from) && isInteger(to) ? `; from a float, 'as' saturates at the bounds of '${to}', where JavaScript wraps modulo 2^${integerInfo(to).bits}${to === "u8" ? ", so 300.5 becomes 255 rather than 44" : ""}` : "";
}

// The array methods that change their array, which a subarray's copy can't take.
const SUBARRAY_WRITES = new Set(["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "set", "reserve", "shrinkToFit"]);
const TYPED_MEMBERS = new Set(["byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"]);
const ARRAY_METHODS = new Set(["push", "pop", "sort", "at", ...Object.keys(ITERATORS), ...Object.keys(BYTE_METHODS), ...CALLBACK_METHODS, ...READING_METHODS, ...COPYING_METHODS, ...CHANGING_METHODS]);

// Whether `name` is a member of the Map or Set a class embeds.
const collectionMember = (c: ClassInfo, name: string) => name === "size" || (c.embedded === "Set" ? SET_METHODS : MAP_METHODS).has(name);

// The name a property of an object literal is written with, a spread's aside.
function propName(p: Ref<ObjectProp>): string {
  if (p.kind === "shorthand") return p.name;
  return p.kind === "spread" ? "" : keyText(p.key);
}

function keyText(key: Ref<PropertyName>): string {
  return typeof key === "string" ? key : "";
}

// A field or element read on the way from a place to its root: its name, `[]` for an element,
// and for an element the kind of its index and the name an index variable has.
type PlaceStep = { name: string; index: string; indexName: string };
// A place's root: what kind of expression it is, and a variable's name.
type PlaceRoot = { kind: string; name: string };

// Whether an expression makes a promise: `new Promise(...)` or a `Promise` static's call.
function makesPromise(x: Ref<Expr>): boolean {
  if (x.kind === "new") return x.callee.kind === "ident" && x.callee.name === "Promise";
  return x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise";
}

// A copy of an object literal's property, method or accessor under a key now known.
function withKey(p: Ref<ObjectProp>, key: string): ObjectProp {
  const c = cloneObjectProp(p);
  if (c.kind === "property") return { ...c, key };
  if (c.kind === "method") return { ...c, key };
  if (c.kind === "get" || c.kind === "set") return { ...c, key };
  return c;
}

// An event of walking a pipe's right side for its topics: a `%` to replace, or a tree to walk in
// its place, a replacement or a nested pipe's left side.
type TopicEvent = { walk: boolean; node: Expr; assigned: boolean };

// A copy of a tree with fresh ids.
function renumbered(tree: Expr, ids: Mut<Ids>): Expr {
  return renumberExpr(tree, () => nextId(ids));
}

// Whether a condition's facts rule a branch out: some binding can be nothing there.
function ruledOut(facts: Ref<Facts>): boolean {
  for (const t of facts.values()) if (t === "never") return true;
  return false;
}

// A name a pattern binds, or one its defaults read, that is among `names`: the first is found.
function declaredIn(p: Ref<Pattern>, names: Ref<Set<string>>, found: Mut<Expr[]>): void {
  walkWhile({ of: "pattern", node: p }, (n) => {
    if (found.length > 0) return false;
    if (n.of === "pattern" && n.node.kind === "ident" && names.has(n.node.name)) found.push({ id: n.node.id, kind: "ident", name: n.node.name, start: n.node.start, end: n.node.end });
    else if (n.of === "expr" && n.node.kind === "ident" && names.has(n.node.name)) found.push(cloneExpr(n.node));
    return true;
  });
}

// What a pattern tests, with the type of the value it meets.
function infoOf(type: Type, test: PatternTest): PatternInfo {
  switch (test.kind) {
    case "any":
      return { type, kind: "any" };
    case "literal":
      return test.member !== undefined ? { type, kind: "literal", value: test.value, member: test.member } : { type, kind: "literal", value: test.value };
    case "variant":
      return { type, kind: "variant", variant: test.variant, args: test.args };
    case "some":
      return { type, kind: "some", inner: test.inner, arg: test.arg };
    case "none":
      return { type, kind: "none" };
    case "or":
      return { type, kind: "or", alternatives: test.alternatives };
    case "object":
      return { type, kind: "object", shapes: test.shapes, fields: test.fields };
    case "array":
      return { type, kind: "array", element: test.element, items: test.items };
  }
  return { type, kind: "any" };
}

// A copy of a call, for one made from it.
function callNode(e: Ref<Call>): Call {
  const copy = cloneExpr(e);
  if (copy.kind === "call") return copy;
  return { id: e.id, kind: "call", callee: cloneExpr(e.callee), typeArgs: [], args: [], optional: e.optional, start: e.start, end: e.end };
}

// A copy of a call or `new` with other arguments.
function withArgs(e: Ref<Extract<Expr, { kind: "call" | "new" }>>, args: Expr[]): Expr {
  let copy = cloneExpr(e);
  if (copy.kind === "call") return { ...copy, args };
  if (copy.kind === "new") return { ...copy, args };
  return copy;
}

// Copies of type nodes, for a node made from another.
function cloneTypeNodes(list: Ref<TypeNode[]>): TypeNode[] {
  let out: TypeNode[] = [];
  for (const t of list) out.push(cloneTypeNode(t));
  return out;
}

// Copies of a tuple type's elements.
function cloneElements(list: Ref<Extract<TypeNode, { kind: "tuple" }>["elements"]>): Extract<TypeNode, { kind: "tuple" }>["elements"] {
  let out: Extract<TypeNode, { kind: "tuple" }>["elements"] = [];
  for (const x of list) out.push({ id: x.id, name: x.name, type: cloneTypeNode(x.type), optional: x.optional, rest: x.rest, start: x.start, end: x.end });
  return out;
}

// What walking a pipe's right side finds, in order: its `%`s, the trees to walk in their place,
// and `%`s assigned.
function topicEvents(body: Ref<Expr>, rewrites: Ref<Rewrites>): TopicEvent[] {
  let events: TopicEvent[] = [];
  walkWhile({ of: "expr", node: body }, (item) => {
    if (item.of !== "expr") return true;
    const now = rewrites.rewritten(item.node);
    if (now !== undefined) {
      events.push({ walk: true, node: now, assigned: false });
      return false;
    }
    const n = item.node;
    if (n.kind === "assign" && n.target.kind === "topic") events.push({ walk: false, node: cloneExpr(n.target), assigned: true });
    if (n.kind === "update" && n.operand.kind === "topic") events.push({ walk: false, node: cloneExpr(n.operand), assigned: true });
    if (n.kind === "topic") {
      events.push({ walk: false, node: cloneExpr(n), assigned: false });
      return false;
    }
    if (n.kind === "pipe") {
      events.push({ walk: true, node: cloneExpr(n.value), assigned: false });
      return false;
    }
    return true;
  });
  return events;
}

// Whether a function declares type parameters other than lifetimes.
function genericIn(f: Ref<Body> | undefined): boolean {
  if (f === undefined || f.typeParams === undefined) return false;
  for (const p of f.typeParams) if (!isLifetime(p)) return true;
  return false;
}

// The strings of `String.raw`'s first argument when called, `{ raw: [...] }` of string literals.
function rawStrings(first: Ref<Expr>): string[] | undefined {
  if (first.kind !== "object" || first.props.length !== 1) return undefined;
  const prop = first.props[0]!;
  if (prop.kind !== "property" || prop.key !== "raw" || prop.value.kind !== "array") return undefined;
  let strings: string[] = [];
  for (const p of prop.value.elements) {
    if (p === undefined || p.kind !== "string") return undefined;
    strings.push(p.value);
  }
  return strings;
}

// A path as a message shows it, the collection a class extending Map or Set embeds left unsaid.
const shownPath = (path: string) => path.replaceAll(`.${EMBEDDED}`, "");

// How an index reads in a message: a name or a number as written, anything else as `...`.
export function indexText(e: Ref<Expr>): string {
  return e.kind === "ident" ? e.name : e.kind === "int" ? String(e.value) : "...";
}
