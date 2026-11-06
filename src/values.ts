import type { Tables } from "./compilation.ts";
import { stdModuleAt, textAt } from "./program.ts";
import { rustClassOf, type RustClass } from "./rust.ts";
import { abstractIn, copyFor, inherited, selfTyped, shownName, isLifetime, type Body, type ClassInfo, type FieldDecl } from "./classes.ts";
import { openParam } from "./typefns.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { Direct } from "./overloads.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, Interface, ObjectProp, Param, Pattern, Span, Stmt, TypeMember, TypeNode } from "./parser.ts";
import { bindings, literalOf, made, missing, objectFields, uncovered, type PatternInfo, type PatternTest, type Shape } from "./match.ts";
import { channel, collection, fields, COUNTED_UNLOCKED, counted, interior, shareable, tagStrings, type InScope } from "./resolve.ts";
import { infer } from "./generics.ts";
import { EMBEDDED, ITERATOR, MAP_METHODS, SET_METHODS, TypeMap, tupleElements, type ParamRecord, type FunctionRecord, type FutureType, type ParamType, type InteriorRecord, TypeSet, SLEEP, YIELD_NOW, INTEGERS, isFloat, isInteger, isNumeric, redundantBang, bare as bareOf, type Bang, range, type DynType, type HandleType, type BlockType, type SharedType, INTERIORS, type InteriorType, type InterfaceType, type Method, type Typing, TYPED_ARRAYS, isTypedName, typedSize, type TypedName } from "./typing.ts";
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
import { forEachChild, nextId, NodeMap, NodeSet, renumberExpr, respanExpr, someNode, walk, walkWhile, type AnyNode } from "./nodes.ts";
import { cloneExpr, rebuiltExpr } from "./rebuild.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

// `String.raw`'s text: the parts as written, each value between two, as a template; a literal
// value is folded into the text, so a template of literals is a constant.
function rawTemplate(parts: string[], values: Expr[], at: Span): Expr {
  const quasis = [parts[0] ?? ""];
  const exprs: Expr[] = [];
  values.forEach((x, i) => {
    const after = parts[i + 1] ?? "";
    const text = literalText(x);
    if (text === undefined) {
      exprs.push(x);
      quasis.push(after);
    } else {
      quasis[quasis.length - 1] += text + after;
    }
  });
  // Parts with no value between them, which only the call form gives, run together.
  quasis[quasis.length - 1] += parts.slice(values.length + 1).join("");
  return { id: 0, kind: "template", quasis, raw: quasis, exprs, start: at.start, end: at.end };
}

// The text of a literal as a template would splice it in.
function literalText(x: Expr): string | undefined {
  if (x.kind === "string") return x.value;
  if (x.kind === "bool") return String(x.value);
  if (x.kind === "int" && x.value <= I64_MAX) return String(x.value);
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
function holdsFloat(typing: Typing, t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
  if (typeof t === "string") return isFloat(t);
  if (seen.has(t)) return false;
  seen.add(t);
  const x = typing.rec(t) as unknown as Record<string, unknown>;
  const parts = ["to", "of", "concrete", "element", "key", "value", "base"].flatMap((k) => (typeof x[k] === "number" || typeof x[k] === "string" ? [x[k] as Type] : []));
  if (Array.isArray(x.members)) parts.push(...(x.members as Type[]));
  parts.push(...typing.fieldsOf(t).map((f) => f.type));
  return parts.some((p) => holdsFloat(typing, p, seen));
}


// What expression checking needs from the program and the function it is in.
export type Context = {
  tables: Tables;
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
  enumMember(name: string, member: string): LiteralType | undefined;
  /** @throws {CompileError} */
  enumMemberNames(name: string): string[];
  // A data-carrying enum made with these type arguments.
  /** @throws {CompileError} */
  enumInstance(info: EnumInfo, args: Type[], at: Span): EnumInstance;
  /** @throws {CompileError} */
  construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined;
  // A generic class's constructor parameters as written.
  templateParams(name: string): Param[] | undefined;
  // A generic class as its definition is checked, whose statics every instance shares.
  definedClass(name: string): ClassInfo | undefined;
  members(): Members;
  exprsState: ExpressionsState;
  /** @throws {CompileError} */
  returnOf(instance: Instance, at: Span): Type;
  // What a call returns as the calling body sees it: in terms of the calling instance's own
  // type parameters, where it passed them.
  /** @throws {CompileError} */
  resultOf(instance: Instance, at: Span): Type;
  // What a call's returned reference borrows from, and the record of it for each call.
  /** @throws {CompileError} */
  sourcesOf(instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[];
  borrowsFrom: NodeMap<Expr, Expr[]>;
  /** @throws {CompileError} */
  classOf(t: ClassType): ClassInfo;
  /** @throws {CompileError} */
  instanceOf(f: Body, bindings?: Map<string, Type>): Instance;
  /** @throws {CompileError} */
  instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance;
  /** @throws {CompileError} */
  paramTypes(instance: Instance): Type[];
  // The binding a name refers to; `at`, the use, is where a closure first captures it.
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  // The binding a name refers to, without capturing it, and this body's binding for a variable
  // of a body around it, captured if need be.
  peek(name: string): Local | undefined;
  reach(l: Local, at?: Expr | ObjectProp): Local;
  // The names a use at `at` reaches, its bindings in scope then top-level values, for suggesting one.
  names(at: usize): string[];
  // The names of the classes, generic ones included, a use at `at` reaches.
  classNames(at: usize): string[];
  // Records the bindings a call of a nested function builds its environment from.
  envOf(e: Expr, of: Instance, env: Local[]): void;
  dynOf(e: Expr, table: DynTable): void;
  // Whether a binding is the one a sync nested function's declaration makes.
  nestedLocal(l: Local): boolean;
  // Whether this is a closure owning what it captures: async, or `move`.
  owning: boolean;
  // Notes a closure's use of `this`, which it captures.
  noteThis(e: Expr): void;
  self: Body["self"];
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  // A derived constructor's `super(...)`, the one place a base constructor may be called.
  superCall: Expr | undefined;
  // A nested function calling itself by name, typed by its own signature.
  /** @throws {CompileError} */
  selfCall(e: Call): { type: Type; what: string } | undefined;
  // Whether this `this` may be used: a constructor's can't until every field is assigned.
  thisReady(e: Expr): boolean;
  // Narrowing: what a condition proves, checking under what was proven, and a variable's
  // type where something narrowed it.
  /** @throws {CompileError} */
  proves(e: Expr): Guard;
  /** @throws {CompileError} */
  assume<T>(proven: Facts, check: InScope<T>): T;
  // Runs a match arm in a scope of its own, holding the names its pattern binds.
  /** @throws {CompileError} */
  arm<T>(check: InScope<T>): T;
  // Checks a match arm's block, whose `return`s give the arm its value: each value and its type.
  /** @throws {CompileError} */
  block(arm: Extract<Stmt, { kind: "block" }>, wanted: boolean): [Expr, Type][];
  // What each match pattern tests, for codegen.
  patterns: NodeMap<Pattern, PatternInfo>;
  copiesOut: NodeSet<Expr>;
  // Declares a name a pattern binds, read-only, in the arm's scope.
  /** @throws {CompileError} */
  bind(name: string, type: Type, node: Expr): Local;
  narrowed(l: Local): Type | undefined;
  forget(l: Local, at: Span): void;
  /** @throws {CompileError} */
  lendsWhole(l: Local, at: Expr): void;
  // Notes a read of a variable as narrowed.
  narrowRead(l: Local, at: Expr): void;
  // A field's type where a check narrowed its path, noting the read; and a change at a path
  // inside a binding or `this`, which forgets what was known below it.
  narrowedField(e: Expr): Type | undefined;
  // Whether a check proved an interface's optional method there on a value.
  present(object: Expr, name: string): boolean;
  /** @throws {CompileError} */
  changesPath(root: Local | "this", path: string, action: string, at: Expr): void;
  // The instance being checked.
  instance: Instance;
  // False for a binding declared in another case of a switch, which entering this case skips.
  reachable(l: Local): boolean;
  // Records an error a call raises, and what the instance called may throw.
  /** @throws {CompileError} */
  raise(at: Expr, type: Type, what: string): void;
  // Checks comptime code, which may throw any error: one it doesn't catch is a compile error.
  /** @throws {CompileError} */
  comptime<T>(check: InScope<T>): T;
  // Checks what a `throw` raises.
  /** @throws {CompileError} */
  thrown(at: Expr, value: Expr): void;
  /** @throws {CompileError} */
  errorOf(instance: Instance): Type | undefined;
  // What the body's function declares it throws.
  throwsDeclared(): Type | undefined;
  // Checks the body as written first, when this is an instance of a generic one, so what that
  // check decides holds for every instance.
  /** @throws {CompileError} */
  asWritten(): void;
  // Whether the body is a sync `main` run as an async one, as a program setting timers does.
  syncMain: boolean;
  // Whether a binding stands for a variable a closure captures, and whether this is a closure;
  // and a change to a capture, `this` when undefined, which makes it mutable.
  captured(l: Local): boolean;
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
  yielding(e: Extract<Expr, { kind: "yield" }>): Type;
  // Whether the body is a closure written inside `unsafe`.
  unsafe: boolean;
  /** @throws {CompileError} */
  changesCapture(l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean): void;
  // Records a whole write through a narrowed mutable reference that may change its member.
  /** @throws {CompileError} */
  rewritten(l: Local, at: Expr): void;
  // How deeply nested the scope declaring a binding is.
  depthOf(l: Local): usize;
  // A written type, as this body sees it.
  /** @throws {CompileError} */
  resolveType(t: TypeNode): Type;
  // An arrow function's type, its body checked; and the instance a closure type runs.
  // A closure written inside `unsafe` is checked inside it too.
  /** @throws {CompileError} */
  closure(e: Extract<Expr, { kind: "arrow" }>, expected?: FunctionType, unsafe?: boolean, owning?: boolean): ClosureType;
  // Makes a generic arrow written as a value a generic function of its own, the arrow its name.
  /** @throws {CompileError} */
  liftArrow(e: Extract<Expr, { kind: "arrow" }>): Expr;
  // A type node resolved with type parameters bound, as a generic function type's for a call.
  /** @throws {CompileError} */
  resolveWith(t: TypeNode, scope: Map<string, Type>): Type;
  closureBody(t: ClosureType): Instance;
  // The bounds of a body's implicit type parameters, by parameter index.
  /** @throws {CompileError} */
  implicitOf(f: Body): Map<usize, Bound>;
  // The type an arrow argument of a generic body is checked against, once the others are known.
  /** @throws {CompileError} */
  callbackType(f: Body, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: usize, at: Span): FunctionType | undefined;
  // Rejects a constructor call lending a value mutably as a type parameter that would let its
  // read-only fields be written.
  /** @throws {CompileError} */
  constructs(f: Body, args: Expr[], argTypes: Type[]): void;
  // Whether a variable whose type is still open takes `to`, for a use needing it.
  infer(e: Expr, to: Type): boolean;
};

// The ways several Promises are awaited at once.
type Combiner = "all" | "race" | "allSettled" | "any";
const COMBINERS: string[] = ["all", "race", "allSettled", "any"];
// The timer globals, Node's and the browser's.
const TIMER_CALLS = new Set(["setTimeout", "setInterval", "clearTimeout", "clearInterval"]);

// What a literal format does with the arguments after it, as the runtime's routine reads it:
// the specifier each one it takes is given to, and where those left, appended, start.
export function formatPlan(format: string, count: usize): { specs: string[]; rest: usize } {
  const specs: string[] = [];
  let taken = 0;
  let last = 0;
  for (let i = 0; i < format.length - 1; i++) {
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
export function regexStringType(typing: Typing, name: string, rx: RegexType, unknown: boolean): Type {
  if (name === "search") return "i64";
  if (name === "match") return typing.rec(rx).flags.includes("g") ? typing.unionType([typing.arrayType("string"), "null"]) : typing.unionType([typing.matchType(rx), "null"]);
  if (name === "matchAll") return typing.arrayType(typing.matchType(rx));
  if (name === "split") return typing.arrayType(typing.rec(rx).captures.some((c) => c.optional) || unknown ? typing.unionType(["string", "null"]) : "string");
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
  const family = Object.keys(INTEGER_METHODS).find((f) => name.startsWith(f));
  const operation = family && name.slice(family.length);
  return family && INTEGER_METHODS[family]!.includes(operation!) ? [family, operation!] : undefined;
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
// the tuple read printed before `restSuffix`; nothing for any other read.
export function restBase<A extends Lifetime>(restStarts: Ref<Tables["restStarts"]>, e: Ref<Expr, A>): Ref<Expr, A> | undefined {
  if (e.kind === "index" && e.index.kind === "int" && restStarts.has(e.object) && e.object.kind === "member") return e.object.object;
  if (e.kind === "member" && restStarts.has(e)) return e.object;
  return undefined;
}

export function restSuffix(restStarts: Ref<Tables["restStarts"]>, e: Ref<Expr>): string {
  if (e.kind === "index" && e.index.kind === "int") return `[${BigInt(restStarts.get(e.object)!) + e.index.value}]`;
  return `[${restStarts.get(e)}...]`;
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
  writing: Expr | undefined;
  // That place, when the write reads it first, as `+=` and `++` do, keeping its member.
  updating: Expr | undefined;
  // The assignment an expression statement is, whose value nothing uses.
  statementAssign: Expr | undefined;
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

export class Expressions<C extends Context> implements Union {
  ctx: Mut<C>;

  constructor(ctx: Mut<C>) {
    this.ctx = ctx;
    this.asserts = this.ctx.tables.asserts;
    this.awaitedNow = this.ctx.tables.awaitedNow;
    this.clocks = this.ctx.tables.clocks;
    this.combinedCalls = this.ctx.tables.combinedCalls;
    this.computed = this.ctx.tables.computed;
    this.dictCalls = this.ctx.tables.dictCalls;
    this.declaredTypes = this.ctx.tables.declaredTypes;
    this.deepEqualities = this.ctx.tables.deepEqualities;
    this.defaulted = this.ctx.tables.defaulted;
    this.joinCalls = this.ctx.tables.joinCalls;
    this.integerCalls = this.ctx.tables.integerCalls;
    this.dynCalls = this.ctx.tables.dynCalls;
    this.optionalCalls = this.ctx.tables.optionalCalls;
    this.presenceTests = this.ctx.tables.presenceTests;
    this.dynMembers = this.ctx.tables.dynMembers;
    this.boxedMembers = this.ctx.tables.boxedMembers;
    this.madeArrows = this.ctx.tables.madeArrows;
    this.equalities = this.ctx.tables.equalities;
    this.fallbacks = this.ctx.tables.fallbacks;
    this.fileCalls = this.ctx.tables.fileCalls;
    this.filling = this.ctx.tables.filling;
    this.fills = this.ctx.tables.fills;
    this.fixedFills = this.ctx.tables.fixedFills;
    this.fixedPrints = this.ctx.tables.fixedPrints;
    this.formatCalls = this.ctx.tables.formatCalls;
    this.inspectCalls = this.ctx.tables.inspectCalls;
    this.jsAccessors = this.ctx.tables.jsAccessors;
    this.jsBodies = this.ctx.tables.jsBodies;
    this.jsCalledAt = this.ctx.tables.jsCalledAt;
    this.jsCalls = this.ctx.tables.jsCalls;
    this.jsClasses = this.ctx.tables.jsClasses;
    this.jsCrossings = this.ctx.tables.jsCrossings;
    this.jsEmptyTests = this.ctx.tables.jsEmptyTests;
    this.jsEvaluations = this.ctx.tables.jsEvaluations;
    this.jsExports = this.ctx.tables.jsExports;
    this.jsGiven = this.ctx.tables.jsGiven;
    this.jsMembers = this.ctx.tables.jsMembers;
    this.jsMethods = this.ctx.tables.jsMethods;
    this.jsNews = this.ctx.tables.jsNews;
    this.jsOptionalOf = this.ctx.tables.jsOptionalOf;
    this.jsStatics = this.ctx.tables.jsStatics;
    this.jsUses = this.ctx.tables.jsUses;
    this.jsonCalls = this.ctx.tables.jsonCalls;
    this.kindTests = this.ctx.tables.kindTests;
    this.keyTests = this.ctx.tables.keyTests;
    this.lengthChecks = this.ctx.tables.lengthChecks;
    this.maths = this.ctx.tables.maths;
    this.namedParams = this.ctx.tables.namedParams;
    this.ofElements = this.ctx.tables.ofElements;
    this.packed = this.ctx.tables.packed;
    this.pairs = this.ctx.tables.pairs;
    this.parsedArgs = this.ctx.tables.parsedArgs;
    this.parses = this.ctx.tables.parses;
    this.presetParams = this.ctx.tables.presetParams;
    this.presetTypes = this.ctx.tables.presetTypes;
    this.printCalls = this.ctx.tables.printCalls;
    this.printed = this.ctx.tables.printed;
    this.promiseVariants = this.ctx.tables.promiseVariants;
    this.quotes = this.ctx.tables.quotes;
    this.regexCalls = this.ctx.tables.regexCalls;
    this.regexNews = this.ctx.tables.regexNews;
    this.regexStringCalls = this.ctx.tables.regexStringCalls;
    this.stringBuilds = this.ctx.tables.stringBuilds;
    this.substituted = this.ctx.tables.substituted;
    this.syncFileCalls = this.ctx.tables.syncFileCalls;
    this.blockingRuns = this.ctx.tables.blockingRuns;
    this.tagCalls = this.ctx.tables.tagCalls;
    this.timerCalls = this.ctx.tables.timerCalls;
    this.timerNames = this.ctx.tables.timerNames;
    this.timerSets = this.ctx.tables.timerSets;
    this.timerWrappers = this.ctx.tables.timerWrappers;
    this.tupleLiterals = this.ctx.tables.tupleLiterals;
    this.unusedDefaults = this.ctx.tables.unusedDefaults;
    this.restStarts = this.ctx.tables.restStarts;
    this.upcasts = this.ctx.tables.upcasts;
    this.typing = this.ctx.tables.typing;
    this.ids = this.ctx.tables.ids;
    this.regex = this.ctx.tables.regex;
    this.files = this.ctx.tables.files;
    this.arenas = this.ctx.tables.arenas;
    this.rewrites = this.ctx.tables.rewrites;
    this.types = this.ctx.types;
    this.locals = this.ctx.locals;
    this.coercions = this.ctx.coercions;
    this.calls = this.ctx.calls;
    this.setters = this.ctx.setters;
    this.byName = this.ctx.byName;
    this.classes = this.ctx.classes;
    this.enums = this.ctx.enums;
    this.borrowsFrom = this.ctx.borrowsFrom;
    this.self = this.ctx.self;
    this.owner = this.ctx.owner;
    this.superCall = this.ctx.superCall;
    this.closing = this.ctx.closing;
  }
  private asserts: Tables["asserts"];
  private awaitedNow: Tables["awaitedNow"];
  private clocks: Tables["clocks"];
  private combinedCalls: Tables["combinedCalls"];
  private computed: Tables["computed"];
  private dictCalls: Tables["dictCalls"];
  private declaredTypes: Tables["declaredTypes"];
  private deepEqualities: Tables["deepEqualities"];
  private defaulted: Tables["defaulted"];
  private joinCalls: Tables["joinCalls"];
  private integerCalls: Tables["integerCalls"];
  private dynCalls: Tables["dynCalls"];
  private optionalCalls: Tables["optionalCalls"];
  private presenceTests: Tables["presenceTests"];
  private dynMembers: Tables["dynMembers"];
  private boxedMembers: Tables["boxedMembers"];
  private madeArrows: Tables["madeArrows"];
  private equalities: Tables["equalities"];
  private fallbacks: Tables["fallbacks"];
  private fileCalls: Tables["fileCalls"];
  private filling: Tables["filling"];
  private fills: Tables["fills"];
  private fixedFills: Tables["fixedFills"];
  private fixedPrints: Tables["fixedPrints"];
  private formatCalls: Tables["formatCalls"];
  private inspectCalls: Tables["inspectCalls"];
  private jsAccessors: Tables["jsAccessors"];
  private jsBodies: Tables["jsBodies"];
  private jsCalledAt: Tables["jsCalledAt"];
  private jsCalls: Tables["jsCalls"];
  private jsClasses: Tables["jsClasses"];
  private jsCrossings: Tables["jsCrossings"];
  private jsEmptyTests: Tables["jsEmptyTests"];
  private jsEvaluations: Tables["jsEvaluations"];
  private jsExports: Tables["jsExports"];
  private jsGiven: Tables["jsGiven"];
  private jsMembers: Tables["jsMembers"];
  private jsMethods: Tables["jsMethods"];
  private jsNews: Tables["jsNews"];
  private jsOptionalOf: Tables["jsOptionalOf"];
  private jsStatics: Tables["jsStatics"];
  private jsUses: Tables["jsUses"];
  private jsonCalls: Tables["jsonCalls"];
  kindTests: Tables["kindTests"];
  keyTests: Tables["keyTests"];
  private lengthChecks: Tables["lengthChecks"];
  private maths: Tables["maths"];
  private namedParams: Tables["namedParams"];
  private ofElements: Tables["ofElements"];
  private packed: Tables["packed"];
  private pairs: Tables["pairs"];
  private parsedArgs: Tables["parsedArgs"];
  private parses: Tables["parses"];
  private presetParams: Tables["presetParams"];
  private presetTypes: Tables["presetTypes"];
  private printCalls: Tables["printCalls"];
  private printed: Tables["printed"];
  private promiseVariants: Tables["promiseVariants"];
  private quotes: Tables["quotes"];
  private regexCalls: Tables["regexCalls"];
  private regexNews: Tables["regexNews"];
  private regexStringCalls: Tables["regexStringCalls"];
  private stringBuilds: Tables["stringBuilds"];
  private substituted: Tables["substituted"];
  private syncFileCalls: Tables["syncFileCalls"];
  private blockingRuns: Tables["blockingRuns"];
  private tagCalls: Tables["tagCalls"];
  private timerCalls: Tables["timerCalls"];
  private timerNames: Tables["timerNames"];
  private timerSets: Tables["timerSets"];
  private timerWrappers: Tables["timerWrappers"];
  private tupleLiterals: Tables["tupleLiterals"];
  private unusedDefaults: Tables["unusedDefaults"];
  private restStarts: Tables["restStarts"];
  private upcasts: Tables["upcasts"];
  typing: Tables["typing"];
  private ids: Tables["ids"];
  private regex: Tables["regex"];
  private files: Tables["files"];
  private arenas: Tables["arenas"];
  private rewrites: Tables["rewrites"];
  private recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.typing.rec(t as Exclude<T, string>);
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
    return r?.kind === "dyn" && this.typing.callableOf.has(r.of);
  }
  // Whether a value holds a future, which an array element or a sort's order can't be.
  private holdsFuture(t: Type): boolean {
    return typeof t !== "string" && (this.typing.rec(t).kind === "future" || this.typing.promiseElement(t) !== undefined);
  }
  types: NodeMap<Expr, Type>;
  private locals: NodeMap<Expr | Stmt | Param | ObjectProp, LocalId>;
  coercions: NodeMap<Expr, Type>;
  private calls: NodeMap<Expr, InstanceId>;
  private setters: NodeMap<Expr, InstanceId>;
  private byName: Map<string, BodyId>;
  private classes: Map<string, ClassId>;
  private enums: Map<string, EnumInfo>;
  private borrowsFrom: NodeMap<Expr, Expr[]>;
  private self: Body["self"];
  private owner: ClassType | undefined;
  private superCall: Expr | undefined;
  private closing: boolean;
  private localAt(n: Expr | Stmt | Param | ObjectProp) {
    return this.arenas.localOf(this.locals.get(n));
  }
  // An expression as checking has it so far, its redundant `!`s taken off.
  private bare(e: Expr): Expr {
    const now = this.rewrites.current(e);
    const off = bareOf(now);
    return off.id === now.id ? now : this.bare(off);
  }
  private bodyNamed(name: string) {
    return this.arenas.bodyOf(this.byName.get(name));
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
  private needsUnsafe(what: string, at: Span, why = "the compiler can't check what a raw pointer points to") {
    if (this.ctx.exprsState.unsafeDepth === 0) throw new CompileError("E1001", `${what} can only happen inside 'unsafe { }': ${why}, so you vouch for it there`, at.start, at.end);
  }

  // Literals too large for an i64 that nothing gave a wider type.
  /** @throws {CompileError} */
  finish() {
    const integral = this.ctx.exprsState.powers.find(([power]) => isInteger(this.types.get(power)!));
    if (integral) {
      const [, exponent] = integral;
      throw new CompileError("E0110", "the exponent of '**' on an integer is a 'u32', which can't hold this; write the power as a float, like '2.0 ** -1'", exponent.start, exponent.end);
    }
    const unfit = this.ctx.exprsState.oversized.find((e) => this.types.get(e) === "i64" && !this.ctx.exprsState.fitted.has(e));
    if (unfit) throw new CompileError("E0110", "integer literal does not fit in i64", unfit.start, unfit.end);
  }

  // An expression of only number literals and operators takes the number type it meets where
  // it is written, as `1` does in `let a: u8 = 1` or `a + 1`.
  // A float literal only becomes a float type.
  /** @throws {CompileError} */
  adapt(this: Mut<this>, e: Expr, to: Type): boolean {
    e = this.rewrites.current(e);
    // A loose brand takes its base's literals, which fit it.
    const brand = this.recOf(to);
    if (brand?.kind === "brand" && brand.loose) to = brand.base;
    if (!isNumeric(to)) return false;
    if (e.kind === "unsafe" || e.kind === "comptime") {
      if (!this.adapt(e.expr, to)) return false;
      this.types.set(e, to);
      return true;
    }
    // A `?:` or match whose every branch is a number literal gives the number type it meets.
    if (e.kind === "conditional" || e.kind === "match") {
      const branches = e.kind === "conditional" ? [e.then, e.else].filter((s) => this.types.has(s)) : e.arms.map((a) => a.body);
      if (!branches.every((b) => b.kind !== "block" && this.literalOnly(b, isFloat(to)))) return false;
      for (const b of branches) this.retype(b as Expr, to, false);
      this.types.set(e, to);
      return true;
    }
    if (!this.literalOnly(e, isFloat(to))) return this.ctx.infer(e, to);
    this.retype(e, to, false);
    return true;
  }

  literalOnly(e: Expr, floats: boolean): boolean {
    e = this.rewrites.current(e);
    if (e.kind === "unsafe" || e.kind === "comptime") return this.literalOnly(e.expr, floats);
    if (e.kind === "int" || (e.kind === "float" && floats)) return true;
    if (e.kind === "unary") return (e.op === "-" || (e.op === "~" && !floats)) && this.literalOnly(e.operand, floats);
    return e.kind === "binary" && LITERAL_OPERATORS.has(e.op) && (!floats || !BITWISE_OPERATORS.has(e.op)) && this.literalOnly(e.left, floats) && this.literalOnly(e.right, floats);
  }

  /** @throws {CompileError} */
  private retype(this: Mut<this>, e: Expr, to: Numeric, negated: boolean): void {
    e = this.rewrites.current(e);
    this.types.set(e, to);
    if (e.kind === "unary") {
      if (e.op === "-" && isInteger(to) && !INTEGERS[to].signed) {
        throw new CompileError("E0110", `'${this.typing.show(to)}' is unsigned, so it can't be negative; use a signed type like 'i64'`, e.start, e.end);
      }
      return this.retype(e.operand, to, e.op === "-" && !negated);
    }
    if (e.kind === "binary") {
      this.retype(e.left, to, false);
      // An integer's exponent stays a `u32`.
      return this.retype(e.right, e.op === "**" && isInteger(to) ? "u32" : to, false);
    }
    if (e.kind !== "int" || !isInteger(to)) return;
    const [min, max] = range(to);
    const value = negated ? -e.value : e.value;
    if (value < min || value > max) {
      throw new CompileError("E0110", `'${negated ? "-" : ""}${e.value}' doesn't fit in '${this.typing.show(to)}', which holds ${min} to ${max}`, e.start, e.end);
    }
    this.ctx.exprsState.fitted.add(e);
  }

  // What a closure or a generic enum's member is expected to be, from where it goes, since
  // neither can always tell its own type: a closure its parameters', an enum its type arguments.
  /** @throws {CompileError} */
  expect(this: Mut<this>, e: Expr, t: Type) {
    e = this.keyed(this.rewrites.current(e));
    // Callers pass what a parameter list has, which may run out.
    if (t !== undefined) t = this.typing.unfolded(t);
    // A literal lent to a reference is a temporary of the type it refers to.
    if ((e.kind === "object" || e.kind === "array") && this.isRefType(t)) t = this.typing.unfolded(this.typing.rec(t).to);
    if (e.kind === "object" && t !== undefined && this.dictOf(t)) return this.dictLiteral(e, t as MapType);
    // An optional field's dictionary, too.
    const dict = e.kind === "object" ? this.optionalDict(t) : undefined;
    if (e.kind === "object" && dict) return this.dictLiteral(e, dict);
    // A generic function value meeting a function type that isn't generic is the one instance
    // that type gives it: an arrow calling it, its parameters typed from there.
    const r = this.recOf(t);
    if ((r?.kind === "function" && !r.generic) || (r?.kind === "dyn" && this.isCallable(t) && !this.recOf(this.typing.callableOf.get(r.of))?.generic)) e = this.instanceArrow(e);
    if (e.kind === "arrow" && r?.kind === "function") this.ctx.exprsState.expecting.set(e, t as FunctionType);
    // An object literal meeting a JS shape, or an Option of one, takes the types of its fields.
    const shapes = t === undefined ? [] : (r?.kind === "union" ? r.members : [t]).flatMap((m) => this.typing.jsShape(m) ?? []);
    if (e.kind === "object" && shapes.length === 1) {
      for (const p of e.props) {
        const declared = p.kind === "property" ? this.typing.rec(shapes[0]!).fields.find((f) => f.name === p.key)?.type : undefined;
        if (declared && p.kind === "property") this.expect(p.value, declared);
      }
    }
    // A `new Promise`, `Promise.resolve` or `Promise.reject` meeting a `Promise<T>`, or awaited
    // where a T is wanted, takes its T from there.
    const makesPromise = (x: Expr) => (x.kind === "new" && x.callee.kind === "ident" && x.callee.name === "Promise") || (x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise");
    if (t !== undefined && makesPromise(e) && this.promiseMet(t) !== undefined) this.ctx.exprsState.wanted.set(e, t);
    if (t !== undefined && e.kind === "unary" && e.op === "await" && makesPromise(e.operand)) this.ctx.exprsState.awaitedAs.set(e.operand, t);
    // An arrow for a union holding one callable, like an optional callback, is stored as that
    // callable.
    const callables = e.kind === "arrow" && r?.kind === "union" ? r.members.filter((m) => this.isCallable(m)) : [];
    if (callables.length === 1) t = callables[0]!;
    // A value written where a Dyn is wanted, as an object literal's field, is boxed into it there.
    const box = t === undefined ? undefined : this.boxedIn(t);
    if (e.kind !== "arrow" && box) this.ctx.exprsState.wanted.set(e, box);
    // An arrow written where a callable is stored captures by move: the callable owns it all.
    const stored = this.recOf(t);
    if (e.kind === "arrow" && stored?.kind === "dyn" && this.typing.callableOf.has(stored.of)) {
      this.ctx.exprsState.expecting.set(e, this.typing.callableOf.get(stored.of)!);
      this.ctx.exprsState.owning.add(e);
      this.ctx.exprsState.wanted.set(e, t);
    }
    // An array literal where a union is expected is expected to be its one array, tuple or fixed
    // array member of a length the literal could have.
    const union = this.recOf(t);
    if (e.kind === "array" && union?.kind === "union") {
      const fitting = union.members.filter((m) => this.couldHold(m, e));
      if (fitting.length === 1) t = fitting[0]!;
    }
    // An array literal's elements are expected to be its element type, and an object literal's
    // properties their fields'.
    if (e.kind === "array" && this.isArray(t)) {
      this.ctx.exprsState.wanted.set(e, this.typing.rec(t).element);
      for (const x of e.elements) if (x) this.expect(x.kind === "spread" ? x.value : x, x.kind === "spread" ? t : this.typing.rec(t).element);
    }
    // A literal where a fixed array is expected is that fixed array; an Option or union holding
    // one fixed array expects that one.
    const holdingFixed = this.recOf(t);
    if ((e.kind === "array" || e.kind === "call") && holdingFixed?.kind === "union" && holdingFixed.members.filter((m): m is FixedType => this.isFixed(m)).length === 1) t = holdingFixed.members.find((m): m is FixedType => this.isFixed(m))!;
    if (e.kind === "array" && this.isFixed(t)) {
      this.ctx.exprsState.fixedLiterals.set(e, t);
      for (const x of e.elements) if (x) this.expect(x, this.typing.rec(t).element);
    }
    if (e.kind === "call" && this.isFixed(t)) this.ctx.exprsState.wanted.set(e, t);
    // A literal where a tuple is expected is that tuple, each element expected to be its own; an
    // Option or union holding one tuple expects that tuple.
    const holdingTuple = this.recOf(t);
    if ((e.kind === "array" || this.tupleLiterals.has(e)) && holdingTuple?.kind === "union" && holdingTuple.members.filter((t) => this.typing.isTuple(t)).length === 1) t = holdingTuple.members.find((t) => this.typing.isTuple(t))!;
    if ((e.kind === "array" || this.tupleLiterals.has(e)) && this.typing.isTuple(t)) {
      this.ctx.exprsState.tuples.set(e, t as ObjectType);
      const elements = this.typing.elementsOf(t as ObjectType);
      this.tupleParts(e).forEach((x, i) => x && elements[i] !== undefined && this.expect(x, elements[i]!));
    }
    if (e.kind === "conditional") {
      this.expect(e.then, t);
      this.expect(e.else, t);
    }
    if (e.kind === "unsafe") this.expect(e.expr, t);
    if (e.kind === "match") for (const arm of e.arms) for (const v of this.armValues(arm.body)) this.expect(v, t);
    if (e.kind === "pipe") this.expect(e.body, t);
    // An object literal where a union is expected is expected to be the member it names: the one
    // with all its names whose literal fields its literals match.
    if (e.kind === "object") t = this.memberNamed(e, t) ?? t;
    if (e.kind === "object" && typeof t !== "string" && (this.typing.rec(t).kind === "object" || this.typing.rec(t).kind === "class")) {
      for (const p of e.props) if (p.kind === "property" && typeof p.key === "string" && this.typing.field(t, p.key)) this.expect(p.value, this.typing.field(t, p.key)!.type);
    }
    if (e.kind === "new" && typeof t !== "string" && (this.typing.rec(t).kind === "interior" || this.typing.rec(t).kind === "block" || this.typing.rec(t).kind === "map" || this.typing.rec(t).kind === "shared")) this.ctx.exprsState.wanted.set(e, t);
    if (e.kind === "call" && e.callee.kind === "ident" && e.callee.name === "shared" && typeof t !== "string" && this.typing.rec(t).kind === "shared") this.ctx.exprsState.wanted.set(e, t);
    const built = e.kind === "call" ? e.callee : e;
    if (built.kind === "member" && built.object.kind === "ident" && !this.ctx.lookup(built.object.name) && this.enums.get(built.object.name)?.data) this.ctx.exprsState.wanted.set(built, t);
  }

  // The member of a union an object literal names: the one with all its names whose literal
  // fields its literals match.
  private memberNamed(e: Extract<Expr, { kind: "object" }>, t: Type): ObjectType | undefined {
    const union = this.recOf(t);
    if (union?.kind !== "union") return undefined;
    const props = e.props.filter((p): p is Extract<typeof p, { kind: "property" }> => p.kind === "property" && typeof p.key === "string");
    const named = union.members.map((t) => this.typing.unfold(t)).filter((m): m is ObjectType => this.recOf(m)?.kind === "object" && props.every((p) => this.typing.field(m as ObjectType as ObjectType, p.key as string)));
    // A field of one literal, or of a union of literals as `kind: "as" | "satisfies"` is, names
    // the member only for a string among them.
    const matching = named.filter((m) => props.every((p) => {
      const f = this.typing.field(m, p.key as string)!.type;
      const isLiteral = (l: Type): l is LiteralType => this.recOf(l)?.kind === "literal";
      const r = this.recOf(f);
      const literals = isLiteral(f) ? [f] : r?.kind === "union" && r.members.every(isLiteral) ? r.members as LiteralType[] : [];
      const value = p.value.kind === "string" ? p.value.value : undefined;
      return literals.length === 0 || literals.some((l) => this.typing.rec(l).value === value);
    }));
    return matching.length === 1 ? matching[0] : undefined;
  }

  // Whether an array literal's length suits `t`: any array's, or a tuple's or fixed array's count.
  private couldHold(t: Type, e: Extract<Expr, { kind: "array" }>): boolean {
    if (this.isArray(t)) return true;
    const n = e.elements.length;
    const spread = e.elements.some((x) => x?.kind === "spread");
    if (this.isFixed(t)) return spread || n === this.typing.rec(t).size;
    if (!this.typing.isTuple(t)) return false;
    const tuple = t as ObjectType;
    const count = this.typing.elementsOf(tuple).length;
    return spread || (n >= (this.typing.rec(tuple).required ?? count) && (this.typing.rec(tuple).rest !== undefined || n <= count));
  }

  // What a match arm gives: its expression, or each value its block's `return`s give, leaving
  // out those of closures and matches inside it, which are theirs.
  private armValues(body: Expr | Stmt): Expr[] {
    if (body.kind !== "block") return [body as Expr];
    const found: Expr[] = [];
    walkWhile({ of: "stmt", node: body }, (n) => {
      if ((n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "match")) || (n.of === "stmt" && n.node.kind === "function")) return false;
      if (n.of === "stmt" && n.node.kind === "return" && n.node.value) found.push(n.node.value);
      return true;
    });
    return found;
  }

  // A call's type, `void` included, or any other expression's.
  /** @throws {CompileError} */
  result(this: Mut<this>, written: Expr): Type {
    let e = this.rewrites.current(written);
    if (e.kind === "tagged" && !this.isQuote(e)) e = this.untag(e);
    if (e.kind !== "call") return this.value(e);
    // A call returning a value records it, as reading any other value does.
    const { type } = this.call(e);
    if (type !== "void") this.types.set(e, type);
    return type;
  }

  // Only a statement may call a function that returns nothing.
  /** @throws {CompileError} */
  effect(this: Mut<this>, written: Expr) {
    let e = this.rewrites.current(written);
    if (e.kind === "tagged" && !this.isQuote(e)) e = this.untag(e);
    if ((e.kind === "assign" || e.kind === "update") && this.staticWrite(e)) e = this.rewrites.current(e);
    if (e.kind === "call") {
      const { type } = this.call(e);
      // A parse read only to check the text still makes its value, which is then dropped.
      if (this.jsonCalls.get(e) === "parse") this.types.set(e, type);
      const r = this.recOf(type);
      if (r?.kind === "future" && this.typing.leafOf.has(type as FutureType)) {
        throw new CompileError("E0302", "this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'", e.start, e.end);
      }
    } else if (e.kind === "match") this.match(e, false);
    else if (e.kind === "pipe") this.pipe(e, false);
    else if (e.kind === "unary" && e.op === "await") {
      const gives = this.awaited(e);
      if (gives !== "void") this.types.set(e, gives);
    }
    else {
      if (e.kind === "assign") this.ctx.exprsState.statementAssign = e;
      this.value(e);
    }
  }

  // `match`: the subject is read once, then each arm's pattern is tried in order, binding names
  // in the arm's own scope, then its guard. Every value of the subject's type must be covered.
  // Used as a statement, its arms may give nothing. Matching a value just made, the bindings own
  // its parts; matching a place, they borrow them. A block arm gives what its `return`s do.
  /** @throws {CompileError} */
  private match(this: Mut<this>, e: Extract<Expr, { kind: "match" }>, wanted: boolean): Type {
    const subject = this.read(e.subject);
    const owning = made(e.subject);
    const given = e.arms.flatMap((arm) => this.ctx.arm((): [Expr, Type][] => {
      this.pattern(arm.pattern, subject, !owning);
      if (arm.guard) this.condition(arm.guard);
      if (arm.body.kind === "block") return this.ctx.block(arm.body, wanted);
      return [[arm.body, wanted ? this.value(arm.body) : this.result(arm.body)]];
    }));
    const example = uncovered(this.typing, this.ids, e.arms.filter((a) => !a.guard).map((a) => [a.pattern]), [subject], this.ctx.patterns);
    if (example) throw new CompileError("E0607", missing(this.typing, example[0]!, subject), e.start, e.subject.end + 1);
    if (!wanted) return "void";
    // Arms that only throw give nothing, so some other arm has to.
    if (given.length === 0) throw new CompileError("E0601", "no arm of this match gives a value; 'return' one from an arm", e.start, e.subject.end + 1);
    // Number literals in an arm take the number type another arm gives, as a conditional's do.
    const types = given.map(([, t]) => t);
    const numeric = types.find((t) => isNumeric(t) && given.every(([v, u]) => u === t || this.literalOnly(v, isFloat(t))));
    if (numeric) given.forEach(([v, t], i) => t !== numeric && this.adapt(v, numeric) && (types[i] = numeric));
    for (let i = 0; i < given.length; i++) given[i]![1] = types[i]!;
    const type = types.every((t) => t === types[0]) ? types[0]! : this.typing.unionType(types);
    if (type !== types[0] && types.some((t) => typeof t !== "string" && this.typing.rec(t).kind === "closure")) throw unsupported("unions holding functions", e);
    if (this.typing.holdsRef(type)) throw new CompileError("E0801", `a match can't give a reference it binds yet; ${this.typing.holdsHandle(type, true) ? "match on a value just made to move its parts out" : "give a copy with '.clone()', or a field of it"}`, e.start, e.subject.end + 1);
    for (const [v, t] of given) if (t !== type) this.coerce(v, t, type, `this arm's '${this.typing.show(t)}' doesn't fit the match's '${this.typing.show(type)}'`);
    return type;
  }

  // `x |> f(%)`. Over a place, the pipe means its right side with the place written for each
  // `%`, so it reads, borrows and moves as that would: the node becomes that expression, and
  // later stages never see a pipe. Over anything else, or a place the right side assigns, the
  // value is made once, as JavaScript reads it, and kept in a hidden read-only binding each `%`
  // names, dropped when the pipe ends unless moved out.
  /** @throws {CompileError} */
  private pipe(this: Mut<this>, e: Extract<Expr, { kind: "pipe" }>, wanted: boolean): Type {
    const type = this.value(e.value);
    const hidden = this.steady(e.value) ? this.hides(e.body, e.value) : undefined;
    if (hidden?.kind === "ident") {
      throw new CompileError("E0004", `this '${hidden.name}' hides the '${hidden.name}' the pipe reads for '%'; rename it`, hidden.start, hidden.end);
    }
    if (!this.steady(e.value) || this.assigns(e.body, e.value)) {
      // A place the right side writes is read once, as JavaScript reads it: a copy, or else a
      // shared borrow, so the write must wait until the topic's last use.
      const borrowed = this.steady(e.value) && !this.typing.isCopy(type);
      const topic = borrowed ? this.typing.refType(type, false) : type;
      if (borrowed) this.coerce(e.value, type, topic, "");
      return this.ctx.arm(() => {
        this.ctx.bind("%", topic, e);
        const body = this.pipeBody(e, (at) => ({ id: nextId(this.ids), kind: "ident", name: "%", start: at.start, end: at.end }));
        if (!wanted) return this.effect(body), "void";
        const given = this.value(body);
        if (this.typing.holdsRef(given)) throw new CompileError("E0801", "a pipe over a value can't give a reference yet, since the value is dropped once the pipe ends; give a copy with '.clone()'", e.start, e.end);
        return given;
      });
    }
    const place = e.value;
    const copies: Expr[] = [];
    const body = this.pipeBody(e, (at) => copies[copies.push(this.spanned(this.freshCopy(place), at)) - 1]!);
    // Once each copy has the id of the `%` it replaces.
    for (const copy of copies) for (let m: Expr = copy; m.kind === "member" || m.kind === "index"; m = m.object) if (m.kind === "member") this.substituted.add(m);
    const became = this.rewrites.replace(e, { ...body });
    if (wanted) return this.value(became);
    this.effect(became);
    return "void";
  }

  // A place as a path: its variable or `this`, then its fields, cut where an element is read,
  // since writing any element of an array may change any other. A redundant `!` is no step.
  private path(e: Expr): string[] | undefined {
    e = this.bare(e);
    const parts: string[] = [];
    for (; e.kind === "member" || e.kind === "index"; e = this.bare(e.object)) parts.unshift(e.kind === "member" ? e.name : "[]");
    const root = e.kind === "ident" ? e.name : e.kind === "this" ? "this" : undefined;
    if (root === undefined) return undefined;
    const all = [root, ...parts];
    return all.includes("[]") ? all.slice(0, all.indexOf("[]")) : all;
  }

  // The names an index in a place reads.
  private indexNames(place: Expr): Set<string> {
    const names = new Set<string>();
    for (let at = this.bare(place); at.kind === "member" || at.kind === "index"; at = this.bare(at.object)) if (at.kind === "index" && at.index.kind === "ident") names.add(at.index.name);
    return names;
  }

  // Whether an expression assigns something the place is, holds or is held in, or an index name.
  private assigns(body: Expr, place: Expr): boolean {
    const own = this.path(place)!;
    const names = this.indexNames(place);
    const overlaps = (target: Expr) => {
      const p = this.path(target);
      if (!p) return false;
      if (p.length === 1 && names.has(p[0]!)) return true;
      return own.slice(0, Math.min(own.length, p.length)).every((s, i) => s === p[i]);
    };
    return someNode({ of: "expr", node: body }, (n) => n.of === "expr" && ((n.node.kind === "assign" && overlaps(n.node.target)) || (n.node.kind === "update" && overlaps(n.node.operand))));
  }

  // A binding the right side declares with a name the place reads, which would capture the
  // place written in for `%`.
  private hides(body: Expr, place: Expr): Expr | undefined {
    const root = this.path(place)![0]!;
    const names = new Set([...this.indexNames(place), ...(root === "this" ? [] : [root])]);
    let found: Expr | undefined;
    const topical = (n: AnyNode) => n.of !== "stmts" && someNode(n, (c) => c.of === "expr" && c.node.kind === "topic");
    // A name a pattern binds, or one its defaults read.
    const declared = (p: Pattern) => walkWhile({ of: "pattern", node: p }, (n) => {
      if (found) return false;
      if (n.of === "pattern" && n.node.kind === "ident" && names.has(n.node.name)) found = { id: n.node.id, kind: "ident", name: n.node.name, start: n.node.start, end: n.node.end };
      else if (n.of === "expr" && n.node.kind === "ident" && names.has(n.node.name)) found = n.node;
      return true;
    });
    // A declaration's scope is the closest arrow, match arm, block, loop or `try` around it; it
    // captures the place only where a `%` is inside that scope.
    const visit = (n: AnyNode, scope: AnyNode) => {
      if (found) return;
      const kind = n.of === "stmt" || n.of === "expr" ? n.node.kind : undefined;
      const opens = n.of === "matchArm" || (n.of === "expr" && kind === "arrow") || (n.of === "stmt" && ["block", "for", "forOf", "forIn", "try"].includes(kind!));
      const within = opens ? n : scope;
      // Parameters, `let` declarators, match patterns, catch parameters and destructuring declare names.
      const declares = n.of === "param" || n.of === "matchArm" || n.of === "declarator" || (n.of === "stmt" && kind === "try") || (n.of === "expr" && kind === "destructure");
      forEachChild(n, (c) => {
        if (declares && c.of === "pattern") {
          if (topical(within)) declared(c.node);
        } else visit(c, within);
      });
    };
    visit({ of: "expr", node: body }, { of: "expr", node: body });
    return found;
  }

  // A place reading it again reads the same value: no part of it runs code.
  private steady(this: Mut<this>, e: Expr): boolean {
    e = this.bare(e);
    if (!this.place(e)) return false;
    for (let at = e; at.kind === "member" || at.kind === "index"; at = this.bare(at.object)) {
      if (at.kind === "index" && at.index.kind !== "int" && at.index.kind !== "ident") return false;
    }
    return true;
  }

  // Replaces a pipe's every `%` with what `replace` makes of it: in its right side, and in the
  // left side of a pipe inside it, whose own right side has a topic of its own. As in TC39, the
  // topic itself is never assigned.
  /** @throws {CompileError} */
  private topics(body: Expr, replace: (topic: Expr) => Expr) {
    const visit = (item: AnyNode) => {
      if (item.of === "expr") {
        const n = this.rewrites.current(item.node);
        if (n !== item.node) return void this.topics(n, replace);
        const target = n.kind === "assign" ? n.target : n.kind === "update" ? n.operand : undefined;
        if (target?.kind === "topic") throw new CompileError("E0004", "'%' can't be assigned; it stands for the pipe's value, so assign to what you piped instead", target.start, target.end);
        if (n.kind === "topic") return void this.rewrites.replace(n, replace(n));
        if (n.kind === "pipe") return void this.topics(n.value, replace);
      }
      forEachChild(item, (c) => visit(c));
    };
    visit({ of: "expr", node: body });
  }

  // A pipe's right side with each `%` replaced: a copy, made once, each node of which replaces the
  // node it copies, so the checker reads the right side whole, as it does any other node.
  /** @throws {CompileError} */
  private pipeBody(e: Extract<Expr, { kind: "pipe" }>, replace: (topic: Expr) => Expr): Expr {
    const made = this.rewrites.current(e.body);
    if (made !== e.body) return made;
    this.topics(e.body, replace);
    const body = rebuiltExpr(e.body, this.rewrites);
    return body === e.body ? this.rewrites.replace(e.body, { ...body }) : body;
  }

  // A copy of `e` with fresh ids, as checking has left it so far.
  private freshCopy(e: Expr): Expr {
    return renumberExpr(cloneExpr(rebuiltExpr(cloneExpr(e), this.rewrites)), () => nextId(this.ids));
  }

  // A copy of an expression standing where `at` was, for messages and for keys by position.
  private spanned(e: Expr, at: Expr): Expr {
    return respanExpr(e, at);
  }

  // Checks a pattern against the type of the value it meets, declaring what it binds and
  // recording what it tests. A name is a unit member of the matched enum, or an Option's
  // `None`, before it is a binding. A borrowing binding of a part that isn't Copy is a shared
  // reference to it.
  /** @throws {CompileError} */
  private pattern(this: Mut<this>, p: Pattern, type: Type, borrowing: boolean) {
    const record = (test: PatternTest) => this.ctx.patterns.set(p, { type, ...test });
    const whole = this.recOf(type);
    const members = whole?.kind === "union" ? whole.members : [type];
    const optional = members.includes("null");
    const never = () => new CompileError("E0607", `this pattern can never match a '${this.typing.show(type)}'`, p.start, p.end);
    switch (p.kind) {
      case "wildcard":
        return record({ kind: "any" });
      case "ident": {
        const unit = this.variantNamed(members, p.name);
        if (unit && this.typing.rec(unit).fields.length === 0) return record({ kind: "variant", variant: unit, args: [] });
        if (p.name === "None" && optional) return record({ kind: "none" });
        // A C-like enum's member may be named bare too, as a data enum's unit member may.
        const named = members.filter((m): m is LiteralType => {
          const r = this.recOf(m);
          return r?.kind === "literal" && r.owner?.member === p.name;
        });
        if (named.length > 1) {
          throw new CompileError("E0607", `'${p.name}' is a member of ${named.map((m) => `'${this.typing.rec(m).owner!.enum}'`).join(" and ")}; name which, as '${this.typing.rec(named[0]!).owner!.enum}.${p.name}'`, p.start, p.end);
        }
        if (named[0]) return record({ kind: "literal", value: this.typing.rec(named[0]).value, member: named[0] });
        this.ctx.bind(p.name, borrowing && !this.typing.isCopy(type) ? this.typing.refType(type, false) : type, p as Expr);
        return record({ kind: "any" });
      }
      case "literal": {
        if (p.value.kind === "null") {
          if (!optional) throw never();
          this.value(p.value);
          return record({ kind: "none" });
        }
        let t = this.value(p.value);
        // A number takes the matched type's number type, as a literal operand does.
        const numeric = members.find(isNumeric);
        if (isNumeric(t) && members.filter(isNumeric).length > 1) {
          throw new CompileError("E0607", `a number can't be matched against '${this.typing.show(type)}', which holds several number types; convert the value with 'as' first`, p.start, p.end);
        }
        if (isNumeric(t) && numeric && t !== numeric) {
          this.coerce(p.value, t, numeric, `'${this.typing.show(t)}' can't match a '${this.typing.show(numeric)}'`);
          t = numeric;
        }
        if (!comparable(this.typing, type, t)) throw never();
        return record({ kind: "literal", value: literalOf(p.value) });
      }
      case "variant": {
        if (p.name === "Some" && optional && p.args?.length === 1) {
          const inner = this.typing.unionType(members.filter((m) => m !== "null"));
          this.pattern(p.args[0]!, inner, borrowing);
          return record({ kind: "some", inner, arg: p.args[0]! });
        }
        const member = this.enumMember(p);
        if (member) {
          if (!comparable(this.typing, type, member)) throw never();
          return record({ kind: "literal", value: this.typing.rec(member).value, member });
        }
        const v = this.variantNamed(members, p.name);
        if (!v) throw never();
        const args = p.args ?? [];
        if (args.length !== this.typing.rec(v).fields.length) {
          throw new CompileError("E0607", `'${this.typing.rec(v).name}' holds ${this.typing.rec(v).fields.length} value${this.typing.rec(v).fields.length === 1 ? "" : "s"}, so its pattern takes ${this.typing.rec(v).fields.length}`, p.start, p.end);
        }
        args.forEach((a, i) => this.pattern(a, this.typing.rec(v).fields[i]!.type, borrowing));
        return record({ kind: "variant", variant: v, args });
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
            const field = objectFields(this.typing, m as Shape).find((f) => f.name === keys[i]);
            const r = field ? this.recOf(field.type) : undefined;
            const known = r?.kind === "literal" ? r : undefined;
            return field && !(known && prop.value.kind === "literal" && literalOf(prop.value.value) !== known.value);
          });
        });
        if (shapes.length === 0) throw never();
        const fields = p.props.map((prop, i): [string, Pattern, Type] => {
          const ft = this.typing.unionType(shapes.map((m) => objectFields(this.typing, m).find((f) => f.name === keys[i])!.type));
          this.pattern(prop.value, ft, borrowing);
          return [keys[i]!, prop.value, ft];
        });
        return record({ kind: "object", shapes, fields });
      }
      case "array": {
        if (p.rest) throw unsupported("rest patterns", p.rest);
        if (p.elements.some((x) => x === undefined)) throw unsupported("holes in array patterns", p);
        const array = members.find((m): m is ArrayType => this.isArray(m));
        if (members.some((t) => this.typing.isTuple(t))) throw new CompileError("E0801", "array patterns over tuples in 'match' are not supported yet; take the tuple apart first, as in 'const [a, b] = t'", p.start, p.end);
        if (!array || members.length > 1) throw never();
        const items = p.elements as Pattern[];
        const { element } = this.typing.rec(array);
        for (const item of items) this.pattern(item, element, borrowing);
        return record({ kind: "array", element, items });
      }
      case "or":
        for (const alt of p.patterns) this.pattern(alt, type, borrowing);
        if (p.patterns.some((alt) => bindings(alt).some((b) => this.locals.has(b as Expr)))) throw unsupported("alternatives binding names", p);
        return record({ kind: "or", alternatives: p.patterns });
      default:
        throw unsupported(`${p.kind} patterns`, p);
    }
  }

  // A C-like enum's member named by a pattern, `Color.Red`.
  /** @throws {CompileError} */
  private enumMember(this: Mut<this>, p: Extract<Pattern, { kind: "variant" }>): LiteralType | undefined {
    const [owner, name] = p.name.split(".");
    return p.args === undefined && name !== undefined && !this.ctx.lookup(owner!) && this.enums.has(owner!) ? this.ctx.enumMember(owner!, name) : undefined;
  }

  // The variant among a type's members that a pattern names: `Circle`, or `Shape.Circle`.
  private variantNamed(members: Type[], name: string): VariantType | undefined {
    const parts = name.split(".");
    const member = parts.at(-1)!;
    const owner = parts.length > 1 ? parts.slice(0, -1).join(".") : undefined;
    return members.find((m): m is VariantType => {
      const r = this.recOf(m);
      return r?.kind === "variant" && r.member === member && (owner === undefined || r.enum === owner);
    });
  }

  // Checks a call: what it returns, and how a message names what it calls. A method called in
  // an optional chain gives an Option.
  /** @throws {CompileError} */
  private call(this: Mut<this>, e: Call): { type: Type; what: string } {
    e = this.spreadTuples(e);
    const variant = this.promiseVariants.get(e);
    if (variant) {
      const nothing = this.typing.lower(this.ctx.resolveType(variant.typeArgs[0]!)) === "void";
      const named = this.rewrites.replace(e.callee, { ...(e.callee as Extract<Expr, { kind: "ident" }>), name: nothing ? `${variant.name} void` : variant.name });
      e = this.rewrites.replace(e, { ...e, callee: named, typeArgs: nothing ? variant.typeArgs.slice(1) : variant.typeArgs }) as Call;
    }
    const result = this.callee(e);
    e = this.rewrites.current(e) as Call;
    // A call checked as another form, as `isDeepStrictEqual` is, has its own type already.
    if ((e as Expr).kind !== "call") return result;
    if (e.optional && !this.optionalCalls.has(e)) throw unsupported("optional calls", e);
    return e.callee.kind === "member" && (this.linked(e.callee) || e.optional) && result.type !== "void" ? { ...result, type: this.optional(result.type, e) } : result;
  }

  // The call `spawnBlocking` makes of a function it was given by name or value must take no
  // arguments and give no Promise.
  /** @throws {CompileError} */
  private blockingRun(this: Mut<this>, callee: Extract<Expr, { kind: "ident" }>): void {
    const sync = "'spawnBlocking' runs a synchronous function on a thread of its own; run async work with 'spawn' instead";
    const declared = !this.ctx.lookup(callee.name) ? this.bodyNamed(callee.name) : undefined;
    let wrong: string | undefined;
    if (declared) {
      const needed = declared.params.filter((p) => !p.optional && !p.default && !p.rest).length;
      wrong = declared.async ? sync : needed > 0 ? `'spawnBlocking' calls its function with no arguments, but this one takes ${needed}; wrap it, as in 'spawnBlocking(() => f(x))'` : undefined;
    } else {
      const t = this.value(callee);
      const through = this.typing.lower(this.isRefType(t) ? this.typing.rec(t).to : t);
      const r = this.recOf(through);
      const fn = this.isCallable(through) ? this.recOf(this.typing.callableOf.get((r as DynRecord).of)) : r?.kind === "closure" || r?.kind === "function" ? r : undefined;
      wrong = fn?.kind !== "closure" && fn?.kind !== "function" ? `'spawnBlocking' needs a function taking no arguments, like 'spawnBlocking(() => work())', not '${this.typing.show(t)}'`
        : fn.params.length > 0 ? `'spawnBlocking' calls its function with no arguments, but this one takes ${fn.params.length}; wrap it, as in 'spawnBlocking(() => f(x))'`
        : this.recOf(fn.returns)?.kind === "future" ? sync
        : undefined;
    }
    if (wrong) throw new CompileError("E0305", wrong, callee.start, callee.end);
  }

  /** @throws {CompileError} */
  private callee(this: Mut<this>, e: Call): { type: Type; what: string } {
    // `c[Symbol.iterator]()` calls the method that key names.
    const key = this.rewrites.current(e.callee);
    if (key.kind === "index" && isIteratorKey(key.index)) e = this.rewrites.replace(e, { ...e, callee: this.rewrites.replace(key, { id: 0, kind: "member", object: key.object, name: ITERATOR, optional: key.optional, start: key.start, end: key.end }) }) as Call;
    // `t[0](x)` calls a tuple's element, as a field holding a callable is called.
    this.untuple(e.callee);
    if (this.rewrites.current(e.callee) !== e.callee) e = this.rewrites.replace(e, { ...e, callee: this.rewrites.current(e.callee) }) as Call;
    const { callee } = e;
    if (this.blockingRuns.has(e) && callee.kind === "ident") this.blockingRun(callee);
    if (e.optional && callee.kind !== "member") throw unsupported("optional calls", e);
    if (callee.kind === "super") {
      if (e !== this.superCall) throw new CompileError("E0703", "'super(...)' can only be the first statement of a derived class's constructor", e.start, e.end);
      const base = this.ctx.classOf(this.typing.rec(this.self!.type).base!);
      const constructor = this.arenas.bodyOf(base.constructor);
      this.types.set(callee, base.type);
      if (constructor.params.at(-1)?.rest) e = this.packRest(e, e.args, constructor.params);
      else this.refuseSpread(e.args);
      this.expectFrom(constructor, e.args);
      const argTypes = e.args.map((a) => this.value(a));
      const instance = this.ctx.instantiate(constructor, [], e.args, argTypes, e);
      this.args(e.args, argTypes, instance, e);
      this.calls.set(e, instance.id);
      const error = this.ctx.errorOf(instance);
      if (error) this.ctx.raise(e, error, "'super'");
      return { type: "void", what: "'super'" };
    }
    // A program's own `console` or `print` keeps its meaning.
    const printer = callee.kind === "ident" ? callee.name : callee.kind === "member" && callee.object.kind === "ident" ? callee.object.name : "";
    if (isPrint(callee) && !this.ctx.lookup(printer) && !this.classes.has(printer) && !this.byName.has(printer) && !this.byName.has(`const ${printer}`) && !this.enums.has(printer)) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError("E0505", `'${printer}' is always there, so it is called without '?.'`, e.start, e.end);
      this.printCalls.add(e);
      this.shown(e.args);
      this.unformattable(e.args);
      return { type: "void", what: "printing" };
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && COMBINERS.includes(callee.name) && !this.ctx.lookup("Promise") && !this.classes.has("Promise")) {
      return this.combined(e, callee.name as Combiner);
    }
    // A static method of a package's class.
    const jsClass = callee.kind === "member" && callee.object.kind === "ident" && !this.ctx.lookup(callee.object.name) ? this.jsClasses.get(callee.object.name) : undefined;
    if (jsClass && callee.kind === "member") {
      const m = this.jsStatic(jsClass, callee.name, e);
      if (m.kind !== "method") throw new CompileError("E0503", `'${callee.name}' is a property of '${jsClass.name}', not a method`, callee.start, callee.end);
      if (m.typeParams.length > 0) throw unsupported("generic methods of a package's types", callee);
      const params = this.jsParams(m.params);
      params.forEach((p) => this.crossing(p, `'${jsClass.name}.${callee.name}' takes a`, e));
      this.jsArgs(e, params, m.params.map((p) => p.optional));
      const returns = m.returns ? this.ctx.resolveType(m.returns) : this.typing.blockType("JsValue");
      return { type: this.crossing(returns === "void" ? "void" : this.typing.jsView(returns), `'${jsClass.name}.${callee.name}' gives a`, e), what: `'${callee.name}'` };
    }
    if (callee.kind === "ident" && TIMER_CALLS.has(callee.name) && !this.ctx.lookup(callee.name) && !this.byName.has(callee.name)) {
      return this.call(this.timerCall(e, callee.name));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && callee.name === "withResolvers" && !this.ctx.lookup("Promise") && !this.classes.has("Promise")) {
      return this.call(this.promiseResolvers(e));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && (callee.name === "resolve" || callee.name === "reject") && !this.ctx.lookup("Promise") && !this.classes.has("Promise")) {
      return this.call(this.promiseSettled(e, callee.name));
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "AbortSignal" && !this.ctx.lookup("AbortSignal") && !this.classes.has("AbortSignal")) {
      return this.signalStatic(e, callee);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && (callee.object.name === "TcpListener" || callee.object.name === "TcpStream" || callee.object.name === "UnixListener" || callee.object.name === "UnixStream" || callee.object.name === "UdpSocket") && !this.ctx.lookup(callee.object.name) && !this.classes.has(callee.object.name)) {
      return this.socketStatic(e, callee, callee.object.name);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "FixedArray" && !this.ctx.lookup("FixedArray") && !this.classes.has("FixedArray")) return this.filled(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Array" && !this.ctx.lookup("Array") && !this.classes.has("Array")) return this.arrayStatic(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && isTypedName(callee.object.name) && !this.ctx.lookup(callee.object.name) && !this.classes.has(callee.object.name)) return this.typedStatic(e, callee, callee.object.name);
    // `u8.fromBase64(s, options?)` and `u8.fromHex(s)`, TC39's Uint8Array statics on the byte type.
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "u8" && !this.ctx.lookup("u8") && !this.byName.has("u8") && !this.byName.has("const u8")) {
      const helper = Object.hasOwn(BYTE_DECODERS, callee.name) ? BYTE_DECODERS[callee.name] : undefined;
      if (!helper) throw new CompileError("E0502", `'u8' has no static '${callee.name}'; decode text into a 'u8[]' with 'u8.fromBase64' or 'u8.fromHex'`, callee.start, callee.end);
      if (callee.optional || e.optional) throw new CompileError("E0505", `'u8.${callee.name}' is always there, so it is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError("E0106", `'u8.${callee.name}' takes no type arguments`, e.start, e.end);
      const most = callee.name === "fromBase64" ? 2 : 1;
      if (e.args.length < 1 || e.args.length > most) throw new CompileError("E0504", most === 1 ? "'u8.fromHex' takes one string of hex digits" : "'u8.fromBase64' takes a string and an optional options object, as in '{ alphabet: \"base64url\" }'", e.start, e.end);
      return this.call(this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: helper, start: callee.start, end: callee.end } }) as Call);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Object" && !this.ctx.lookup("Object") && !this.classes.has("Object") && !this.byName.has("Object") && !this.byName.has("const Object") && !this.enums.has("Object")) return this.objectStatic(e, callee);
    if (callee.kind === "member" && this.isString(callee.object)) return this.stringStatic(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Rc" && !this.ctx.lookup("Rc") && !this.classes.has("Rc") && !this.byName.has("Rc")) return this.ptrEq(e, callee);
    if (callee.kind === "member" && this.isMath(callee.object)) {
      if (callee.optional || e.optional) throw new CompileError("E0505", "'Math' is always there, so its functions are called without '?.'", e.start, e.end);
      return this.mathCall(e, callee.name);
    }
    const clock = this.clockOf(callee);
    if (clock) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError("E0505", `'${clock.split(".")[0]}' is always there, so '${clock}()' is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${clock}' takes no type arguments`, e.start, e.end);
      if (e.args.length > 0) throw new CompileError("E0504", `'${clock}' takes no arguments`, e.start, e.end);
      this.clocks.set(e, clock);
      return { type: clock === "Date.now" ? "i64" : "f64", what: `'${clock}'` };
    }
    const json = this.jsonOf(callee);
    if (json && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError("E0505", "'JSON' is always there, so its functions are called without '?.'", e.start, e.end);
    if (json === "stringify") return this.stringify(e);
    if (json === "parse") return this.jsonParse(e);
    const parser = this.parserOf(callee);
    if (parser && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError("E0505", `'${parser}' is always there, so it is called without '?.'`, e.start, e.end);
    if (parser) return this.parse(e, parser);
    if (callee.kind === "ident" && callee.name === "assert" && (e.start >= STD_BASE || (!this.ctx.lookup("assert") && !this.classes.has("assert") && !this.byName.has("assert") && !this.byName.has("const assert")))) return this.assertion(e);
    // `new Array(n).fill(x)`: n copies of x, the only form `new Array(n)` takes.
    if (callee.kind === "member" && callee.name === "fill" && callee.object.kind === "new" && callee.object.callee.kind === "ident" && callee.object.callee.name === "Array" && !this.ctx.lookup("Array") && !this.classes.has("Array")) {
      const made = callee.object;
      if (e.typeArgs.length > 0) throw new CompileError("E0106", "'fill' takes no type argument; write the element type on the array, as in 'new Array<u8>(n).fill(0)'", e.start, e.end);
      if (made.args?.length !== 1 || e.args.length !== 1) throw new CompileError("E0504", "'new Array(n).fill(x)' makes n copies of x; it takes one length and one value", e.start, e.end);
      const [n, x] = [made.args[0]!, e.args[0]!];
      const filled = this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: "array filled", start: callee.start, end: callee.end }, args: [this.arrayLength(n, true), x], typeArgs: made.typeArgs }) as Call;
      this.fills.add(filled);
      return this.call(filled);
    }
    // The rewritten fill, checked again in each generic instance: what the prelude can't do with
    // the value is said at the value, not inside the prelude.
    if (this.fills.has(e) && !this.filling.has(e)) {
      const x = e.args[1]!;
      this.filling.add(e);
      let result;
      try {
        result = this.call(e);
      } catch (err) {
        if (err instanceof CompileError && err.start >= STD_BASE) throw new CompileError(err.code, `'new Array(n).fill(x)' can't be made from this value: ${err.message}`, x.start, x.end);
        throw err;
      } finally {
        this.filling.delete(e);
      }
      const t = this.typing.lower(this.types.get(x)!);
      if (typeof t !== "string" && this.typing.rec(t).kind === "generator") throw new CompileError("E0213", "'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once", x.start, x.end);
      this.clonable(t, x);
      return result;
    }
    // A length the user wrote, an `i64` or a `usize`; a fill's panics when negative, as JavaScript throws.
    if (callee.kind === "ident" && callee.name === "fill length") {
      const t = this.read(e.args[0]!);
      if (t !== "i64" && t !== "usize") throw new CompileError("E0504", `an array's length is an 'i64' or a 'usize', not '${this.typing.show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      return { type: "i64", what: "an array length" };
    }
    // `super.m(...)` the bases don't declare runs on the Map or Set the class embeds.
    if (callee.kind === "member" && callee.object.kind === "super" && this.superDelegated(callee.name)) return this.call(this.become(e, { ...e, callee: this.throughEmbedded(callee) }) as Call);
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? this.receiverType(callee) : undefined;
    // A method a class extending Map or Set doesn't declare is the embedded collection's.
    if (callee.kind === "member" && this.delegated(receiver, callee.name)) return this.call(this.become(e, { ...e, callee: this.throughEmbedded(callee) }) as Call);
    if (callee.kind === "member" && callee.name === "clone" && receiver && this.copies(receiver)) return this.cloned(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && stringLike(this.typing, receiver)) return this.stringCall(e, callee, receiver);
    // A bigint's digits, in base 10 or the radix given.
    if (callee.kind === "member" && receiver === "bigint") {
      if (callee.name !== "toString") throw new CompileError("E0502", `'bigint' has no method '${callee.name}'`, callee.start, callee.end);
      if (e.args.length > 1) throw new CompileError("E0504", "'toString' takes at most a radix", e.start, e.end);
      if (e.args[0]) this.coerce(e.args[0], this.value(e.args[0]), "i64", "a radix is an 'i64' from 2 to 36");
      return { type: "string", what: "'toString'" };
    }
    if (callee.kind === "member" && receiver !== undefined && this.isArray(receiver)) return this.arrayCall(e, callee, receiver);
    const recv = this.recOf(receiver);
    if (callee.kind === "member" && recv?.kind === "map" && recv.dict && callee.name !== "clone" && !this.dictCalls.has(e)) {
      throw new CompileError("E0502", `a dictionary has no methods, as a plain object has none; its keys are read as properties, like '${this.placeText(callee.object)}[k]'`, callee.start, callee.end);
    }
    if (callee.kind === "member" && recv?.kind === "map" && callee.name !== "clone") {
      const result = this.mapCall(e, callee, receiver as MapType);
      // A class extending Map or Set gets itself back from `set` and `add`, as JavaScript's
      // `this`: the collection is its first field, so a pointer to one points at the other.
      const holder = callee.object.kind === "member" && callee.object.name === EMBEDDED ? callee.object.object : undefined;
      if (!holder || (callee.name !== "set" && callee.name !== "add")) return result;
      this.borrowsFrom.set(e, [holder]);
      const held = this.types.get(holder)!;
      return { type: this.typing.refType(this.isRefType(held) ? this.typing.rec(held).to : held, true), what: result.what };
    }
    if (callee.kind === "member" && receiver !== undefined && this.typing.yieldsOf(receiver) !== undefined) return this.generatorCall(e, callee, receiver, this.typing.yieldsOf(receiver)!);
    if (callee.kind === "member" && receiver !== undefined && this.typing.yieldsOf(receiver, true) !== undefined && recv?.kind !== "dyn") return this.generatorCall(e, callee, receiver, this.typing.yieldsOf(receiver, true)!, true);
    if (callee.kind === "member" && recv?.kind === "pointer") return this.pointerCall(e, callee, receiver as PointerType);
    if (callee.kind === "member" && recv?.kind === "interior") return this.interiorCall(e, callee, receiver as InteriorType);
    if (callee.kind === "member" && recv?.kind === "shared") return this.sharedCall(e, callee, receiver as SharedType);
    if (callee.kind === "member" && recv?.kind === "block") return this.blockCall(e, callee, receiver as BlockType);
    if (callee.kind === "member" && recv?.kind === "handle" && callee.name !== "clone") return this.handleCall(e, callee, receiver as HandleType);
    if (callee.kind === "member" && callee.name !== "clone" && recv?.kind === "dyn") return this.dynCall(e, callee, receiver as DynType);
    if (callee.kind === "ident" && callee.name === "shared" && !this.ctx.lookup(callee.name) && !this.byName.has("shared")) return this.sharedNew(e);
    if (callee.kind === "member" && callee.name === "toFixed" && receiver !== undefined && isNumeric(this.typing.lower(receiver))) {
      const n = this.typing.lower(receiver);
      if (isInteger(n) && INTEGERS[n].bits === 128) throw new CompileError("E0801", `'toFixed' on a 128-bit integer isn't supported yet; convert it with 'as f64' first`, callee.start, callee.end);
      return this.toFixed(e);
    }
    if (callee.kind === "member" && receiver !== undefined && isInteger(this.typing.lower(receiver)) && integerMethod(callee.name)) return this.integerCall(e, callee, this.typing.lower(receiver) as Integer);
    const rx = receiver === undefined ? undefined : this.asRegex(receiver);
    if (callee.kind === "member" && rx) return this.regexCall(e, callee, rx, this.typing.lower(receiver!) !== rx);
    if (callee.kind === "member" && receiver !== undefined && this.isFixed(receiver)) {
      throw new CompileError("E0502", `a FixedArray has no method '${callee.name}' yet; loop over it with 'for...of', or read 'length'`, callee.start, callee.end);
    }
    // A field holding a stored callable, through an object-typed parameter's bound too.
    const bound = recv?.kind === "param" ? this.recOf(recv.bound) : undefined;
    if (callee.kind === "member" && bound?.kind === "object") {
      const stored = this.typing.field(bound.kind === "object" ? (this.typing.rec(receiver as ParamType).bound as ObjectType) : (receiver as ObjectType), callee.name);
      const held = stored && this.typing.lower(this.isRefType(stored.type) ? this.typing.rec(stored.type).to : stored.type);
      if (held && this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
    }
    if (callee.kind === "member" && (recv?.kind === "param" || recv?.kind === "interface")) {
      return this.traitCall(e, callee, receiver as InterfaceType | ParamType);
    }
    // A nested function's call of itself comes before any outer name it shares.
    const itself = callee.kind === "ident" ? this.ctx.selfCall(e) : undefined;
    if (itself) return itself;
    const nested = callee.kind === "ident" ? this.nestedFunction(callee.name) : undefined;
    if (nested) return this.nestedCall(e, callee as Extract<Expr, { kind: "ident" }>, nested);
    // A local generic function is called as the generic function it was lifted to, and a generic
    // function value read from a name or a field as the function it names.
    const lifted = (callee.kind === "ident" ? (this.ctx.lookup(callee.name)?.generic as Body | undefined) : undefined) ?? this.genericTarget(callee, receiver);
    if (callee.kind === "ident" && !lifted && this.ctx.lookup(callee.name)) return this.closureCall(e, callee);
    // A field holding a stored callable, `this.onClick(e)`, when no method has that name.
    if (callee.kind === "member" && receiver !== undefined && (recv?.kind === "class" || recv?.kind === "object")) {
      const stored = this.typing.field(receiver as ClassType | ObjectType, callee.name);
      const method = recv.kind === "class" && inherited(this.arenas, this.ctx.classOf(receiver as ClassType), "methods", callee.name);
      const held = stored && this.typing.lower(this.isRefType(stored.type) ? this.typing.rec(stored.type).to : stored.type);
      if (held && !method && this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
    }
    if (callee.kind !== "ident" && callee.kind !== "member") {
      const given = this.value(callee);
      const held = this.typing.lower(this.isRefType(given) ? this.typing.rec(given).to : given);
      if (this.isCallable(held)) return this.callableCall(e, callee, held as DynType);
      if (typeof held !== "string" && this.typing.rec(held).kind === "closure") return this.closureCall(e, callee, given);
    }
    // `Shape.Circle(1.5)` builds a variant from its payload.
    const named = callee.kind === "member" && callee.object.kind === "ident" && !this.ctx.lookup(callee.object.name) ? this.enums.get(callee.object.name) : undefined;
    if (named?.data && callee.kind === "member") {
      const ahead = this.expectedVariant(callee, named);
      if (ahead) e.args.forEach((a, i) => this.typing.rec(ahead).fields[i] && this.expect(a, this.typing.rec(ahead).fields[i]!.type));
      const given = e.args.map((a) => this.value(a));
      const v = this.variant(callee, named, false, given, e.typeArgs);
      if (e.args.length !== this.typing.rec(v).fields.length) {
        throw new CompileError("E0501", `'${this.typing.rec(v).name}' holds ${this.typing.rec(v).fields.length} value${this.typing.rec(v).fields.length === 1 ? "" : "s"}, but ${e.args.length} ${e.args.length === 1 ? "was" : "were"} given`, e.start, e.end);
      }
      e.args.forEach((a, i) => {
        const t = given[i]!;
        this.coerce(a, t, this.typing.rec(v).fields[i]!.type, `argument of type '${this.typing.show(t)}' is not assignable to '${this.typing.rec(v).name}', which holds '${this.typing.show(this.typing.rec(v).fields[i]!.type)}'`);
      });
      this.types.set(callee, v);
      return { type: v, what: `'${this.typing.rec(v).name}'` };
    }
    // `ptrOf(r)` and `mutPtrOf(m)`: a raw pointer to what a reference, or a place, holds. Making
    // one is safe; the borrow lasts only for the call.
    if (callee.kind === "ident" && (callee.name === "ptrOf" || callee.name === "mutPtrOf") && !this.byName.has(callee.name)) {
      const mutable = callee.name === "mutPtrOf";
      if (e.args.length !== 1) throw new CompileError("E0504", `'${callee.name}' takes 1 argument`, e.start, e.end);
      const a = e.args[0]!;
      const t = this.value(a);
      // A type parameter may stand for a reference in one instance and a value in another, and
      // the two point at different things.
      if (typeof t !== "string" && this.typing.rec(t).kind === "param") throw unsupported(`'${callee.name}' calls on values whose type is a type parameter`, a);
      if (this.isRefType(t)) {
        if (mutable && !this.typing.rec(t).mutable) throw new CompileError("E1006", "'mutPtrOf' needs a 'Mut' reference, or a place that may change", a.start, a.end);
        return { type: this.typing.pointerType(this.typing.rec(t).to, mutable), what: `'${callee.name}'` };
      }
      if (!this.place(a)) throw new CompileError("E1006", `'${callee.name}' needs a variable or a field to point at; a temporary is gone once its statement ends`, a.start, a.end);
      if (mutable) this.changeable(a, "point mutably at");
      this.coerce(a, t, this.typing.refType(t, mutable), "");
      return { type: this.typing.pointerType(t, mutable), what: `'${callee.name}'` };
    }
    // `spawn(p)`: the future runs as a task of its own, on any thread, and its handle awaits it.
    // The std library's code calls the built-ins, whatever a program names its own functions.
    const inStd = e.start >= STD_BASE;
    // `spawnBlocking(f)` is `spawn(async () => f())` with the task polled on the blocking pool, so
    // f may block or compute for long without holding up the async workers. An `f` that is neither
    // an arrow nor a name is made here, on the caller's thread, as `f |> spawn(async () => %())`.
    if (callee.kind === "ident" && callee.name === "spawnBlocking" && (!this.byName.has("spawnBlocking") || inStd)) {
      if (!this.ctx.async) throw new CompileError("E0301", "'spawnBlocking' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      const f = e.args[0];
      if (e.args.length !== 1 || !f) throw new CompileError("E0305", "'spawnBlocking' takes the function to run, like 'spawnBlocking(() => hash(data))'", e.start, e.end);
      if (f.kind === "arrow" && f.async) throw new CompileError("E0305", "'spawnBlocking' runs a synchronous function on a thread of its own; run async work with 'spawn' instead", f.start, f.end);
      if (f.kind === "arrow" && f.params.length > 0) throw new CompileError("E0305", "'spawnBlocking' calls its function with no arguments, so it can't take parameters; capture what it needs instead", f.start, f.end);
      const made = f.kind !== "arrow" && f.kind !== "ident";
      const fn: Expr = made ? { id: nextId(this.ids), kind: "topic", start: f.start, end: f.end } : f;
      const run: Expr = { id: nextId(this.ids), kind: "call", callee: fn, typeArgs: [], args: [], optional: false, start: f.start, end: f.end };
      if (f.kind !== "arrow") this.blockingRuns.add(run);
      const arrow: Expr = { id: nextId(this.ids), kind: "arrow", move: false, async: true, typeParams: [], params: [], returnType: undefined, body: run, start: f.start, end: f.end };
      const task: Expr = { id: nextId(this.ids), kind: "call", callee: arrow, typeArgs: [], args: [], optional: false, start: f.start, end: f.end };
      const spawned: Expr = made ? { id: nextId(this.ids), kind: "pipe", value: f, body: task, start: f.start, end: f.end } : arrow;
      return this.call(this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: "blocking spawn", start: callee.start, end: callee.end }, args: [spawned] }) as Call);
    }
    // std's `timer spawn` is `spawn` with the task's first poll run at once; `blocking spawn` is
    // what `spawnBlocking` becomes.
    const spawning = callee.kind === "ident" && callee.name === "blocking spawn" ? "spawnBlocking" : "spawn";
    if (callee.kind === "ident" && ((callee.name === "spawn" && (!this.byName.has("spawn") || inStd)) || (callee.name === "timer spawn" && inStd) || callee.name === "blocking spawn")) {
      if (!this.ctx.async) throw new CompileError("E0301", "'spawn' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      if (e.args.length !== 1) throw new CompileError("E0305", "'spawn' takes the Promise to run, like 'spawn(save(user))'", e.start, e.end);
      // `spawn(async () => ...)` runs the arrow's body as the task: its call is what is spawned.
      const given = e.args[0]!;
      if (given.kind === "arrow" && given.async && given.params.length === 0) {
        e = this.rewrites.replace(e, { ...e, args: [{ id: nextId(this.ids), kind: "call", callee: given, typeArgs: [], args: [], optional: false, start: given.start, end: given.end }] }) as Call;
      }
      const t = this.value(e.args[0]!);
      const r = this.recOf(t);
      if (r?.kind !== "future" || t === YIELD_NOW || t === SLEEP || this.typing.leafOf.has(t as FutureType)) throw new CompileError("E0305", `'spawn' needs a Promise from an async function's call, not '${this.typing.show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      const blocker = this.unsent(t);
      if (blocker) {
        throw new CompileError("E0303", `'${spawning}' runs this ${spawning === "spawn" ? "Promise" : "function"} on another thread, so it must own everything it uses; it holds a '${this.typing.show(blocker)}', which ${typeof blocker !== "string" && this.typing.rec(blocker).kind === "pointer" ? "is a raw pointer no thread can vouch for; pass an owned value, or a clone" : typeof blocker !== "string" && this.typing.rec(blocker).kind === "interior" ? "changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead" : typeof blocker !== "string" && this.typing.rec(blocker).kind === "shared" ? COUNTED_UNLOCKED : "borrows from this function; pass an owned value, or a clone"}`, e.args[0]!.start, e.args[0]!.end);
      }
      return { type: this.typing.handleType(r.gives, r.throws), what: "'spawn'" };
    }
    // `sleep(ms)`: a future done once that many milliseconds have passed, holding no thread.
    if (callee.kind === "ident" && callee.name === "sleep" && (!this.byName.has("sleep") || inStd)) {
      if (e.args.length !== 1 && e.args.length !== 2) throw new CompileError("E0504", "'sleep' takes how many milliseconds to wait, like 'sleep(250)', and may take an AbortSignal", e.start, e.end);
      this.expect(e.args[0]!, "i64");
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, "i64", `'sleep' takes milliseconds as an 'i64', not '${this.typing.show(t)}'`);
      if (e.args.length === 1) return { type: SLEEP, what: "'sleep'" };
      this.signalArgument(e.args[1]!, "'sleep'");
      return { type: this.typing.leafFuture("sleep", "void", this.abortError(), true), what: "'sleep'" };
    }
    // `fileRead(path)` and `fileWrite(path, bytes)`: the futures node:fs/promises is written over,
    // each a job on the runtime's blocking pool.
    if (callee.kind === "ident" && (callee.name === "fileRead" || callee.name === "fileWrite") && (inStd || stdModuleAt(this.files, e.start) !== undefined)) {
      const reading = callee.name === "fileRead";
      if (e.args.length !== (reading ? 1 : 2)) throw new CompileError("E0504", `'${callee.name}' takes ${reading ? "a path" : "a path and the bytes"}`, e.start, e.end);
      const path = this.value(e.args[0]!);
      this.coerce(e.args[0]!, path, "string", `a path is a 'string', not '${this.typing.show(path)}'`);
      if (!reading) {
        const bytes = this.value(e.args[1]!);
        this.coerce(e.args[1]!, bytes, this.typing.arrayType("u8"), `the bytes are a 'u8[]', not '${this.typing.show(bytes)}'`);
      }
      this.fileCalls.add(e);
      return { type: this.typing.leafFuture(reading ? "readFile" : "writeFile", "void", this.ioError()), what: `'${callee.name}'` };
    }
    // The blocking calls node:fs is written over, as `fileReadSync(path)`, run on the calling
    // thread.
    const sync = callee.kind === "ident" && (inStd || stdModuleAt(this.files, e.start) !== undefined) ? syncFileSignatures(this.typing)[callee.name] : undefined;
    if (sync) {
      const [params, returns, throws] = sync;
      const name = (callee as Extract<Expr, { kind: "ident" }>).name;
      if (e.args.length !== params.length) throw new CompileError("E0504", `'${name}' takes ${params.length} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
      e.args.forEach((a, i) => {
        const t = this.value(a);
        this.coerce(a, t, params[i]!, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(params[i]!)}'`);
      });
      if (throws) this.ctx.raise(e, this.ioError(), `'${name}'`);
      this.syncFileCalls.set(e, name);
      return { type: returns, what: `'${name}'` };
    }
    // The std's timers: `timerSet(callback, ms, repeat, loop)` hands a callable to the runtime,
    // starting the timer task `loop` once; `timerNext()` waits for the next one due, and
    // `timerClear(id)` drops one.
    if (callee.kind === "ident" && (inStd || this.timerSets.has(e)) && (callee.name === "timerSet" || callee.name === "timerNext" || callee.name === "timerClear")) {
      this.timerCalls.set(e, callee.name);
      if (callee.name === "timerNext") return { type: this.typing.leafFuture("timerNext", this.typing.timerCallback()), what: "'timerNext'" };
      if (callee.name === "timerClear") {
        this.coerce(e.args[0]!, this.value(e.args[0]!), "i64", "a timer's id is an 'i64'");
        return { type: "void", what: "'timerClear'" };
      }
      this.expect(e.args[0]!, this.typing.timerCallback());
      this.coerce(e.args[0]!, this.value(e.args[0]!), this.typing.timerCallback(), "a timer runs an async function");
      const delay = this.value(e.args[1]!);
      this.coerce(e.args[1]!, delay, "i64", `a delay is milliseconds as an 'i64', not '${this.typing.show(delay)}'`);
      this.coerce(e.args[2]!, this.value(e.args[2]!), "boolean", "whether it repeats is a 'boolean'");
      this.value(e.args[3]!);
      return { type: "i64", what: "'timerSet'" };
    }
    if (callee.kind === "ident" && callee.name === "jsEvaluate" && stdModuleAt(this.files, e.start) === "fish:engine") {
      this.coerce(e.args[0]!, this.value(e.args[0]!), "string", "a module's source is a 'string'");
      this.jsEvaluations.add(e);
      return { type: this.typing.blockType("JsValue"), what: "'jsEvaluate'" };
    }
    // `yieldNow()`: a future that is pending once, letting other tasks run.
    if (callee.kind === "ident" && callee.name === "yieldNow" && (!this.byName.has("yieldNow") || inStd)) {
      if (e.args.length > 0) throw new CompileError("E0504", "'yieldNow' takes no arguments", e.start, e.end);
      return { type: YIELD_NOW, what: "'yieldNow'" };
    }
    // `cString(s)`: a pointer to a NUL-terminated copy of `s` for C, which the enclosing block
    // owns and frees when it ends.
    if (callee.kind === "ident" && callee.name === "cString" && !this.byName.has("cString")) {
      if (e.args.length !== 1) throw new CompileError("E1006", "'cString' takes 1 argument", e.start, e.end);
      if (this.ctx.generator) throw unsupported("'cString' inside generators", callee);
      if (this.ctx.async) throw unsupported("'cString' inside async functions", callee);
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, "string", `'cString' takes a string, not '${this.typing.show(t)}'`);
      return { type: this.typing.pointerType("u8", false), what: "'cString'" };
    }
    // `fromCString(p)`: a new string from a C string's bytes, read up to its NUL.
    if (callee.kind === "ident" && callee.name === "fromCString" && !this.byName.has("fromCString")) {
      this.needsUnsafe("'fromCString'", callee);
      if (e.args.length !== 1) throw new CompileError("E1006", "'fromCString' takes 1 argument", e.start, e.end);
      const want = this.typing.pointerType("u8", false);
      const t = this.value(e.args[0]!);
      this.coerce(e.args[0]!, t, want, `'fromCString' takes a 'Ptr<u8>', not '${this.typing.show(t)}'`);
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
    if (callee.kind === "ident" && callee.name === "shutdownSignal" && (e.start >= STD_BASE || stdModuleAt(this.files, e.start) !== undefined) && e.args.length === 0) return { type: this.typing.blockType("AbortSignal"), what: "'shutdownSignal'" };
    // The UTF-8 conversions behind the prelude's TextEncoder and TextDecoder, which only they call.
    if (callee.kind === "ident" && (callee.name === "utf8Encode" || callee.name === "utf8Decode") && this.owner !== undefined && this.typing.rec(this.owner).name === (callee.name === "utf8Encode" ? "TextEncoder" : "TextDecoder")) {
      this.value(e.args[0]!);
      return { type: callee.name === "utf8Encode" ? this.typing.arrayType("u8") : "string", what: `'${callee.name}'` };
    }
    // `nullPtr<T>()`: a pointer to nothing, which may be used as either kind.
    if (callee.kind === "ident" && callee.name === "nullPtr" && !this.byName.has("nullPtr")) {
      this.needsUnsafe("'nullPtr'", callee);
      if (e.typeArgs.length !== 1 || e.args.length > 0) throw new CompileError("E1006", "'nullPtr' takes the type it points to, like 'nullPtr<u8>()'", e.start, e.end);
      return { type: this.typing.pointerType(this.ctx.resolveType(e.typeArgs[0]!), true), what: "'nullPtr'" };
    }
    // `BigInt(x)`: an integer of any size as a bigint. A float is refused rather than checked
    // for a fraction while the program runs.
    if (callee.kind === "ident" && callee.name === "BigInt" && !this.byName.has("BigInt")) {
      if (e.args.length !== 1) throw new CompileError("E0504", "'BigInt' takes 1 argument", e.start, e.end);
      const t = this.operand(e.args[0]!);
      if (t !== "bigint" && !isInteger(t)) throw new CompileError("E0504", `'BigInt' takes an integer, not '${this.typing.show(t)}'${isFloat(t) ? "; convert the float with 'as i64' first" : ""}`, e.args[0]!.start, e.args[0]!.end);
      return { type: "bigint", what: "'BigInt'" };
    }
    // `String(x)`: a string, number or boolean written as JavaScript writes it.
    if (callee.kind === "ident" && callee.name === "String" && (!this.byName.has("String") || inStd)) {
      if (e.args.length !== 1) throw new CompileError("E0504", "'String' takes 1 argument", e.start, e.end);
      this.joined(e.args[0]!, this.operand(e.args[0]!), "'String'");
      return { type: "string", what: "'String'" };
    }
    const found = lifted ?? (callee.kind === "ident" ? this.bodyNamed(callee.name) : callee.kind === "member" ? this.method(callee, receiver) : undefined);
    // A package's function declared with several signatures is checked against the first that
    // takes the arguments, as TypeScript picks one.
    const target = found?.js?.overloads ? this.jsOverload(e, found) : found?.overloads && !(e as Direct).implementation ? this.overload(e, found) : found;
    // A package's const is a value; one holding a function would be a function crossing from JS.
    if (target?.js?.const) {
      const held = this.ctx.resolveType(target.returnType!);
      const kind = this.recOf(held)?.kind;
      const callable = kind === "function" || kind === "closure" || this.boundFunction(held) !== undefined;
      throw new CompileError(callable ? "E1005" : "E0503", callable ? `'${target.js.name}' from '${target.js.module}' holds a function, and functions crossing between Fish and JS aren't supported yet` : `this expression is not callable: type '${this.typing.show(this.typing.jsView(held))}' has no call signatures`, e.start, e.end);
    }
    if (target?.name.replace(/-fsh\d+$/, "") === "ok" && stdModuleAt(this.files, target.start) === "node:assert") return this.assertion(e);
    // node:util's functions that take any values, as Node's do, given their meaning here.
    const util = target && callee.kind === "ident" && stdModuleAt(this.files, target.start) === "node:util" ? target.name.replace(/-fsh\d+$/, "") : undefined;
    if (util === "format") {
      if (e.optional) throw new CompileError("E0505", "'format' is always there, so it is called without '?.'", e.start, e.end);
      this.refuseSpread(e.args);
      this.shown(e.args);
      this.unformattable(e.args);
      this.formatCalls.add(e);
      return { type: "string", what: "'format'" };
    }
    if (util === "inspect") {
      if (e.args.length !== 1 || e.args[0]!.kind === "spread") throw new CompileError(e.args.length > 1 ? "E0801" : "E0504", e.args.length > 1 ? "'inspect' takes the value alone; its options aren't supported yet" : "'inspect' takes 1 argument", e.start, e.end);
      this.shown(e.args);
      this.inspectCalls.add(e);
      return { type: "string", what: "'inspect'" };
    }
    // `parseArgs(config)` calls std's port with the arguments its literal says, once.
    if (util === "parseArgs" && !this.parsedArgs.has(e)) {
      if (e.optional) throw new CompileError("E0505", "'parseArgs' is always there, so it is called without '?.'", e.start, e.end);
      this.refuseSpread(e.args);
      e = this.rewrites.replace(e, { ...e, args: parseArgsArgs(this.ids, e) }) as Call;
      this.parsedArgs.add(e);
    }
    // Fish's value equality, which `===` already is.
    if (util === "isDeepStrictEqual") {
      if (e.args.length !== 2) throw new CompileError("E0504", "'isDeepStrictEqual' takes 2 arguments", e.start, e.end);
      this.refuseSpread(e.args);
      const [left, right] = e.args as [Expr, Expr];
      const equality = this.rewrites.replace(e, { id: 0, kind: "binary", op: "===", left, right, start: e.start, end: e.end });
      this.deepEqualities.add(equality);
      return { type: this.value(equality), what: "'isDeepStrictEqual'" };
    }
    if (target && (target as { macro?: boolean }).macro) throw new CompileError("E0503", `'${target.name}' is a macro, applied to a declaration as '@${target.name}'; it isn't called as a function`, e.start, e.end);
    // The prelude holds std's TLS helper, so a program would otherwise reach it; only std calls it.
    const stdOnly = callee.kind === "ident" && callee.name === "__tlsClient" && e.start < STD_BASE && stdModuleAt(this.files, e.start) === undefined;
    if (!target || stdOnly) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      if (callee.kind === "ident" && this.byName.has(`const ${callee.name}`)) throw new CompileError("E0801", `'${callee.name}' is a top-level const, and calling a function value one holds isn't supported yet; write its value as an arrow, as in 'const ${callee.name} = (x: i64) => ...', or declare it with 'function'`, callee.start, callee.end);
      throw new CompileError("E0401", `unknown function ${name}${callee.kind === "ident" ? didYouMean(callee.name, this.ctx.names(callee.start)) : ""}`, callee.start, callee.end);
    }
    if (target.foreign && !target.rust) this.needsUnsafe(`calling the C function '${target.name}'`, callee, "the compiler can't check what C code does");
    if (target.js) this.jsCalls.set(e, target.js);
    if (target.params.at(-1)?.rest && !this.tagCalls.has(e)) e = this.packRest(e, e.args, target.params);
    else this.refuseSpread(e.args);
    this.expectFrom(target, e.args);
    // An arrow given to a generic body is checked once the other arguments decide its types.
    const argTypes: Type[] = [];
    e.args.forEach((a, i) => this.rewrites.current(a).kind !== "arrow" && (argTypes[i] = this.value(a)));
    const bounds = this.ctx.implicitOf(target);
    e.args.forEach((written, i) => {
      // A function named as a value became an arrow as it was checked.
      const a = this.rewrites.current(written);
      if (a.kind !== "arrow") return;
      // A generic function type's parameter takes the arrow as the family it is.
      const bound = bounds.get(i);
      const r = this.recOf(bound);
      const want = r?.kind === "function" && r.generic ? undefined : this.ctx.callbackType(target, e.typeArgs, argTypes, i, e);
      if (want) this.expect(a, want);
      argTypes[i] = this.value(a);
    });
    // The array iterators clone elements: a generic body's instance checks the real element.
    if ((target.name === "array entries" || target.name === "array values") && argTypes[0] !== undefined) {
      const array = this.typing.lower(this.isRefType(argTypes[0]) ? this.typing.rec(argTypes[0]).to : argTypes[0]);
      if (this.isArray(array)) this.clonable(this.typing.rec(array).element, e, target.name.slice("array ".length));
    }
    if (target.js) this.jsCrossings.add(e);
    if (target.js && !this.jsCalledAt.has(target.bodyId)) this.jsCalledAt.set(target.bodyId, e);
    // Its declaration was refused before a call reached it: this call is where that counts.
    const refused = target.js ? this.typing.jsUncalled.get(target) : undefined;
    if (refused) {
      refused.note ??= { message: `'${target.js!.name}' is called here`, start: e.start, end: e.end };
      throw refused;
    }
    const instance = this.ctx.instantiate(target, e.typeArgs, e.args, argTypes, e);
    this.args(e.args, argTypes, instance, e);
    this.calls.set(e, instance.id);
    if (target.js) e.args.forEach((a) => this.givenToJs(a, this.types.get(a)!));
    // An async function's call only makes its future; its error comes at the `await`.
    // The error a call raises is the implementation's own, since that is what it gives, or what
    // an abstract declaration says it may.
    const declared = callee.kind === "member" ? this.abstractDeclaration(callee, "methods") : undefined;
    const error = this.ctx.errorOf(instance) ?? (declared && this.ctx.errorOf(this.ctx.instanceOf(declared)));
    if (error && !target.async && !target.generator) this.ctx.raise(e, error, `'${target.name}'`);
    const type = this.ctx.resultOf(declared ? this.ctx.instanceOf(declared) : instance, e);
    const object = callee.kind === "member" && bodyOf(this.arenas, instance).self ? callee.object : undefined;
    // A returned reference borrows what its lifetime says; a value holding references, what
    // was lent to the call, its receiver included.
    if (this.typing.holdsRef(type)) this.borrowsFrom.set(e, this.ctx.sourcesOf(instance, e.args, object, e, (a) => this.lends(a)));
    return { type, what: `'${target.name}'` };
  }

  // Whether a tagged template is a quote rather than a call of a tag the program declares.
  private isQuote(this: Mut<this>, e: Extract<Expr, { kind: "tagged" }>): boolean {
    const tag = e.tag;
    return tag.kind === "ident" && (tag.name === "quote" || tag.name === "quoteType") && !this.ctx.lookup(tag.name) && !this.byName.has(tag.name);
  }

  // `` quote`a + ${x}` ``: the Ast value of the text, an expression's or a statement's, and of
  // `quoteType`, a type's; each splice takes a node of the category its place holds.
  /** @throws {CompileError} */
  private quote(this: Mut<this>, e: Extract<Expr, { kind: "tagged" }>, asType: boolean): Type {
    if (e.typeArgs.length > 0) throw new CompileError("E1105", "a quote takes no type arguments", e.start, e.end);
    const q = quoted(this.ctx.tables, e, asType);
    q.asExpressions.clear();
    q.names.clear();
    const at = { start: e.start, end: e.end };
    const types = Object.fromEntries((["AstExpr", "AstStmt", "AstType"] as const).map((n) => [n, this.ctx.resolveType({ id: nextId(this.ids), kind: "ref", name: n, args: [], ...at })])) as Record<Category, Type>;
    holesOf(this.typing, q, types, e).forEach((category, i) => {
      const hole = q.holes[i]!;
      const t = this.value(hole);
      // An expression where a statement goes is the statement `e;`.
      if (category === "AstStmt" && !this.typing.fits(t, types.AstStmt) && this.typing.fits(t, types.AstExpr)) {
        q.asExpressions.add(i);
        category = "AstExpr";
      }
      this.coerce(hole, t, types[category], `a splice where ${category === "AstExpr" ? "an expression" : category === "AstStmt" ? "a statement" : "a type"} goes takes an '${category}', not '${this.typing.show(t)}'`);
    });
    this.quotes.set(e, types);
    return types[q.category];
  }

  // `` tag`a ${x} b` `` calls the tag with the template's text, known while compiling, then an
  // array of its values for the tag's rest parameter.
  /** @throws {CompileError} */
  private untag(this: Mut<this>, e: Extract<Expr, { kind: "tagged" }>): Expr {
    const { tag, template } = e;
    if (tag.kind === "member" && tag.name === "raw" && this.isString(tag.object)) {
      if (e.typeArgs.length > 0) throw new CompileError("E0106", "'String.raw' takes no type arguments", e.start, e.end);
      if (template.kind !== "template") throw new CompileError("E1107", "a tag is followed by a template literal", template.start, template.end);
      return this.rewrites.replace(e, rawTemplate(template.raw, template.exprs, e));
    }
    const target = tag.kind === "ident" && !this.ctx.lookup(tag.name) ? this.bodyNamed(tag.name) : undefined;
    if (tag.kind === "ident" && !target && !this.ctx.lookup(tag.name)) throw new CompileError("E0401", `unknown function '${tag.name}'${didYouMean(tag.name, this.ctx.names(tag.start))}`, tag.start, tag.end);
    if (!target || tag.kind !== "ident") throw new CompileError("E1107", "a tag has to be the name of a top-level function; methods, closures and other values as tags aren't supported yet", tag.start, tag.end);
    const shape = `'comptime strings: TemplateStringsArray, ...values: T[]'`;
    if (!tagStrings(target.params[0])) {
      throw new CompileError("E1107", `'${tag.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, tag.start, tag.end);
    }
    if (target.params.length !== 2 || !target.params[1]!.rest) throw new CompileError("E1107", `'${tag.name}' can't be a tag: a tag takes ${shape}`, tag.start, tag.end);
    if (template.kind !== "template") throw new CompileError("E1107", "a tag is followed by a template literal", template.start, template.end);
    const at = { start: template.start, end: template.end };
    const strings: Expr = { id: nextId(this.ids), kind: "array", elements: template.quasis.map((value): Expr => ({ id: nextId(this.ids), kind: "string", value, ...at })), ...at };
    const values: Expr = { id: nextId(this.ids), kind: "array", elements: template.exprs, ...at };
    const called = this.rewrites.replace(e, { id: 0, kind: "call", callee: tag, typeArgs: e.typeArgs, args: [strings, values], optional: false, start: e.start, end: e.end });
    this.tagCalls.add(called);
    return called;
  }

  // Whether `e` names the global `String`, which nothing in the program shadows.
  private isString(this: Mut<this>, e: Expr): boolean {
    return e.kind === "ident" && e.name === "String" && !this.ctx.lookup("String") && !this.classes.has("String") && !this.byName.has("String") && !this.byName.has("const String") && !this.enums.has("String");
  }

  // An arrow passed where a function type is declared takes its parameter types from it.
  /** @throws {CompileError} */
  private expectFrom(this: Mut<this>, target: Body, list: Expr[]) {
    const bounds = this.ctx.implicitOf(target);
    const generic = (target.typeParams?.length ?? 0) > 0 || (target.scope?.size ?? 0) > 0 || bounds.size > 0 || target.params.some((p) => p.comptime);
    const known = generic ? undefined : this.ctx.paramTypes(this.ctx.instanceOf(target));
    list.forEach((a, i) => {
      const t = bounds.get(i);
      const r = this.recOf(t);
      if (r?.kind === "function") this.expect(a, target.js ? this.typing.jsTakes(t as FunctionType) : t!);
      // A `new Promise` given for a `Promise<T>` parameter takes its T from there.
      if (r?.kind === "interface" && this.typing.promiseElement(t as InterfaceType) !== undefined) this.expect(a, t as InterfaceType);
      // An arrow in an object literal given for an object-typed parameter takes its field's type,
      // and a value for a Dyn field is boxed into it.
      if (t && r?.kind === "object" && a.kind === "object") {
        for (const p of a.props) {
          const declared = p.kind === "property" ? this.typing.field(t, p.key as string)?.type : undefined;
          const boxes = declared !== undefined && this.boxedIn(declared) !== undefined;
          const dict = p.kind === "property" && p.value.kind === "object" && declared !== undefined && (this.dictOf(declared) || this.optionalDict(declared));
          const want = p.kind === "property" && (p.value.kind === "arrow" || boxes || dict) ? declared : undefined;
          if (want && p.kind === "property") this.expect(p.value, want);
        }
      }
      // A parameter of a function that isn't generic has its type before the call; an arrow
      // given to a package is a callback JS keeps, so it owns what it captures.
      if (a.kind !== "arrow" && known && known[i] !== undefined) this.expect(a, target.js ? this.typing.jsTakes(known[i]!) : known[i]!);
      if (a.kind === "arrow" && known && target.js && known[i] !== undefined) this.expect(a, this.typing.jsTakes(known[i]!));
      // A literal for a tuple parameter is a tuple of its parts, in the parameter's shape.
      const written = target.params[i]?.type;
      const node = written?.kind === "operator" && written.op === "readonly" ? written.type : written;
      if (!known && (a.kind === "array" || this.tupleLiterals.has(a)) && node?.kind === "tuple") {
        this.ctx.exprsState.shaped.add(a);
        if (node.elements.some((n) => n.optional || n.rest)) this.ctx.exprsState.shapedBy.set(a, node);
      }
    });
  }

  // A call gives every parameter but the optional ones it leaves out, which come last.
  /** @throws {CompileError} */
  private arity(given: usize, params: Param[], at: Span) {
    // A rest parameter's array is packed from what follows the others, when they are all given.
    if (params.at(-1)?.rest && given < params.length - 1) {
      const least = params.filter((p) => !p.optional && !p.rest).length;
      if (given < least) throw new CompileError("E0501", `expected at least ${least} argument${least === 1 ? "" : "s"}, but got ${given}`, at.start, at.end);
    }
    const required = params.filter((p) => !p.optional && !p.rest).length;
    if (given >= required && given <= params.length) return;
    const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
    throw new CompileError("E0501", `expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${given}`, at.start, at.end);
  }

  // A callback given as a declared function's name becomes the closure calling it. A local
  // function given by name isn't converted yet.
  /** @throws {CompileError} */
  private namedFunction(this: Mut<this>, callback: Expr): Expr {
    if (callback.kind !== "ident") return callback;
    const local = this.ctx.lookup(callback.name);
    const held = local && this.typing.lower(local.type);
    const kind = this.recOf(held)?.kind;
    if (held && (kind === "closure" || kind === "function" || this.isCallable(held) || this.boundFunction(held) !== undefined)) {
      throw new CompileError("E0801", `a local function passed by name isn't supported yet; write an arrow calling it, as in '(x) => ${callback.name}(x)'`, callback.start, callback.end);
    }
    const declared = local ? undefined : this.bodyNamed(callback.name);
    return declared && !declared.comptime ? this.functionValue(callback, declared) : callback;
  }

  // A call through a generic function type, in a body checked before it knows the function: its
  // type parameters are inferred from the arguments, or written, and its signature resolved
  // with them.
  /** @throws {CompileError} */
  private familyCall(this: Mut<this>, e: Call, type: Pick<FunctionRecord, "generic">, name: string): { type: Type; throws: Type | undefined; what: string } {
    const { names, node: written, scope } = type.generic!;
    if (e.args.length !== written.params.length) throw new CompileError("E0501", `expected ${written.params.length} argument${written.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    const argTypes = e.args.map((a) => this.value(a));
    const bindings = new Map<string, Type>();
    if (e.typeArgs.length > 0) {
      if (e.typeArgs.length !== names.length) throw new CompileError("E0106", `expected ${names.length} type argument${names.length === 1 ? "" : "s"}, but got ${e.typeArgs.length}`, e.start, e.end);
      names.forEach((n, i) => bindings.set(n, this.ctx.resolveType(e.typeArgs[i]!)));
    } else written.params.forEach((p, i) => p.type && infer(this.ctx.tables, p.type, argTypes[i]!, new Set(names), bindings, e.args[i]!));
    for (const [i, n] of names.entries()) {
      const bound = bindings.get(n);
      if (!bound) throw new CompileError("E0104", `can't infer a type for '${n}' in this call of ${name}; pass it, as in '${(e.callee as { name?: string }).name ?? "f"}<i64>(...)'`, e.start, e.end);
      const constraint = written.typeParams[i]!.constraint;
      if (constraint) {
        const limit = this.ctx.resolveWith(constraint, new Map([...scope, ...bindings]));
        const reason = typeof limit !== "string" && this.typing.rec(limit).kind === "interface" ? unsatisfied(bound, limit as InterfaceType, this.ctx.members(), e) : this.typing.fits(bound, limit) ? undefined : `'${this.typing.show(bound)}' is not a '${this.typing.show(limit)}'`;
        if (reason) throw new CompileError("E0107", `type '${this.typing.show(bound)}' does not satisfy the constraint '${this.typing.show(limit)}' of '${n}' in ${name}: ${reason}`, e.start, e.end);
      }
    }
    e.args.forEach((a, i) => {
      const declared = this.ctx.resolveWith(written.params[i]!.type!, new Map([...scope, ...bindings]));
      // An optional parameter is an Option, as a call may leave it empty.
      const want = written.params[i]!.optional ? this.typing.unionType([declared, "null"]) : declared;
      this.coerce(a, argTypes[i]!, want, `argument of type '${this.typing.show(argTypes[i]!)}' is not assignable to parameter of type '${this.typing.show(want)}'`);
    });
    const full = new Map([...scope, ...bindings]);
    return { type: this.ctx.resolveWith(written.returns, full), throws: written.throws && this.ctx.resolveWith(written.throws, full), what: name };
  }

  // A generic function value, or a generic arrow, rewritten as an arrow calling it with its
  // arguments: given a function type, its parameters take that type's, and the call inside
  // infers the generic function's types from them.
  /** @throws {CompileError} */
  private instanceArrow(this: Mut<this>, e: Expr): Expr {
    if (e.kind === "arrow" && e.typeParams.some((p) => !isLifetime(p))) e = this.ctx.liftArrow(e);
    if (e.kind !== "ident") return e;
    const local = this.ctx.lookup(e.name);
    const held = local && this.typing.lower(this.isRefType(local.type) ? this.typing.rec(local.type).to : local.type);
    const r = this.recOf(held);
    const name = (local?.generic as Body | undefined)?.name ?? (r?.kind === "closure" ? r.generic : undefined) ?? (!local && this.bodyNamed(e.name)?.typeParams?.some((p) => !isLifetime(p)) ? e.name : undefined);
    const f = name === undefined ? undefined : this.bodyNamed(name);
    if (!f) return e;
    const at = { start: e.start, end: e.end };
    const odd = f.params.find((p) => this.defaulted.has(p) || p.comptime || p.rest);
    if (odd) throw unsupported(odd.comptime ? "generic functions with comptime parameters used as values" : odd.rest ? "generic functions with rest parameters used as values" : "generic functions with defaulted parameters used as values", e);
    // Its parameters keep the names it declares, unless one would hide it.
    const names = f.params.map((p, i) => (p.pattern.kind === "ident" && p.pattern.name !== name ? p.pattern.name : `arg${i}`));
    const params: Param[] = names.map((n): Param => ({ ...at, id: nextId(this.ids), pattern: { id: nextId(this.ids), kind: "ident", name: n, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false }));
    const call: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: name!, ...at }, typeArgs: [], args: names.map((n): Expr => ({ id: nextId(this.ids), kind: "ident", name: n, ...at })), optional: false, ...at };
    const arrow = this.rewrites.replace(e, { id: 0, kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call, ...at });
    this.madeArrows.add(arrow);
    return arrow;
  }

  // The Dyn of an interface a value meeting `t` is boxed into: `t` itself, or the one in an
  // Option, as an optional field's.
  private boxedIn(t: Type): DynType | undefined {
    const dyn = (u: Type) => {
      const r = this.recOf(u);
      return r?.kind === "dyn" && !this.typing.callableOf.has(r.of) && this.typing.promiseElement(r.of) === undefined;
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
  private genericValue(f: Body, e: Expr): Type {
    if (f.foreign) throw unsupported(`${f.rust ? "Rust" : "C"} functions used as values`, e);
    return this.typing.genericFunctionType(f.name, "a generic function");
  }

  // The generic function a generic function value names, when the callee is a local or a field
  // holding one; read for nothing else, it is called directly, in this instance.
  /** @throws {CompileError} */
  private genericTarget(this: Mut<this>, callee: Expr, receiver: Type | undefined): Body | undefined {
    let held: Type | undefined;
    if (callee.kind === "ident") {
      const local = this.ctx.lookup(callee.name);
      if (!local) return undefined;
      held = local.type;
      this.locals.set(callee, local.localId);
    } else if (callee.kind === "member" && this.pure(callee) && receiver !== undefined && (this.recOf(receiver)?.kind === "class" || this.recOf(receiver)?.kind === "object")) {
      if (this.typing.rec(receiver as ClassType).kind === "class" && inherited(this.arenas, this.ctx.classOf(receiver as ClassType as ClassType), "methods", callee.name)) return undefined;
      held = this.typing.field(receiver as ObjectType | ClassType as ClassType | ObjectType, callee.name)?.type;
      // A getter on the way runs code the direct call would skip.
      const t = held && this.typing.lower(this.isRefType(held) ? this.typing.rec(held).to : held);
      const r = this.recOf(t);
      if (r?.kind === "closure" && r.generic && this.throughGetter(callee)) throw unsupported("calls of a generic function value read through a getter", callee);
    }
    if (held === undefined) return undefined;
    const t = this.typing.lower(this.isRefType(held) ? this.typing.rec(held).to : held);
    const r = this.recOf(t);
    return r?.kind === "closure" && r.generic ? this.bodyNamed(r.generic) : undefined;
  }

  // A name or `this`, or fields read from one, which reading has no effect of its own unless a
  // getter is on the way.
  private pure(e: Expr): boolean {
    e = this.rewrites.current(e);
    return e.kind === "ident" || e.kind === "this" || (e.kind === "member" && !e.optional && this.pure(e.object));
  }

  /** @throws {CompileError} */
  private throughGetter(this: Mut<this>, e: Expr): boolean {
    e = this.rewrites.current(e);
    if (e.kind !== "member") return false;
    const object = this.types.get(e.object);
    const held = object && this.typing.lower(this.isRefType(object) ? this.typing.rec(object).to : object);
    const getter = this.recOf(held)?.kind === "class" && inherited(this.arenas, this.ctx.classOf(held as ClassType), "getters", e.name) !== undefined;
    return getter || this.throughGetter(e.object);
  }

  // `double` named where a value is wanted becomes `(x) => double(x)`, its parameters and their
  // types its declaration's, capturing nothing, so it passes, stores and boxes as any closure.
  /** @throws {CompileError} */
  private functionValue(this: Mut<this>, e: Extract<Expr, { kind: "ident" }>, f: Body): Expr {
    const written = e.name;
    const name = `'${written}'`;
    // A generic one given as a callback is the instance the callback's types make.
    if (f.typeParams?.some((p) => !isLifetime(p))) return this.instanceArrow(e);
    if (f.foreign) throw unsupported(`${f.rust ? "Rust" : "C"} functions used as values`, e);
    // A package's function Fish couldn't type is refused where it is used as a value too.
    const refused = f.js ? this.typing.jsUncalled.get(f) : undefined;
    if (refused) {
      refused.note ??= { message: `'${f.js!.name}' is used here`, start: e.start, end: e.end };
      throw refused;
    }
    if (f.throws) throw unsupported("functions that throw used as values", e);
    const odd = f.params.find((p) => this.defaulted.has(p) || p.comptime || p.rest);
    if (odd) throw unsupported(odd.comptime ? "functions with comptime parameters used as values" : odd.rest ? "functions with rest parameters used as values" : "functions with defaulted parameters used as values", e);
    // Typed where it is declared, so a type name means what it means there.
    // A function it takes is a stored callable, as a function type's parameters are.
    const types = this.ctx.paramTypes(this.ctx.instanceOf(f)).map((t) => {
      const fn = this.boundFunction(t) ?? t;
      const r = this.recOf(fn);
      return r?.kind === "function" && !r.generic ? this.typing.stored(fn as FunctionType) : t;
    });
    if (types.some((t) => this.recOf(t)?.kind === "function" || this.recOf(t)?.kind === "closure" || this.boundFunction(t) !== undefined)) throw unsupported("functions taking functions used as values", e);
    const at = { start: e.start, end: e.end };
    // A parameter keeps its name unless it would hide the function, or has none of its own.
    const names = f.params.map((p, i) => (p.pattern.kind === "ident" && p.pattern.name !== written && p.pattern.name !== f.name ? p.pattern.name : `${written}-arg${i}`));
    const clones = types.map((t) => !this.typing.isCopy(t));
    const params: Param[] = f.params.map((p, i): Param => ({ ...at, id: nextId(this.ids), pattern: { id: nextId(this.ids), kind: "ident", name: names[i]!, ...at }, type: undefined, optional: p.optional, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false }));
    params.forEach((p, i) => {
      this.presetParams.set(p, types[i]!);
      this.namedParams.set(p, { fn: written, names, clones });
    });
    const args: Expr[] = names.map((n): Expr => ({ id: nextId(this.ids), kind: "ident", name: n, ...at }));
    const call: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: written, ...at }, typeArgs: [], args, optional: false, ...at };
    const arrow = this.rewrites.replace(e, { id: 0, kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call, ...at });
    this.madeArrows.add(arrow);
    return arrow;
  }

  // The nested function a name calls, unless it is async, whose future holds what it uses. A
  // closure owning what it captures, async or `move`, takes the function as made where it is.
  private nestedFunction(this: Mut<this>, name: string): Local | undefined {
    if (this.ctx.owning) return undefined;
    const local = this.ctx.peek(name);
    return local && this.ctx.nestedLocal(local) ? local : undefined;
  }

  // `name(...)` on a nested function builds its environment for the call from this body's
  // bindings for what it captures, so a closure calling it captures those, not the function,
  // and changes what the function changes.
  /** @throws {CompileError} */
  private nestedCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "ident" }>, local: Local): { type: Type; what: string } {
    this.nestedEnv(e, local, callee);
    return this.closureCall(e, callee, local.type);
  }

  // Records this body's bindings for what a nested function captures, captured if need be,
  // each changing where the function changes it.
  /** @throws {CompileError} */
  private nestedEnv(this: Mut<this>, e: Expr, local: Local, at: Extract<Expr, { kind: "ident" }>) {
    const called = this.ctx.closureBody(this.typing.lower(local.type) as ClosureType);
    this.ctx.envOf(e, called, [...called.captures!.entries()].map(([alias, id]) => {
      // A closure captures it here, where the variable is named only through the function.
      const from = this.arenas.localOf(id as LocalId);
      const mine = this.ctx.reach(from, { id: nextId(this.ids), kind: "ident", name: from.name, start: at.start, end: at.end });
      if (called.changed?.has(alias)) this.changesLocal(mine, "", "change", at, false);
      return mine;
    }));
  }

  // A call of a closure held by a variable runs the closure's body.
  /** @throws {CompileError} */
  private closureCall(this: Mut<this>, e: Call, callee: Expr, known?: Type): { type: Type; what: string } {
    const held = known ?? this.value(callee);
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this function";
    const through = this.typing.lower(this.isRefType(held) ? this.typing.rec(held).to : held);
    // A generic function value reached here isn't a name or a field, which `callee` calls.
    const r = this.recOf(through);
    if (r?.kind === "closure" && r.generic) throw unsupported("calls of a generic function value that isn't a name or a field", callee);
    if (this.isCallable(through)) return this.callableCall(e, callee, through as DynType);
    // A parameter of a function type calls it through its signature; its instance, the
    // closure it was given.
    const type = this.recOf(this.boundFunction(held) ?? held);
    if (type === undefined || (type.kind !== "closure" && type.kind !== "function")) {
      throw new CompileError("E0503", `this expression is not callable: type '${this.typing.show(this.boundFunction(held) ?? held)}' has no call signatures`, callee.start, callee.end);
    }
    if (type.kind === "function" && type.generic) {
      const got = this.familyCall(e, type, name);
      if (got.throws) this.ctx.raise(e, got.throws, name);
      return got;
    }
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${name} takes no type arguments`, e.start, e.end);
    const written = type.kind === "closure" ? bodyOf(this.arenas, this.ctx.closureBody((this.boundFunction(held) ?? held) as ClosureType)).params : undefined;
    if (written) this.arity(e.args.length, written, e);
    else if (e.args.length !== type.params.length) {
      throw new CompileError("E0501", `expected ${type.params.length} argument${type.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      if (a.kind !== "arrow" || this.isCallable(type.params[i]!)) this.expect(a, type.params[i]!);
      const t = this.value(a);
      const shown = (written?.[i] && this.defaultedArg(a, t, written[i]!)) ?? type.params[i]!;
      this.coerce(a, t, type.params[i]!, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(shown)}'`);
    });
    const given = this.typing.lower(held);
    const run = this.recOf(given);
    if (run?.kind === "closure") this.calls.set(e, this.ctx.closureBody(given as ClosureType).id);
    // The closure it runs throws what it throws, which its function type may only widen.
    const error = run?.kind === "closure" ? run.throws : type.throws;
    if (error) this.ctx.raise(e, error, name);
    // Where the signature says `Promise<T>`, the call gives the future of the closure it was given.
    const returns = run?.kind === "closure" && this.typing.promiseElement(type.returns) !== undefined ? run.returns : type.returns;
    // An async arrow's future holds a copy of what it captured, references too.
    if (this.recOf(returns)?.kind === "future" && this.typing.holdsRef(returns)) this.borrowsFrom.set(e, [callee]);
    return { type: returns, what: name };
  }

  // `String.fromCharCode(...units)` and `String.fromCodePoint(...points)`: the arguments, spreads
  // of arrays among them, become one array of `u16` or `u32`.
  /** @throws {CompileError} */
  private stringStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const kinds: Record<string, ["units" | "points", Type]> = { fromCharCode: ["units", "u16"], fromCodePoint: ["points", "u32"] };
    if (callee.name === "raw") return this.rawCall(e);
    const kind = kinds[callee.name];
    if (!kind) throw new CompileError("E0502", `'String' has no '${callee.name}' yet; it has 'fromCharCode', 'fromCodePoint' and 'raw'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'String.${callee.name}' takes no type arguments`, e.start, e.end);
    const at = { start: e.args[0]?.start ?? e.end, end: e.args.at(-1)?.end ?? e.end };
    const gathered: Expr = e.args.length === 1 && this.stringBuilds.has(e) ? e.args[0]! : { id: nextId(this.ids), kind: "array", elements: e.args, ...at };
    const many = this.typing.arrayType(kind[1]);
    this.expect(gathered, many);
    const t = this.value(gathered);
    this.coerce(gathered, t, many, `'String.${callee.name}' takes ${kind[1]} values, and these are '${this.typing.show(t)}'`);
    this.stringBuilds.set(this.rewrites.replace(e, { ...e, args: [gathered] }), kind[0]);
    return { type: "string", what: `'String.${callee.name}'` };
  }

  // `String.raw({ raw: ["a", "b"] }, x)`: the strings with the values between them, as the tag
  // gives them, missing values empty as in JavaScript.
  /** @throws {CompileError} */
  private rawCall(this: Mut<this>, e: Call): { type: Type; what: string } {
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'String.raw' takes no type arguments", e.start, e.end);
    const [first, ...values] = e.args;
    const prop = first?.kind === "object" && first.props.length === 1 ? first.props[0] : undefined;
    const parts = prop?.kind === "property" && prop.key === "raw" && prop.value.kind === "array" ? prop.value.elements : undefined;
    const strings = parts?.flatMap((p) => (p?.kind === "string" ? [p.value] : []));
    if (!strings || strings.length !== parts!.length) {
      const at = first ?? e;
      throw new CompileError("E0504", "'String.raw' called as a function takes '{ raw: [...] }' holding an array of string literals first, so its text is known while compiling", at.start, at.end);
    }
    // JavaScript evaluates the values it drops, so a value past the last string is refused rather than left out.
    const extra = values[Math.max(strings.length - 1, 0)];
    if (extra) throw new CompileError("E0504", `'String.raw' has ${strings.length} string(s) here, so it takes at most ${Math.max(strings.length - 1, 0)} value(s) after them`, extra.start, e.args.at(-1)!.end);
    const spread = values.find((v) => v.kind === "spread");
    if (spread) throw new CompileError("E0504", "'String.raw' takes its values one by one, not spread", spread.start, spread.end);
    return { type: this.typeOf(this.rewrites.replace(e, rawTemplate(strings, values, e))), what: "'String.raw'" };
  }

  // A call of one of a string's methods, which takes its arguments as the method's parameters.
  /** @throws {CompileError} */
  private stringCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    this.text(callee.object, receiver, this.linked(callee));
    // A method that may take a regex looks at its first argument to see which it was given.
    const first = REGEX_METHODS.has(callee.name) && e.args[0] ? this.value(e.args[0]) : undefined;
    const rx = first === undefined ? undefined : this.asRegex(first);
    if (rx) return this.regexStringCall(e, callee, rx, this.typing.lower(first!) !== rx);
    if (first !== undefined && !stringMethods(this.typing)[callee.name]) throw new CompileError("E0508", `'${callee.name}' takes a regex, like '${callee.name}(/x/${callee.name === "matchAll" ? "g" : ""})'; Fish doesn't turn a string into one`, e.args[0]!.start, e.args[0]!.end);
    // `concat` takes any number of strings, as `+` joins them.
    if (callee.name === "concat") {
      for (const a of e.args) {
        if (a.kind === "spread") throw new CompileError("E0801", "a spread into 'concat' isn't supported yet; join the array instead, as in 's + parts.join(\"\")'", a.start, a.end);
        const t = this.value(a);
        if (!stringLike(this.typing, this.typing.lower(t))) throw new CompileError("E0504", `'concat' takes strings, and this is '${this.typing.show(t)}'; convert it with 'String(x)'`, a.start, a.end);
        this.coerce(a, t, "string", "");
      }
      return { type: "string", what: "'concat'" };
    }
    const method = stringMethods(this.typing)[callee.name];
    if (!method) throw new CompileError("E0502", `strings have no method '${callee.name}' yet${didYouMean(callee.name, Object.keys(stringMethods(this.typing)))}`, callee.start, callee.end);
    const [params, returns, required] = method;
    if (e.args.length < required || e.args.length > params.length) {
      const count = required === params.length ? `${required}` : `${required} or ${params.length}`;
      throw new CompileError("E0504", `'${callee.name}' takes ${count} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const t = i === 0 && first !== undefined ? first : this.value(a);
      this.coerce(a, t, params[i]!, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(params[i]!)}'`);
    });
    return { type: returns, what: `'${callee.name}'` };
  }

  // A string method taking a regex: `g` decides whether \`replace\`, \`match\` and \`split\` use
  // every match or the first, and \`matchAll\` and \`replaceAll\` need it, as JavaScript requires.
  /** @throws {CompileError} */
  private regexStringCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, rx: RegexType, generic: boolean): { type: Type; what: string } {
    const name = callee.name;
    const what = `'${name}'`;
    const global = this.typing.rec(rx).flags.includes("g");
    const typed = !this.typing.rec(rx).any || generic;
    const unknown = () => new CompileError("E0508", `${what} types its matches from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    if (e.optional || callee.optional) throw new CompileError("E0508", `${what} with a regex is called without '?.'`, e.start, e.end);
    const most = name === "search" || name === "match" || name === "matchAll" ? 1 : 2;
    if (e.args.length > most || (name.startsWith("replace") && e.args.length < 2)) {
      throw new CompileError("E0508", name.startsWith("replace") ? `${what} takes a regex and what replaces each match: a string, or an arrow function` : name === "split" ? "'split' takes a regex and an optional limit" : `${what} takes one regex`, e.start, e.end);
    }
    // What these give, or whether they may run, depends on the flags, which a 'RegExp' kept here
    // doesn't show.
    if (!typed && (name === "match" || name === "matchAll" || name === "replaceAll")) throw unknown();
    if ((name === "matchAll" || name === "replaceAll") && !global) throw new CompileError("E0508", `${what} needs a regex with the 'g' flag, as JavaScript requires`, e.args[0]!.start, e.args[0]!.end);
    if (name === "matchAll" && !typed) throw unknown();
    if (name === "split" && e.args[1]) {
      const limit = e.args[1];
      const t = this.value(limit);
      if (t !== "i64" && t !== "usize" && !this.adapt(limit, "i64")) throw new CompileError("E0504", `a limit is an 'i64', not '${this.typing.show(t)}'`, limit.start, limit.end);
    }
    if (name.startsWith("replace")) this.replacement(e, rx, typed, unknown);
    this.regexStringCalls.set(e, name);
    return { type: regexStringType(this.typing, name, rx, !typed), what };
  }

  // What replaces each match: a string with $ patterns, or an arrow function given the match,
  // each capture, the offset, the string and, when the pattern names them, the groups.
  /** @throws {CompileError} */
  private replacement(this: Mut<this>, e: Call, rx: RegexType, typed: boolean, unknown: () => CompileError): Type {
    const given = e.args[1]!;
    if (given.kind !== "arrow") {
      const t = this.read(given);
      if (!stringLike(this.typing, t)) throw new CompileError("E0508", `what replaces each match is a string or an arrow function, not '${this.typing.show(t)}'`, given.start, given.end);
      // With named groups, $<name> must name one, as JavaScript's early check would if it had one.
      const names = new Set(this.typing.rec(rx).captures.flatMap((c) => (c.name === undefined ? [] : [c.name])));
      const missing = given.kind === "string" && names.size > 0 ? [...given.value.matchAll(/\$\$|\$<([^>]*)>/g)].find((m) => m[1] !== undefined && !names.has(m[1])) : undefined;
      if (missing) throw new CompileError("E0508", `the regex has no group named '${missing[1]}' for '${missing[0]}'`, given.start, given.end);
      if (t !== "string") this.coerce(given, t, "string", "");
      return "string";
    }
    if (!typed) throw unknown();
    const match = this.typing.matchType(rx);
    const groups = this.typing.field(match, "groups")?.type;
    const params: Type[] = ["string", ...this.typing.elementsOf(match).slice(1), "i64", "string", ...(groups ? [this.typing.refType(groups, false)] : [])];
    const names = ["match", ...this.typing.rec(rx).captures.map((_, i) => `p${i + 1}`), "offset", "string", ...(groups ? ["groups"] : [])];
    if (given.params.length > params.length) throw new CompileError("E0508", `the replacing function is given ${names.join(", ")}`, given.params[params.length]!.start, given.params[params.length]!.end);
    this.expect(given, this.typing.functionType(names, params, "string"));
    const called = this.value(given);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0508", "what replaces each match is a string or an arrow function", given.start, given.end);
    this.runsOften(called as ClosureType, "replace", "its function once per match", given);
    c.params.forEach((p, i) => this.passedExactly("replace", params[i]!, p, given.params[i], given.params[i] ?? given));
    if (!this.typing.fits(c.returns, "string")) throw new CompileError("E0508", `the replacing function gives the string each match becomes, not '${this.typing.show(c.returns)}'`, given.start, given.end);
    return "string";
  }

  // An array's method: `push` moves a value in at the end; `pop` takes the last one out, or
  // gives an empty Option. Both change the array.
  /** @throws {CompileError} */
  private arrayCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const typed = this.typing.typedName(array);
    if (typed && (callee.name === "subarray" || callee.name === "set")) this.ctx.exprsState.once.add(callee.object);
    // `subarray` is a copy, as `slice` is: a typed array owns its elements, so a write to it
    // doesn't reach the array it came from.
    // Its positions, like set's offset, may be an `i64` or a `usize`, as JavaScript code holding
    // positions in either ports as written.
    if (typed && callee.name === "subarray") {
      const made = this.become(e, { ...e, callee: { ...callee, id: nextId(this.ids), name: "slice" }, args: e.args.map((a) => this.arrayLength(a, false)) }) as Call;
      this.ctx.exprsState.subarrays.set(made, this.placeText(callee.object));
      return this.call(made);
    }
    if (SUBARRAY_WRITES.has(callee.name)) this.readOnlySubarray(callee.object);
    // `set(source, offset?)` copies the source's elements in at the offset. The source comes
    // first, so one made from the target, as in `a.set(a.subarray(0, 3), 1)`, is made before the
    // target is borrowed to change; the target itself as the source is copied first.
    if (typed && callee.name === "set") {
      if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'set' takes the array to copy in, and an optional offset", e.start, e.end);
      const at = { start: e.start, end: e.end };
      const [written, offset] = e.args as [Expr, Expr | undefined];
      const root = (x: Expr): string | undefined => (x.kind === "ident" ? x.name : x.kind === "this" ? "this" : x.kind === "member" || x.kind === "index" ? root(x.object) : undefined);
      const same = root(written) !== undefined && root(written) === root(callee.object);
      const source: Expr = same ? { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: written, name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at } : written;
      this.expect(source, array);
      return this.call(this.become(e, this.typedCall(`array typed set ${TYPED_ARRAYS[typed]}`, [source, callee.object, offset ? this.arrayLength(offset, false) : { id: nextId(this.ids), kind: "int", value: 0n, ...at }, { id: nextId(this.ids), kind: "int", value: BigInt(typedSize(typed)), ...at }], at)) as Call);
    }
    if (!ARRAY_METHODS.has(callee.name)) throw new CompileError("E0502", `arrays have no method '${callee.name}' yet${didYouMean(callee.name, ARRAY_METHODS)}`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling array methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${callee.name}' takes no type arguments`, e.start, e.end);
    // Methods giving clones of the elements refuse elements that can't be cloned.
    if (["at", "find", "findLast", "filter", "slice", "concat", "fill", "entries", "values", "copyWithin", ...COPYING_METHODS].includes(callee.name) || ((callee.name === "reduce" || callee.name === "reduceRight") && e.args.length === 1)) this.clonable(this.typing.rec(array).element, callee, callee.name);
    if (callee.name === "flat" && this.isArray(this.typing.lower(this.typing.rec(array).element))) this.clonable(this.typing.rec(this.typing.lower(this.typing.rec(array).element) as ArrayType).element, callee, "flat");
    // `entries()`, `keys()` and `values()` call the prelude's generators, which borrow the array
    // while they live and give `[i, element]` pairs, indexes and elements, each element a clone.
    if (Object.hasOwn(ITERATORS, callee.name)) {
      if (e.args.length > 0) throw new CompileError("E0504", `'${callee.name}' takes no arguments`, e.start, e.end);
      return this.call(this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: ITERATORS[callee.name]!, start: callee.start, end: callee.end }, args: [callee.object], typeArgs: [] }) as Call);
    }
    // `toBase64(options?)` and `toHex()` on bytes call the prelude's encoders, which borrow them.
    if (Object.hasOwn(BYTE_METHODS, callee.name)) {
      if (this.typing.lower(this.typing.rec(array).element) !== "u8") throw new CompileError("E0504", `'${callee.name}' encodes bytes, a 'u8[]', not '${this.typing.show(array)}'`, callee.start, callee.end);
      const most = callee.name === "toBase64" ? 1 : 0;
      if (e.args.length > most) throw new CompileError("E0504", most === 0 ? `'${callee.name}' takes no arguments` : "'toBase64' takes an optional options object, as in '{ alphabet: \"base64url\", omitPadding: true }'", e.start, e.end);
      return this.call(this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: BYTE_METHODS[callee.name]!, start: callee.start, end: callee.end }, args: [callee.object, ...e.args], typeArgs: [] }) as Call);
    }
    if (this.readCopy(callee.object) && ["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "reserve", "shrinkToFit"].includes(callee.name)) {
      throw new CompileError("E0211", `'${callee.name}' changes its array, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
    }
    const held = this.types.get(callee.object)!;
    if (this.isRefType(held)) this.coercions.set(callee.object, array);
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
      this.coerce(i, t, "i64", `argument of type '${this.typing.show(t)}' is not assignable to parameter of type 'i64'`);
      return { type: this.typing.unionType([this.typing.rec(array).element, "null"]), what: "'at'" };
    }
    if (CHANGING_METHODS.has(callee.name)) return this.changingCall(e, callee, array);
    const count = callee.name === "push" ? 1 : 0;
    if (e.args.length !== count) throw new CompileError("E0504", `'${callee.name}' takes ${count === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    if (!this.place(callee.object)) throw new CompileError("E0212", `'${callee.name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    this.changeable(callee.object, callee.name === "push" ? "push to" : "pop from");
    if (callee.name === "pop") return { type: this.typing.unionType([this.typing.rec(array).element, "null"]), what: "'pop'" };
    this.expect(e.args[0]!, this.typing.rec(array).element);
    const t = this.value(e.args[0]!);
    this.coerce(e.args[0]!, t, this.typing.rec(array).element, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(this.typing.rec(array).element)}'`);
    return { type: "void", what: "'push'" };
  }

  // `map`, `filter`, `find`, `some`, `every` and `reduce` run the callback on each element in
  // turn, given it as a shared borrow, or a copy when it copies, and its index. `filter` and
  // `find` give clones of what they keep, and `reduce` without an initial value starts from a
  // clone of the first element.
  /** @throws {CompileError} */
  private callbackCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const reducing = name === "reduce" || name === "reduceRight";
    if (reducing ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      throw new CompileError("E0506", `'${name}' takes ${reducing ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'"}`, e.start, e.end);
    }
    const [named, init] = e.args as [Expr, Expr | undefined];
    const callback = this.namedFunction(named);
    if (callback.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const element = this.typing.isCopy(this.typing.rec(array).element) ? this.typing.rec(array).element : this.typing.refType(this.typing.rec(array).element, false);
    const acc = !reducing ? undefined : init ? this.typing.widenLet(this.value(init)) : this.typing.rec(array).element;
    const params = acc ? [acc, element, "i64" as const] : [element, "i64" as const];
    if (callback.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    const signature = this.typing.functionType(acc ? ["accumulator", "value", "index"] : ["value", "index"], params, "void");
    this.typing.openThrows.add(signature);
    this.expect(callback, signature);
    const called = this.value(callback);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    if (c.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.start, callback.end);
    }
    this.runsOften(called as ClosureType, name, "its callback once per element", callback);
    c.params.forEach((p, i) => {
      const at = callback.params[i] ?? callback;
      this.passedExactly(name, params[i]!, p, callback.params[i], at, i !== params.length - 1);
    });
    const gives = c.returns;
    if (this.holdsFuture(gives)) throw new CompileError("E0801", `'${name}' with a callback giving a Promise isn't supported yet; await each value in a 'for...of' loop instead`, callback.start, callback.end);
    if (PREDICATES.has(name) && gives !== "boolean") {
      throw new CompileError("E0506", `'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
    }
    if (acc && !this.typing.fits(gives, acc)) throw new CompileError("E0506", `'${name}''s callback gives the next accumulator, a '${this.typing.show(acc)}', but this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || this.typing.holdsRef(gives))) throw new CompileError("E0506", `'map''s callback has to give a value to keep, not '${this.typing.show(gives)}'`, callback.start, callback.end);
    const many = this.typing.lower(gives);
    if (name === "flatMap" && (typeof many === "string" || this.typing.rec(many).kind !== "array")) {
      throw new CompileError("E0506", `'flatMap''s callback gives an array for each element, whose elements make up the result; this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
    }
    const type = name === "map" ? this.typing.arrayType(gives) : name === "flatMap" ? many : name === "filter" ? array : name === "find" || name === "findLast" ? this.typing.unionType([this.typing.rec(array).element, "null"])
      : name === "findIndex" || name === "findLastIndex" ? "i64" : name === "forEach" ? "void" : acc ?? "boolean";
    if (c.throws) this.ctx.raise(e, c.throws, `'${name}'`);
    return { type, what: `'${name}'` };
  }

  // `sort()` orders numbers numerically and strings by UTF-16 code units; `sort(compare)` by
  // the sign of what the comparator gives for two elements. Stable, and in place, so it gives
  // nothing.
  // `toSorted` checks as `sort` does, and gives the sorted copy.
  /** @throws {CompileError} */
  private sortCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const copying = name === "toSorted";
    if (e.args.length > 1) throw new CompileError("E0506", `'${name}' takes an optional comparator like '(a, b) => a - b'`, e.start, e.end);
    if (!copying && !this.place(callee.object)) throw new CompileError("E0212", "'sort' sorts its array in place, so call it on a variable or a field", callee.start, callee.end);
    if (!copying) this.changeable(callee.object, "sort");
    const gives: { type: Type; what: string } = { type: copying ? array : "void", what: copying ? "'toSorted'" : "'sort', which sorts its array in place," };
    let compare = e.args[0];
    if (!compare) {
      const element = this.typing.lower(this.typing.rec(array).element);
      if (!isNumeric(element) && element !== "string") {
        throw new CompileError("E0506", `'${name}()' without a comparator orders numbers and strings, not '${this.typing.show(this.typing.rec(array).element)}'; give a comparator like '(a, b) => a.n - b.n'`, callee.start, callee.end);
      }
      return gives;
    }
    compare = this.namedFunction(compare);
    if (compare.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes a comparator written in place, like '(a, b) => a - b', or a function by name`, compare.start, compare.end);
    if (compare.params.length > 2) throw new CompileError("E0506", `'${name}' passes its comparator two elements`, compare.params[2]!.start, compare.params[2]!.end);
    const held = this.typing.rec(array).element;
    const element = this.typing.isCopy(held) ? held : this.typing.refType(held, false);
    this.expect(compare, this.typing.functionType(["a", "b"], [element, element], "void"));
    const called = this.value(compare);
    const c = this.recOf(called);
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a comparator like '(a, b) => a - b'`, compare.start, compare.end);
    this.runsOften(called as ClosureType, name, "its comparator many times", compare);
    c.params.forEach((p, i) => {
      this.passedExactly(name, element, p, compare.params[i], compare);
    });
    const order = this.typing.lower(c.returns);
    if (isInteger(order) && !INTEGERS[order].signed) {
      throw new CompileError("E0506", `a comparator's number has to be able to be negative, and '${this.typing.show(c.returns)}' can't; convert with 'as i64', or compare: 'a < b ? -1 : a > b ? 1 : 0'`, compare.start, compare.end);
    }
    if (!isNumeric(order)) {
      throw new CompileError("E0506", `a comparator gives a number: negative when 'a' comes first, positive when 'b' does, zero to keep their order; this one gives '${this.typing.show(c.returns)}'`, compare.start, compare.end);
    }
    return gives;
  }

  // `toReversed()`, `toSpliced(start?, count?, ...items)` and `with(i, v)` give a copy of the
  // array changed as `reverse`, `splice` and a write at `i` change theirs; values given move in.
  /** @throws {CompileError} */
  private copyingCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const element = this.typing.rec(array).element;
    const counts: Record<string, [usize, usize, string]> = {
      toReversed: [0, 0, "no arguments"], toSpliced: [0, Infinity, "an optional start, an optional count to remove and the values to put in their place"],
      with: [2, 2, "a position, like 'with(-1, x)' for the last element, and the value to put there"],
    };
    const [least, most, takes] = counts[name]!;
    if (e.args.length < least || e.args.length > most) throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const target = i === 0 || (i === 1 && name === "toSpliced") ? "i64" : element;
      this.expect(a, target);
      const given = this.value(a);
      this.coerce(a, given, target, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(target)}'`);
    });
    return { type: array, what: `'${name}'` };
  }

  // `shift` moves the first element out; `unshift` moves values in at the front; `splice`
  // moves a run out and values in where it was; `reverse`, `fill` and `copyWithin` change the
  // array in place.
  // What they give, JavaScript's new length for `unshift` and the array itself for `reverse`
  // and `fill`, they don't.
  /** @throws {CompileError} */
  private changingCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (!this.place(callee.object)) throw new CompileError("E0212", `'${name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    this.changeable(callee.object, name);
    const element = (a: Expr) => {
      this.expect(a, this.typing.rec(array).element);
      const t = this.value(a);
      this.coerce(a, t, this.typing.rec(array).element, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(this.typing.rec(array).element)}'`);
    };
    const position = (a: Expr) => {
      this.expect(a, "i64");
      const t = this.value(a);
      this.coerce(a, t, "i64", `argument of type '${this.typing.show(t)}' is not assignable to parameter of type 'i64'`);
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
    if (name === "shift") return { type: this.typing.unionType([this.typing.rec(array).element, "null"]), what: "'shift'" };
    if (name === "splice") return { type: array, what: "'splice'" };
    return { type: "void", what };
  }

  // `x as const`: a literal checked as its literal type, deeply, as TypeScript gives it.
  /** @throws {CompileError} */
  private constAssertion(this: Mut<this>, x: Expr): Type {
    x = this.rewrites.current(x);
    const enumMember = x.kind === "member" && x.object.kind === "ident" && !this.ctx.lookup(x.object.name) && this.enums.has(x.object.name);
    const literal = ["string", "template", "int", "float", "bool", "array", "object"].includes(x.kind) || (x.kind === "unary" && x.op === "-" && (x.operand.kind === "int" || x.operand.kind === "float")) || enumMember;
    if (!literal) throw new CompileError("E0111", "a 'const' assertion can only be applied to an enum member, or a string, number, boolean, array or object literal", x.start, x.end);
    const t = this.constType(x);
    this.expect(x, t);
    this.coerce(x, this.value(x), t, `type '${this.typing.show(this.types.get(x) ?? t)}' is not assignable to type '${this.typing.show(t)}'`);
    return t;
  }

  // The type `as const` gives an expression: a literal's own, an array of strings the array of
  // their union, a mixed array a tuple, and an object's fields readonly. Anything else is
  // checked here, once, and keeps its type.
  /** @throws {CompileError} */
  private constType(this: Mut<this>, written: Expr): Type {
    const x = this.keyed(this.rewrites.current(written));
    if (x.kind === "string") return this.typing.literalType(x.value);
    if (x.kind === "template" && x.exprs.length === 0) return this.typing.literalType(x.quasis[0]!);
    if (x.kind === "int" && x.value <= I64_MAX) return this.typing.literalType(x.value);
    if (x.kind === "unary" && x.op === "-" && x.operand.kind === "int" && x.operand.value <= I64_MAX) return this.typing.literalType(-x.operand.value);
    if (x.kind === "bool") return this.typing.literalType(x.value);
    if (x.kind === "array" && x.elements.length === 0) return this.typing.tupleType([]);
    if (x.kind === "array" && x.elements.every((y) => y !== undefined && y.kind !== "spread")) {
      const parts = (x.elements as Expr[]).map((y) => this.constType(y));
      return parts.every((p) => this.constWide(p) === this.constWide(parts[0]!)) ? this.typing.arrayType(this.constJoin(parts)) : this.typing.tupleType(parts, undefined, undefined, true);
    }
    const props = x.kind === "object" ? x.props.filter((p): p is Extract<ObjectProp, { kind: "property" }> => p.kind === "property" && typeof p.key === "string") : [];
    if (x.kind === "object" && props.length === x.props.length) return this.typing.objectType(props.map((p) => ({ name: p.key as string, type: this.constType(p.value), readonly: true })));
    const t = this.value(x);
    this.ctx.exprsState.once.add(x);
    return t;
  }

  // A const type with its literals widened to their base types, so parts that agree on it join.
  private constWide(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "literal" && !r.owner) return this.typing.baseOf(t as LiteralType);
    if (r?.kind === "object" && r.tuple) return this.typing.tupleType(this.typing.elementsOf(t as ObjectType).map((p) => this.constWide(p)));
    if (r?.kind === "object") return this.typing.objectType(r.fields.map((f) => ({ ...f, type: this.constWide(f.type) })));
    return t;
  }

  // One type holding each of parts, which widen alike: the union of their literals or objects, as
  // TypeScript gives, so an object's fields stay linked; tuples are joined position by position,
  // since a union of tuples can't be destructured.
  private constJoin(this: Mut<this>, parts: Type[]): Type {
    const r = this.recOf(parts[0]!);
    if (r?.kind === "object" && r.tuple) return this.typing.tupleType(this.typing.elementsOf(parts[0] as ObjectType).map((_, i) => this.constJoin(parts.map((p) => this.typing.elementsOf(p as ObjectType)[i]!))));
    return this.typing.unionType(parts);
  }

  // `[a, b]` written where a tuple is expected: each element checked against its own type, then
  // the literal becomes the object of fields `0`, `1` and on that the tuple is laid out as.
  /** @throws {CompileError} */
  private tupleLiteral(this: Mut<this>, e: Expr, tuple: ObjectType): Type {
    const elements = this.typing.elementsOf(tuple);
    // Once a literal became an object, its rest elements are its field `...`, checked again.
    const parts = this.tupleParts(e) as Expr[];
    const given = this.typing.rec(tuple).rest !== undefined && e.kind === "object" ? parts.slice(0, -1) : [...parts];
    const least = this.typing.rec(tuple).required ?? elements.length;
    const fixed = given.slice(0, elements.length);
    const spread = fixed.find((x) => x.kind === "spread");
    if (spread) throw unsupported("spread elements in tuple literals", spread);
    if (given.length < least || (given.length > elements.length && this.typing.rec(tuple).rest === undefined)) {
      const count = this.typing.rec(tuple).rest !== undefined ? `at least ${least}` : least === elements.length ? `${least}` : `${least} to ${elements.length}`;
      throw new CompileError("E0117", `type '${this.typing.show(tuple)}' has ${count} element${elements.length === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
    }
    // Optional elements left out are empty.
    for (let i = fixed.length; i < elements.length; i++) fixed.push({ id: nextId(this.ids), kind: "null", start: e.end, end: e.end } as Expr);
    fixed.forEach((x, i) => {
      const t = this.value(x);
      this.coerce(x, t, elements[i]!, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(elements[i]!)}'`);
    });
    // A rest tuple's further elements are an array literal of its rest type, spreads allowed.
    const many: Expr[] = [];
    if (this.typing.rec(tuple).rest !== undefined) {
      const rest = this.typing.arrayType(this.typing.rec(tuple).rest!);
      const extra: Expr = e.kind === "object" ? parts.at(-1)! : { id: nextId(this.ids), kind: "array", elements: given.slice(elements.length), start: e.start, end: e.end };
      this.expect(extra, rest);
      const t = this.value(extra);
      this.coerce(extra, t, rest, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(rest)}'`);
      many.push(extra);
    }
    if (e.kind === "array") {
      this.tupleLiterals.add(this.rewrites.replace(e, { id: 0, kind: "object", props: [...fixed, ...many].map((value, i): ObjectProp => ({ id: nextId(this.ids), kind: "property", key: i < elements.length ? String(i) : "...", value, start: value.start, end: value.end })), start: e.start, end: e.end }));
    }
    return tuple;
  }

  // The tuple a literal of these parts' types is where a generic function takes one: its parts in
  // order, or in the shape its parameter writes, an optional element left out being empty and the
  // parts past the fixed ones its rest.
  private shapedTuple(e: Expr, parts: Type[]): ObjectType {
    const node = this.ctx.exprsState.shapedBy.get(e);
    if (!node) return this.typing.tupleType(parts);
    // Checked once already, the literal's last part is its rest's array.
    const again = e.kind === "object" && node.elements.some((n) => n.rest);
    const given = again ? parts.slice(0, -1) : parts;
    const fixed = node.elements.filter((n) => !n.rest);
    const required = fixed.findIndex((n) => n.optional);
    const elements = fixed.map((n, i): Type => (i >= given.length ? "null" : n.optional ? this.typing.unionType([given[i]!, "null"]) : given[i]!));
    if (!node.elements.some((n) => n.rest)) return given.length > fixed.length ? this.typing.tupleType(given) : this.typing.tupleType(elements, required < 0 ? undefined : required);
    // No parts past the fixed ones say nothing about the rest, as an empty array literal doesn't.
    const extra = given.slice(fixed.length);
    const rest = again ? this.typing.rec(parts.at(-1) as ArrayType).element : extra.length === 0 ? "never" : this.typing.unionType(extra);
    return this.typing.tupleType(elements, undefined, rest);
  }

  // `t[0]` on a tuple reads its field `0`: the index is a number written in place naming one of
  // its elements, and the expression becomes that field's read.
  /** @throws {CompileError} */
  private untuple(this: Mut<this>, e: Expr): boolean {
    e = this.rewrites.current(e);
    if (e.kind !== "index") return false;
    // Named as the object of an index, as the index's own check would name it.
    if (e.object.kind === "ident") this.ctx.exprsState.objects.add(e.object);
    const through = this.value(e.object);
    // Whatever reads the object next, the index's check or the field's, takes this type, so a
    // chain of indexes is checked once, not once per level and again for each.
    this.ctx.exprsState.once.add(e.object);
    const held = this.isRefType(through) ? this.typing.rec(through).to : through;
    const r = this.recOf(held);
    const object = r?.kind === "shared" ? this.typing.lower(r.of) : held;
    if (!this.typing.isTuple(object)) return this.keyRead(e, object);
    const count = this.typing.elementsOf(object as ObjectType).length;
    if (e.index.kind !== "int") throw new CompileError("E0117", `a tuple's element is named by a number written in place, like '[0]'; '${this.typing.show(object)}' has no element for a computed index`, e.index.start, e.index.end);
    const n = e.index.value;
    // Past a rest tuple's fixed elements, an index reads its array, panicking past the end.
    if (n >= BigInt(count) && this.typing.rec(object as ObjectType).rest !== undefined) {
      const at = { start: e.index.start, end: e.index.end };
      const array: Expr = { id: nextId(this.ids), kind: "member", object: e.object, name: "...", optional: false, start: e.object.start, end: e.object.end };
      this.restStarts.set(array, count);
      this.rewrites.replace(e, { ...e, object: array, index: { id: nextId(this.ids), kind: "int", value: n - BigInt(count), ...at } });
      return false;
    }
    if (n >= BigInt(count)) throw new CompileError("E0117", `tuple type '${this.typing.show(object)}' of length ${count} has no element at index ${n}`, e.index.start, e.index.end);
    if (e.optional) throw unsupported("optional index expressions", e);
    this.rewrites.replace(e, { id: 0, kind: "member", object: e.object, name: String(n), optional: false, start: e.start, end: e.end });
    return true;
  }

  // `o[K]` on an object or an instance, with a key known while compiling, reads the field it names.
  /** @throws {CompileError} */
  private keyRead(this: Mut<this>, e: Extract<Expr, { kind: "index" }>, object: Type): boolean {
    const r = this.recOf(object);
    const shaped = (k: string | undefined) => k === "object" || k === "class";
    // A type parameter, an object-typed parameter's included, reads its fields as a member does.
    if (!shaped(r?.kind) && r?.kind !== "param" && !(r?.kind === "union" && r.members.every((m) => shaped(this.recOf(m)?.kind)))) return false;
    const name = this.knownKey(e.index);
    if (name.startsWith("#")) throw new CompileError("E0502", `'${name}' names no field: a private field is read as '${this.placeText(e.object)}.${name}'`, e.index.start, e.index.end);
    if (e.optional) throw unsupported("optional index expressions", e);
    this.rewrites.replace(e, { id: 0, kind: "member", object: e.object, name, optional: false, start: e.start, end: e.end });
    return true;
  }

  // A tuple literal's elements, as written or once it became an object.
  private tupleParts(e: Expr): (Expr | undefined)[] {
    e = this.rewrites.current(e);
    if (e.kind === "array") return e.elements;
    return e.kind === "object" ? e.props.map((p) => (p.kind === "property" ? p.value : undefined)) : [];
  }

  // `FixedArray.filled<T, N>(v)`: N copies of `v`, its type written or the one expected.
  /** @throws {CompileError} */
  private filled(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name !== "filled") throw new CompileError("E0502", `'FixedArray' has no '${callee.name}'; make one with 'FixedArray.filled<T, N>(value)' or a literal`, callee.start, callee.end);
    const written = e.typeArgs.length > 0 ? this.ctx.resolveType({ id: nextId(this.ids), kind: "ref", name: "FixedArray", args: e.typeArgs, start: e.start, end: e.end }) : this.ctx.exprsState.wanted.get(e);
    if (!written || !this.isFixed(written)) throw new CompileError("E0104", "say which fixed array to fill, as in 'FixedArray.filled<i64, 4>(0)'", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("E0504", "'FixedArray.filled' takes the value to fill it with", e.start, e.end);
    this.clonable(this.typing.rec(written).element, e, "FixedArray.filled");
    const v = e.args[0]!;
    this.expect(v, this.typing.rec(written).element);
    const t = this.value(v);
    this.coerce(v, t, this.typing.rec(written).element, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(this.typing.rec(written).element)}'`);
    // Each instance's own type, as a generic body's differ, and a statement keeps it too.
    this.fixedFills.add(e);
    this.types.set(e, written);
    return { type: written, what: "'FixedArray.filled'" };
  }

  // `Array.of(a, b)` is the array literal `[a, b]`; `Array.from(x, f?)` is the array of what x
  // holds, clones of an array's elements, a string's code points or a generator's values, or of
  // `0` to `n - 1` from `{ length: n }`, mapped by f when there is one.
  // `x.toFixed(digits)` prints a number with that many digits after the point, as JavaScript does.
  /** @throws {CompileError} */
  private toFixed(this: Mut<this>, e: Call): { type: Type; what: string } {
    if (e.args.length > 1) throw new CompileError("E0504", "'toFixed' takes how many digits to print after the point, 0 when not given", e.start, e.end);
    const digits = e.args[0];
    const receiver = (e.callee as Extract<Expr, { kind: "member" }>).object;
    this.loaded(receiver, this.types.get(receiver)!);
    this.fixedPrints.add(e);
    if (!digits) return { type: "string", what: "'toFixed'" };
    const t = this.value(digits);
    if (t !== "i64" && !this.adapt(digits, "i64")) throw new CompileError("E0504", `'toFixed' takes its digits as an 'i64', not '${this.typing.show(t)}'`, digits.start, digits.end);
    return { type: "string", what: "'toFixed'" };
  }

  // `x.checkedAdd(y)` and its kin: the other operand is x's type, or a `u32` for a shift or a
  // power; checked gives an Option, overflowing a tuple with whether it overflowed.
  /** @throws {CompileError} */
  private integerCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, type: Integer): { type: Type; what: string } {
    const [family, operation] = integerMethod(callee.name)!;
    const what = `'${callee.name}'`;
    if (callee.optional || this.linked(callee)) throw new CompileError("E0801", `${what} can't be called through an optional chain yet; check for null first`, callee.start, callee.end);
    if (operation === "Neg" && family === "saturating" && !INTEGERS[type].signed) throw new CompileError("E0502", `'${this.typing.show(type)}' has no method ${what}: an unsigned number is never negated past its range; use 'checkedNeg' or 'wrappingNeg'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    this.loaded(callee.object, this.types.get(callee.object)!);
    const other: Integer = ["Shl", "Shr", "Pow"].includes(operation) ? "u32" : type;
    const arity = operation === "Neg" ? 0 : 1;
    if (e.args.length !== arity) throw new CompileError("E0504", arity === 0 ? `${what} takes no argument` : `${what} takes one '${this.typing.show(other)}'`, e.start, e.end);
    for (const a of e.args) {
      const t = this.read(a);
      if (t !== other && !this.adapt(a, other)) throw new CompileError("E0111", `${what} on '${this.typing.show(type)}' takes a '${this.typing.show(other)}', not '${this.typing.show(t)}'; convert it with 'as', as in 'n as ${this.typing.show(other)}'`, a.start, a.end);
    }
    this.integerCalls.add(e);
    const result = family === "checked" ? this.typing.unionType([type, "null"]) : family === "overflowing" ? this.typing.tupleType([type, "boolean"]) : type;
    return { type: result, what };
  }

  // The global `parseInt`, `parseFloat`, `Number` and `Number.parse...` a call makes, unless a
  // name of the program's hides it.
  private parserOf(this: Mut<this>, callee: Expr): "parseInt" | "parseFloat" | "Number" | undefined {
    const global = (name: string) => !this.ctx.lookup(name) && !this.classes.has(name) && !this.byName.has(name) && !this.byName.has(`const ${name}`) && !this.enums.has(name);
    if (callee.kind === "ident" && (callee.name === "parseInt" || callee.name === "parseFloat" || callee.name === "Number") && global(callee.name)) return callee.name;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Number" && global("Number") && (callee.name === "parseInt" || callee.name === "parseFloat")) return callee.name;
    return undefined;
  }

  // Parsing a number gives an Option where JavaScript would give NaN.
  /** @throws {CompileError} */
  private parse(this: Mut<this>, e: Call, name: "parseInt" | "parseFloat" | "Number"): { type: Type; what: string } {
    const what = `'${name}'`;
    const most = name === "parseInt" ? 2 : 1;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    if (e.args.length < 1 || e.args.length > most) throw new CompileError("E0504", name === "parseInt" ? "'parseInt' takes a string and an optional radix" : `${what} takes one string`, e.start, e.end);
    const t = this.read(e.args[0]!);
    if (!stringLike(this.typing, t)) {
      const hint = name === "Number" && isNumeric(t) ? "; to convert a number, write 'x as f64'" : "";
      throw new CompileError("E0504", `${what} parses a string, not '${this.typing.show(t)}'${hint}`, e.args[0]!.start, e.args[0]!.end);
    }
    if (t !== "string") this.coerce(e.args[0]!, t, "string", "");
    const radix = e.args[1];
    if (radix) {
      const r = this.value(radix);
      if (r !== "i64" && !this.adapt(radix, "i64")) throw new CompileError("E0504", `a radix is an 'i64', not '${this.typing.show(r)}'`, radix.start, radix.end);
    }
    this.parses.set(e, name);
    return { type: this.typing.unionType([name === "parseInt" ? "i64" : "f64", "null"]), what };
  }

  // `assert(cond, message?)`, checked here so its panic can name the call's place.
  /** @throws {CompileError} */
  private assertion(this: Mut<this>, e: Call): { type: Type; what: string } {
    if (e.typeArgs.length > 0 || e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'assert' takes a condition and an optional message, as in 'assert(n > 0, \"n is positive\")'", e.start, e.end);
    this.condition(e.args[0]!);
    const message = e.args[1];
    if (message) {
      const t = this.read(message);
      if (!stringLike(this.typing, t)) throw new CompileError("E0504", `an assertion's message is a string, not '${this.typing.show(t)}'`, message.start, message.end);
      if (t !== "string") this.coerce(message, t, "string", "");
    }
    this.asserts.set(e, textAt(this.files, e.args[0]!));
    return { type: "void", what: "'assert'" };
  }

  // A regex's pattern, parsed and compiled here so its errors come while compiling.
  /** @throws {CompileError} */
  private regexLiteral(source: string, flags: string, at: Span, shown: string = source): RegexType {
    try {
      const pattern = parsePattern(source, flags, this.regex);
      compileRegex(pattern, this.regex);
      return this.typing.regexType(source, flags, pattern.captures, shown);
    } catch (err) {
      if (err instanceof RegexSyntaxError) throw new CompileError("E0508", err.message, at.start, at.end);
      throw err;
    }
  }

  // `new RegExp(pattern, flags?)` with both known while compiling is a regex like a literal's.
  /** @throws {CompileError} */
  private regexNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, list: Expr[]): Type {
    if (list.length < 1 || list.length > 2) throw new CompileError("E0508", "'new RegExp' takes a pattern and optional flags", e.start, e.end);
    const known = list.map((a) => (a.kind === "string" ? a.value : a.kind === "template" && a.exprs.length === 0 ? a.quasis[0]! : undefined));
    if (known.some((k) => k === undefined)) {
      throw new CompileError("E0508", "a regex is compiled while compiling, so 'new RegExp' takes its pattern and flags as string literals; for a pattern known only when the program runs, Fish has no regex", e.start, e.end);
    }
    this.regexNews.add(e);
    return this.regexLiteral(known[0]!, known[1] ?? "", e, this.shownSource(known[0]!));
  }

  // `re.test(s)` and `re.exec(s)`. A regex keeps no `lastIndex`, so on a `g` or `y` regex they
  // would loop forever where JavaScript moves on; `matchAll` goes through every match instead.
  /** @throws {CompileError} */
  private regexCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: RegexType, generic: boolean): { type: Type; what: string } {
    const what = `'${callee.name}'`;
    if (callee.name !== "test" && callee.name !== "exec") throw new CompileError("E0508", `'RegExp' has no method '${callee.name}' in Fish; it has 'test' and 'exec', and strings take regexes in 'replace', 'split', 'match' and 'matchAll'`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", `a regex is always there, so ${what} is called without '?.'`, e.start, e.end);
    if (/[gy]/.test(this.typing.rec(t).flags)) {
      throw new CompileError("E0508", `a Fish regex keeps no 'lastIndex', so ${what} on a regex with the '${this.typing.rec(t).flags.includes("g") ? "g" : "y"}' flag would start at 0 every time; ${callee.name === "exec" ? "use 'matchAll' to go through every match, or" : ""} drop the flag`, e.start, e.end);
    }
    if (e.args.length !== 1) throw new CompileError("E0504", `${what} takes the string to match`, e.start, e.end);
    const s = this.read(e.args[0]!);
    if (!stringLike(this.typing, s)) throw new CompileError("E0504", `${what} matches a string, not '${this.typing.show(s)}'`, e.args[0]!.start, e.args[0]!.end);
    if (s !== "string") this.coerce(e.args[0]!, s, "string", "");
    this.loaded(callee.object, this.types.get(callee.object)!);
    if (callee.name === "exec" && this.typing.rec(t).any && !generic) {
      throw new CompileError("E0508", "'exec' types its match from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter", e.start, e.end);
    }
    this.regexCalls.set(e, callee.name);
    return { type: callee.name === "test" ? "boolean" : this.typing.unionType([this.typing.matchType(t), "null"]), what };
  }

  // The regex a value is: its own type, or, for a `RegExp` parameter in a generic body's
  // definition, any regex.
  private asRegex(t: Type): RegexType | undefined {
    const held = this.typing.lower(t);
    if (typeof held === "string") return undefined;
    const r = this.typing.rec(held);
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
  private regexMember(e: Extract<Expr, { kind: "member" }>, t: RegexType, generic: boolean): Type {
    if (this.typing.rec(t).any && !generic && (e.name === "source" || e.name === "flags" || e.name in REGEX_FLAGS)) {
      throw new CompileError("E0508", `'${e.name}' is known from a regex's pattern, which isn't known for a 'RegExp' kept here; read it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    }
    if (e.name === "source" || e.name === "flags") return "string";
    if (e.name in REGEX_FLAGS) return "boolean";
    if (e.name === "lastIndex") throw new CompileError("E0508", "a Fish regex keeps no state, so it has no 'lastIndex'; use 'matchAll' to go through every match", e.start, e.end);
    throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(t)}'`, e.start, e.end);
  }

  // `Date.now()` and `performance.now()`, unless a name of the program's hides `Date` or
  // `performance`; their other members aren't there yet. std's Date class, under its own name or
  // the one it takes beside a program's own Date, is the clock's owner rather than a hiding name.
  /** @throws {CompileError} */
  private clockOf(this: Mut<this>, callee: Expr): "Date.now" | "performance.now" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident") return undefined;
    const std = callee.object.name === "std Date" && callee.start >= STD_BASE;
    const owner = std ? "Date" : callee.object.name;
    const declared = this.classes.get(owner);
    const hidden = declared !== undefined && !(owner === "Date" && this.arenas.classOf(declared).node.start >= STD_BASE);
    if ((owner !== "Date" && owner !== "performance") || (!std && (this.ctx.lookup(owner) || hidden || this.byName.has(owner) || this.byName.has(`const ${owner}`) || this.enums.has(owner)))) return undefined;
    if (owner === "Date" && callee.name === "parse") throw new CompileError("E0801", "'Date.parse' isn't supported yet, as reading dates from strings isn't; give 'new Date(ms)' milliseconds since the epoch", callee.start, callee.end);
    if (callee.name !== "now") throw new CompileError("E0801", `'${owner}.${callee.name}' isn't supported yet; '${owner}.now()' is`, callee.start, callee.end);
    return `${owner}.now` as "Date.now" | "performance.now";
  }

  // std's Date is made from milliseconds alone: reading a string and the year, month, day form,
  // which counts in local time, aren't there yet.
  /** @throws {CompileError} */
  private dateNew(this: Mut<this>, e: Expr, list: Expr[], argTypes: Type[]) {
    if (list.length > 1) throw new CompileError("E0801", "'new Date(year, month, ...)' isn't supported yet, as local time isn't; give 'new Date(ms)' milliseconds since the epoch", e.start, e.end);
    const t = argTypes[0];
    if (t !== undefined && (t === "string" || (this.recOf(t)?.kind === "literal" && typeof this.typing.rec(t as LiteralType).value === "string"))) {
      throw new CompileError("E0801", "'new Date(text)' isn't supported yet, as reading dates from strings isn't; give 'new Date(ms)' milliseconds since the epoch", e.start, e.end);
    }
  }

  // `JSON.stringify` and `JSON.parse`, unless a name of the program's hides `JSON`.
  private jsonOf(this: Mut<this>, callee: Expr): "stringify" | "parse" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident" || callee.object.name !== "JSON") return undefined;
    if (this.ctx.lookup("JSON") || this.classes.has("JSON") || this.byName.has("JSON") || this.byName.has("const JSON") || this.enums.has("JSON")) return undefined;
    return callee.name === "stringify" || callee.name === "parse" ? callee.name : undefined;
  }

  // `JSON.stringify(x)`: x written as JSON text, which its type decides.
  /** @throws {CompileError} */
  private stringify(this: Mut<this>, e: Call): { type: Type; what: string } {
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'JSON.stringify' takes no type argument; the value's type decides how it is written", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.stringify' replacer and indent arguments", e.args[1]!);
    const x = e.args[0];
    if (!x) throw new CompileError("E0509", "'JSON.stringify' takes the value to write", e.start, e.end);
    this.jsonable(this.read(x), x, "written as");
    this.jsonCalls.set(e, "stringify");
    return { type: "string", what: "'JSON.stringify'" };
  }

  // `JSON.parse<T>(s)`: s read as a T, throwing a JsonError when it isn't one.
  /** @throws {CompileError} */
  private jsonParse(this: Mut<this>, e: Call): { type: Type; what: string } {
    // Without a type it reads the dynamic `Json` value, as TypeScript's gives `any`.
    const [written = { id: nextId(this.ids), kind: "ref", name: JSON_VALUE_NAME, args: [], start: e.start, end: e.end } as TypeNode, ...others] = e.typeArgs;
    if (others.length > 0) throw new CompileError("E0106", "'JSON.parse' takes one type argument, the type to read", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.parse' revivers", e.args[1]!);
    const text = e.args[0];
    if (!text) throw new CompileError("E0509", "'JSON.parse' takes the text to read", e.start, e.end);
    const t = this.ctx.resolveType(written);
    this.jsonable(t, written, "read from");
    if (this.typing.holdsRef(t)) throw new CompileError("E0509", `'JSON.parse' makes owned values, so '${this.typing.show(t)}' can't hold references`, written.start, written.end);
    if (this.typing.holdsPattern(t)) throw unsupported("template literal pattern types in 'JSON.parse'", written);
    if (this.typing.holdsPart(t, (u) => typeof u !== "string" && this.typing.rec(u).kind === "fixed")) throw unsupported("fixed-size arrays in 'JSON.parse'", written);
    const hidden = this.typing.holdsPart(t, (u) => typeof u !== "string" && this.typing.rec(u).kind === "class" && this.typing.rec(u).fields.some((f) => f.name.startsWith("#")));
    if (hidden) throw new CompileError("E0509", "a class with '#private' fields can't be read from JSON, since JSON doesn't hold them", written.start, written.end);
    const s = this.read(text);
    if (!stringLike(this.typing, s)) throw new CompileError("E0509", `'JSON.parse' reads a string, not '${this.typing.show(s)}'`, text.start, text.end);
    if (s !== "string") this.coerce(text, s, "string", "");
    this.ctx.raise(e, this.arenas.classOf(this.classes.get("JsonError")!).type, "'JSON.parse'");
    this.jsonCalls.set(e, "parse");
    return { type: t, what: "'JSON.parse'" };
  }

  // Refuses a type with a part JSON can't hold, saying why.
  /** @throws {CompileError} */
  private jsonable(t: Type, at: Span, verb: string) {
    // What an unknown holds is known once the whole program is checked, and checked then.
    if (this.typing.holdsPart(t, (u) => this.typing.isUnknown(u), true)) {
      if (verb !== "written as") throw new CompileError("E0509", "'JSON.parse' can't read into an 'unknown', which holds only what the program puts in one; read into 'Json' to take any JSON", at.start, at.end);
      this.ctx.tables.unknownJson.push(at);
    }
    const part = this.typing.unjson(t, (c) => this.derivesJson(c));
    if (!part) return;
    const r = this.recOf(part);
    const why = r === undefined ? "it has no JSON form"
      : r.kind === "class" ? `a class is ${verb} JSON when it has '@derive(Json)', which '${r.name}' doesn't`
      : r.kind === "variant" ? `an enum holding values is ${verb} JSON when it has '@derive(Json)', which '${r.enum}' doesn't`
      : r.kind === "map" ? (r.set ? "a Set has no JSON form; use an array of its members" : "only a Map with string keys has a JSON form, an object")
      : "it has no JSON form";
    throw new CompileError("E0509", `values of type '${this.typing.show(part)}' can't be ${verb} JSON: ${why}`, at.start, at.end);
  }

  /** @throws {CompileError} */
  private derivesJson(this: Mut<this>, t: ClassType | VariantType): boolean {
    const r = this.typing.rec(t);
    if (r.kind === "variant") return [...this.enums.values()].some((e) => e.data?.name === r.enum && e.data.json);
    return this.ctx.classOf(t as ClassType).node.derives?.includes("Json") ?? false;
  }

  // The global `Math`, unless a name of the program's hides it.
  private isMath(this: Mut<this>, e: Expr): boolean {
    return e.kind === "ident" && e.name === "Math" && !this.ctx.lookup("Math") && !this.classes.has("Math") && !this.byName.has("Math") && !this.byName.has("const Math") && !this.enums.has("Math");
  }

  // `Math.abs`, `sign`, `min` and `max` keep the numeric type they are given, a literal taking
  // the type of the numbers beside it as with an operator; the rest take and give `f64`.
  /** @throws {CompileError} */
  private mathCall(this: Mut<this>, e: Call, name: string): { type: Type; what: string } {
    const what = `'Math.${name}'`;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `${what} takes no type argument`, e.start, e.end);
    if (name === "random") {
      if (e.args.length > 0) throw new CompileError("E0504", "'Math.random' takes no arguments", e.start, e.end);
      this.clocks.set(e, "Math.random");
      return { type: "f64", what };
    }
    const arity = MATH_FLOAT[name];
    if (arity !== undefined) {
      if (e.args.length !== arity) throw new CompileError("E0504", `${what} takes ${arity === 1 ? "one number" : "two numbers"}`, e.start, e.end);
      for (const a of e.args) {
        const t = this.brandBase(this.read(a));
        if (t === "f64" || this.adapt(a, "f64")) continue;
        throw new CompileError("E0111", isNumeric(t) ? `${what} takes a '${this.typing.show("f64")}', an f64, not '${this.typing.show(t)}'; convert it with 'as', as in 'n as f64'` : `${what} takes a number, not '${this.typing.show(t)}'`, a.start, a.end);
      }
      this.maths.add(e);
      return { type: "f64", what };
    }
    if (!["abs", "sign", "min", "max"].includes(name)) throw new CompileError("E0801", `'Math' has no '${name}' in Fish yet`, e.start, e.end);
    const many = name === "min" || name === "max";
    if (many ? e.args.length === 0 : e.args.length !== 1) throw new CompileError("E0504", many ? `${what} takes one or more numbers` : `${what} takes one number`, e.start, e.end);
    const given = e.args.map((a) => this.brandBase(this.read(a)));
    given.forEach((t, i) => {
      if (!isNumeric(t)) throw new CompileError("E0504", `${what} takes numbers, not '${this.typing.show(t)}'`, e.args[i]!.start, e.args[i]!.end);
    });
    const fixed = e.args.findIndex((a) => !this.literalOnly(a, true));
    const to = fixed >= 0 ? given[fixed]! : given.some(isFloat) ? "f64" : "i64";
    e.args.forEach((a, i) => {
      if (given[i] !== to && !this.adapt(a, to)) throw new CompileError("E0111", `${what} takes numbers of one type, but got '${this.typing.show(to)}' and '${this.typing.show(given[i]!)}'; convert one with 'as'`, a.start, a.end);
    });
    this.maths.add(e);
    return { type: to, what };
  }

  // `new Uint8Array(...)` and its siblings: an empty one, n zeros, a copy of an array's elements,
  // or the elements an ArrayBuffer holds, which it takes, as every typed array owns its own.
  /** @throws {CompileError} */
  private typedNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, name: TypedName, list: Expr[]): Type {
    const typed = this.typing.typedArray(name);
    const at = { start: e.start, end: e.end };
    const usage = name === "ArrayBuffer" ? "'new ArrayBuffer(n)' takes its length in bytes" : `'new ${name}' takes a length, an array to copy, or an ArrayBuffer with an optional byte offset and length`;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    this.refuseSpread(list);
    if (list.length === 0) return this.typedAs(e, { id: nextId(this.ids), kind: "array", elements: [], ...at }, typed);
    const [source, ...rest] = list as [Expr, ...Expr[]];
    if (rest.length > (name === "ArrayBuffer" ? 0 : 2)) throw new CompileError("E0504", usage, e.start, e.end);
    if (source.kind === "array" && rest.length === 0 && name !== "ArrayBuffer") return this.typedAs(e, source, typed);
    const t = this.value(source);
    this.ctx.exprsState.once.add(source);
    const held = this.isRefType(t) ? this.typing.rec(t).to : t;
    if (isInteger(t) && rest.length === 0) return this.typedAs(e, this.typedCall("array typed zeros", [this.arrayLength(source, false), this.typedZero(name, source)], at), typed);
    if (this.typing.typedName(held) === "ArrayBuffer" && name !== "ArrayBuffer") {
      const int = (value: bigint): Expr => ({ id: nextId(this.ids), kind: "int", value, ...at });
      const size = BigInt(typedSize(name));
      return this.typedAs(e, this.typedCall(`array from buffer ${TYPED_ARRAYS[name]}`, [source, rest[0] ? this.arrayLength(rest[0], false) : int(0n), rest[1] ? this.arrayLength(rest[1], false) : int(-1n), int(size), { id: nextId(this.ids), kind: "string", value: name, ...at }], at), typed);
    }
    if (this.isArray(held) && rest.length === 0 && name !== "ArrayBuffer") {
      const element = this.typing.lower(this.typing.rec(held).element);
      if (element !== TYPED_ARRAYS[name]) throw new CompileError("E0101", `'new ${name}' copies elements of type '${this.typing.show(TYPED_ARRAYS[name])}', not '${this.typing.show(element)}'; convert them first, as in 'xs.map((x) => x as ${TYPED_ARRAYS[name]})'${floatInto(element, TYPED_ARRAYS[name])}`, source.start, source.end);
      return this.typedAs(e, { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: source, name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at }, typed);
    }
    throw new CompileError("E0504", usage, e.start, e.end);
  }

  // `e` rewritten as `to`, which makes a typed array's elements, typed as that typed array.
  /** @throws {CompileError} */
  private typedAs(this: Mut<this>, e: Expr, to: Expr, typed: ArrayType, mapped = false): Type {
    const made = this.become(e, to);
    this.expect(made, typed);
    const t = this.value(made);
    const name = this.typing.typedName(typed)!;
    const element = this.isArray(t) ? this.typing.lower(this.typing.rec(t).element) : undefined;
    // A map function giving another number type is told how to convert what it gives.
    if (mapped && element !== undefined && isNumeric(element) && !this.typing.fits(t, typed)) {
      throw new CompileError("E0101", `'${name}.from' holds elements of type '${this.typing.show(TYPED_ARRAYS[name])}', and this function gives '${this.typing.show(element)}'; convert what it gives, as in '(x) => (...) as ${TYPED_ARRAYS[name]}'${floatInto(element, TYPED_ARRAYS[name])}`, e.start, e.end);
    }
    this.coerce(made, t, typed, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(typed)}'`);
    return typed;
  }

  // A typed array's byte length, byte offset, element size and buffer. It owns its elements from
  // the start of its own buffer, so its offset is 0 and its buffer is a copy of its bytes.
  /** @throws {CompileError} */
  private typedMember(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, name: TypedName): Type {
    const at = { start: e.start, end: e.end };
    const size = typedSize(name);
    const int = (value: bigint): Expr => ({ id: nextId(this.ids), kind: "int", value, ...at });
    if (this.linked(e)) throw unsupported("optional chains reading a typed array's properties", e);
    this.ctx.exprsState.once.add(e.object);
    if (e.name === "BYTES_PER_ELEMENT") return this.typeOf(this.become(e, int(BigInt(size))));
    if (e.name === "byteOffset") return this.typeOf(this.become(e, { id: nextId(this.ids), kind: "as", expr: int(0n), type: { id: nextId(this.ids), kind: "ref", name: "usize", args: [], ...at }, ...at }));
    if (e.name === "buffer") return this.typeOf(this.become(e, this.typedCall(`array typed buffer ${TYPED_ARRAYS[name]}`, [e.object, int(BigInt(size))], at)));
    const length: Expr = { id: nextId(this.ids), kind: "member", object: e.object, name: "length", optional: false, ...at };
    return this.typeOf(this.become(e, size === 1 ? length : { id: nextId(this.ids), kind: "binary", op: "*", left: length, right: int(BigInt(size)), ...at }));
  }

  // A `subarray` is a copy, so a write to it would be lost where JavaScript's reaches the array
  // it views: it is read, and never bound with 'let', assigned, lent mutably or changed.
  /** @throws {CompileError} */
  readOnlySubarray(e: Expr) {
    const from = this.ctx.exprsState.subarrays.get(this.rewrites.current(e));
    if (from === undefined) return;
    const named = from === "(...)" ? "the array it came from" : `'${from}'`;
    throw new CompileError("E0212", `subarray copies in Fish, so writes would not reach ${named}; use 'slice()' for a copy you'll change, or write through ${named} at an offset`, e.start, e.end);
  }

  private typedCall(name: string, args: Expr[], at: Span): Expr {
    return { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name, ...at }, args, typeArgs: [], optional: false, ...at };
  }

  // A zero of a typed array's element, which picks the helper's instance.
  private typedZero(name: TypedName, at: Span): Expr {
    const span = { start: at.start, end: at.end };
    return { id: nextId(this.ids), kind: "as", expr: { id: nextId(this.ids), kind: "int", value: 0n, ...span }, type: { id: nextId(this.ids), kind: "ref", name: TYPED_ARRAYS[name], args: [], ...span }, ...span };
  }

  // `Uint8Array.from(xs, f?)` and `Uint8Array.of(...)`: a typed array of the elements given, or of
  // what f makes of each; `Uint8Array.BYTES_PER_ELEMENT` is its element's size.
  /** @throws {CompileError} */
  private typedStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, name: TypedName): { type: Type; what: string } {
    const typed = this.typing.typedArray(name);
    const at = { start: e.start, end: e.end };
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}.${callee.name}' takes no type arguments`, e.start, e.end);
    if (name === "ArrayBuffer" || (callee.name !== "from" && callee.name !== "of")) throw new CompileError("E0502", `'${name}' has no static '${callee.name}'${name === "ArrayBuffer" ? "" : `; make one with 'new ${name}(...)', '${name}.from(xs)' or '${name}.of(...)'`}`, callee.start, callee.end);
    this.refuseSpread(e.args);
    if (callee.name === "of") return { type: this.typedAs(e, { id: nextId(this.ids), kind: "array", elements: e.args, ...at }, typed), what: `'${name}.of'` };
    if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", `'${name}.from' takes the array to copy, and an optional function mapping each value`, e.start, e.end);
    const [source, f] = e.args as [Expr, Expr | undefined];
    if (f) {
      const mapped: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: source, name: "map", optional: false, ...at }, args: [f], typeArgs: [], optional: false, ...at };
      return { type: this.typedAs(e, mapped, typed, true), what: `'${name}.from'` };
    }
    const made: Expr = { id: nextId(this.ids), kind: "new", callee: { id: nextId(this.ids), kind: "ident", name, ...at }, args: [source], typeArgs: [], ...at };
    return { type: this.typedAs(e, made, typed), what: `'${name}.from'` };
  }

  /** @throws {CompileError} */
  private arrayStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const at = { start: callee.start, end: callee.end };
    if (callee.name === "of") {
      if (e.typeArgs.length > 1) throw new CompileError("E0106", "'Array.of' takes one type argument, its element type", e.start, e.end);
      if (e.typeArgs[0]) this.ofElements.set(e, e.typeArgs[0]);
      const literal = this.rewrites.replace(e, { id: 0, kind: "array", elements: e.args, start: e.start, end: e.end });
      return { type: this.value(literal), what: "'Array.of'" };
    }
    // `Array.isArray(v)`: whether v holds an array, which narrows a union to its array members.
    if (callee.name === "isArray") {
      if (e.typeArgs.length > 0 || e.args.length !== 1) throw new CompileError("E0504", "'Array.isArray' takes the value to test", e.start, e.end);
      this.read(e.args[0]!);
      this.kindTests.set(e, "Array");
      return { type: "boolean", what: "'Array.isArray'" };
    }
    if (callee.name !== "from") throw new CompileError("E0502", `'Array' has no '${callee.name}'; arrays are made with 'Array.of', 'Array.from' or 'new Array(n).fill(x)'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "'Array.from' takes no type argument; its element type is what the source holds, or what the map function gives", e.start, e.end);
    if (e.args.length < 1 || e.args.length > 2) throw new CompileError("E0504", "'Array.from' takes what to make the array from, and an optional function mapping each value", e.start, e.end);
    const [source, f] = e.args as [Expr, Expr | undefined];
    const prelude = (name: string, args: Expr[]): Expr => ({ id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name, ...at }, args, typeArgs: [], optional: false, ...at });
    const prop = source.kind === "object" && source.props.length === 1 ? source.props[0]! : undefined;
    const written = prop?.kind === "property" && prop.key === "length" ? prop.value
      : prop?.kind === "shorthand" && prop.name === "length" && !prop.default ? { id: nextId(this.ids), kind: "ident", name: "length", start: prop.start, end: prop.end } as Expr : undefined;
    const length = written && this.arrayLength(written, false);
    let made: Expr;
    if (length) {
      if (!f) throw new CompileError("E0504", "'Array.from({ length: n })' alone would hold n undefined values, which Fish has no way to make; give it a function, as in 'Array.from({ length: n }, (_, i) => i)'", e.start, e.end);
      made = prelude("array range", [length]);
    } else {
      const t = this.value(source);
      const held = this.isRefType(t) ? this.typing.rec(t).to : t;
      if (this.typing.iterableElement(held) !== undefined) throw unsupported("'Array.from' over an 'Iterable' parameter", source);
      const inner = this.embeddedIterated(source, held);
      if (inner) {
        const listed: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: inner, name: this.embeddedOf(held)!.embedded === "Set" ? "values" : "entries", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
        return this.call(this.rewrites.replace(e, { ...e, args: [listed, ...e.args.slice(1)] }) as Call);
      }
      if (this.isArray(held)) made = f ? source : { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: source, name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
      else if (stringLike(this.typing, held)) made = prelude("array chars", [source]);
      else if (this.typing.yieldsOf(held) !== undefined) made = prelude("array collect", [source]);
      else if (this.iteratorCall(source, held)) made = prelude("array collect", [this.iteratorCall(source, held)!]);
      else throw new CompileError("E0119", `'Array.from' makes an array from an array, a string, a generator, an iterable class or '{ length: n }', not '${this.typing.show(t)}'`, source.start, source.end);
    }
    if (f) made = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: made, name: "map", optional: false, ...at }, args: [f], typeArgs: [], optional: false, ...at };
    return this.call(this.rewrites.replace(e, { ...made, start: e.start, end: e.end }) as Call);
  }

  // An object literal meeting a dictionary: the Map it is, made from its entries in order.
  /** @throws {CompileError} */
  private dictLiteral(this: Mut<this>, e: Extract<Expr, { kind: "object" }>, t: MapType) {
    const at = { start: e.start, end: e.end };
    const entries = e.props.map((p): Expr => {
      if (p.kind === "spread") throw unsupported("spreads into a dictionary", p);
      if (p.kind !== "property" && p.kind !== "shorthand") throw unsupported("methods and accessors in a dictionary", p);
      if (p.kind === "property" && typeof p.key !== "string") throw unsupported("computed keys in a dictionary", p);
      const key: Expr = { id: nextId(this.ids), kind: "string", value: p.kind === "property" ? p.key as string : p.name, start: p.start, end: p.end };
      const value: Expr = p.kind === "property" ? p.value : { id: nextId(this.ids), kind: "ident", name: p.name, start: p.start, end: p.end };
      return { id: nextId(this.ids), kind: "array", elements: [key, value], start: p.start, end: p.end };
    });
    const args: Expr[] = entries.length > 0 ? [{ id: nextId(this.ids), kind: "array", elements: entries, ...at }] : [];
    const made = this.become(e, { id: nextId(this.ids), kind: "new", callee: { id: nextId(this.ids), kind: "ident", name: "Map", ...at }, args, typeArgs: [], ...at });
    this.ctx.exprsState.wanted.set(made, t);
  }

  // `Object.keys(o)`, `Object.values(o)` and `Object.entries(o)`: o's fields are known while
  // compiling, so each becomes an array literal reading them, the values cloned. A dictionary's
  // become calls of its Map's own, which give its entries in the order they were made.
  /** @throws {CompileError} */
  private objectStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const name = callee.name;
    if (name !== "keys" && name !== "values" && name !== "entries") throw new CompileError("E0502", `'Object' has no '${name}' yet; it has 'keys', 'values' and 'entries'`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", `'Object' is always there, so 'Object.${name}' is called without '?.'`, e.start, e.end);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'Object.${name}' takes no type arguments`, e.start, e.end);
    const o = e.args[0];
    if (!o || e.args.length > 1 || o.kind === "spread") throw new CompileError("E0504", `'Object.${name}' takes the object to read`, e.start, e.end);
    if (this.dictOf(this.value(this.spanned(renumberExpr(cloneExpr(o), () => nextId(this.ids)), o)))) return this.call(this.dictCall(e, o, name, []));
    const fields = this.objectRead(name, o).fields;
    const at = { start: e.start, end: e.end };
    const key = (f: Field): Expr => ({ id: nextId(this.ids), kind: "string", value: f.name, ...at });
    const fieldValue = (f: Field): Expr => {
      const member: Expr = { id: nextId(this.ids), kind: "member", object: this.spanned(renumberExpr(cloneExpr(o), () => nextId(this.ids)), o), name: f.name, optional: false, ...at };
      return this.typing.isCopy(f.type) ? member : { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: member, name: "clone", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
    };
    const elements = fields.map((f): Expr => (name === "keys" ? key(f) : name === "values" ? fieldValue(f) : { id: nextId(this.ids), kind: "array", elements: [key(f), fieldValue(f)], ...at }));
    const array = this.rewrites.replace(e, { id: 0, kind: "array", elements, ...at });
    this.ctx.tables.objectReads.set(array, { name, object: o });
    return { type: this.value(array), what: `'Object.${name}'` };
  }

  // The fields `Object.keys`, `values` or `entries` reads from o, and the array it gives. An
  // instance gives its public fields, bases' first, in declaration order; an object type has only
  // its sorted order, which printing and JSON use too. Values are typed as the union of the fields'.
  /** @throws {CompileError} */
  private objectRead(this: Mut<this>, name: "keys" | "values" | "entries", o: Expr): { fields: Field[]; type: ArrayType } {
    // The object is read once per field, so it has to be a place reading it again gives.
    const notPlace = () => new CompileError("E0504", `'Object.${name}' reads a variable or a field; store this value in a 'const' first`, o.start, o.end);
    let root: Expr = o;
    while (root.kind === "member" && !root.optional) root = root.object;
    if (root.kind !== "this" && root.kind !== "ident") throw notPlace();
    const probe = this.spanned(renumberExpr(cloneExpr(o), () => nextId(this.ids)), o);
    const t = this.typing.unfolded(this.read(probe));
    if (!this.rooted(probe)) throw notPlace();
    const r = this.recOf(t);
    if (r?.kind === "map") {
      const which = r.set ? "Set" : "Map";
      throw new CompileError("E0504", `'Object.${name}' reads an object's fields, and a ${which} has none; use the ${which}'s own '${name}()'`, o.start, o.end);
    }
    // A parameter typed with an object type gives that type's fields, as TypeScript types them.
    const shape: Type = r?.kind === "param" && r.bound !== undefined && this.recOf(r.bound)?.kind === "object" ? r.bound : t;
    const sr = this.recOf(shape);
    if (sr === undefined || !((sr.kind === "object" && !this.typing.isTuple(shape)) || sr.kind === "class")) throw new CompileError("E0504", `'Object.${name}' reads the fields of an object or a class instance, not '${this.typing.show(t)}'`, o.start, o.end);
    const fields = (sr.kind === "class" ? this.typing.allFields(shape as ClassType) : (sr as { fields: Field[] }).fields).filter((f) => (f.access ?? "public") === "public");
    if (name !== "keys" && fields.length === 0) throw new CompileError("E0504", `'${this.typing.show(t)}' has no fields, so 'Object.${name}' would give an array of nothing`, o.start, o.end);
    const held = this.typing.unionType(fields.map((f) => this.typing.widenLet(f.type)));
    return { fields, type: this.typing.arrayType(name === "keys" ? "string" : name === "values" ? held : this.typing.tupleType(["string", held])) };
  }

  // `n` as the `i64` an array's length is made from, checked to be an i64 or a usize, and with
  // `panics` a negative one ending the program at n.
  private arrayLength(this: Mut<this>, n: Expr, panics: boolean): Expr {
    const checked: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: "fill length", start: n.start, end: n.end }, args: [n], typeArgs: [], optional: false, start: n.start, end: n.end };
    if (panics) this.lengthChecks.add(checked);
    return checked;
  }

  // A method calling a callback converts each value it passes to the parameter's type, so a
  // literal may widen, except a reference or, with `converted` false, an index, which it passes
  // as it is. The argument always comes, so the parameter can't be optional.
  /** @throws {CompileError} */
  private passedExactly(name: string, given: Type, written: Type, p: Param | undefined, at: Span, converted = true) {
    if (p && (p.optional || this.defaulted.has(p)) && !this.typing.sameLowered(given, written)) throw new CompileError("E0506", `'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    if (this.typing.sameLowered(given, written) || (converted && !this.isRefType(given) && this.typing.fits(given, written))) return;
    if (p && (p.optional || this.defaulted.has(p))) throw new CompileError("E0506", `'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    // A declared function given by name takes its own value, which a lent element isn't.
    const named = p && this.namedParams.get(p);
    if (named && this.isRefType(given) && this.typing.sameLowered(this.typing.rec(given).to, written)) {
      const { fn, names, clones } = named;
      const arrow = `(${names.join(", ")}) => ${fn}(${names.map((n, i) => (clones[i] ? `${n}.clone()` : n)).join(", ")})`;
      throw new CompileError("E0506", `'${name}' lends its callback ${article(this.typing.show(given))}, and '${fn}' takes its own '${this.typing.show(written)}'; write '${arrow}', or have '${fn}' take a '${this.typing.show(given)}'`, at.start, at.end);
    }
    throw new CompileError("E0506", `'${name}' passes its callback ${article(this.typing.show(given))} here, not ${article(this.typing.show(written))}`, at.start, at.end);
  }

  // The element type of a spread, `...x`. An array spreads its elements, cloned unless it was made
  // for the spread; a string, a generator, a Map or a Set is first made into the array
  // `Array.from` would make of it.
  /** @throws {CompileError} */
  private spreadElements(this: Mut<this>, x: Extract<Expr, { kind: "spread" }>): Type {
    const source = x.value;
    const t = this.value(source);
    const held = this.typing.lower(this.isRefType(t) ? this.typing.rec(t).to : t);
    const at = { start: source.start, end: source.end };
    const made = (callee: Expr, args: Expr[] = []): Expr => ({ id: nextId(this.ids), kind: "call", callee, args, typeArgs: [], optional: false, ...at });
    let from: Expr | undefined;
    if (this.dictOf(held)) throw this.notIterable(source);
    if (this.typing.iterableElement(held) !== undefined) throw unsupported("spreads of an 'Iterable' parameter", source);
    const inner = this.embeddedIterated(source, held);
    if (inner) return this.spreadElements(this.rewrites.replace(x, { ...x, value: inner }) as typeof x);
    if (stringLike(this.typing, held)) from = made({ id: nextId(this.ids), kind: "ident", name: "array chars", ...at }, [source]);
    else if (this.typing.yieldsOf(held) !== undefined) from = made({ id: nextId(this.ids), kind: "ident", name: "array collect", ...at }, [source]);
    else if (this.iteratorCall(source, held)) from = made({ id: nextId(this.ids), kind: "ident", name: "array collect", ...at }, [this.iteratorCall(source, held)!]);
    else if (this.recOf(held)?.kind === "map") from = made({ id: nextId(this.ids), kind: "member", object: source, name: this.typing.rec(held as MapType).set ? "values" : "entries", optional: false, ...at });
    else if (!this.isArray(held)) throw new CompileError("E0119", `'...' spreads an array, a string, a generator, a Map, a Set or an iterable class, not '${this.typing.show(t)}'`, source.start, source.end);
    if (from) {
      this.ctx.exprsState.once.add(source);
      x = this.rewrites.replace(x, { ...x, value: from }) as typeof x;
    }
    const array = from ? this.value(from) : t;
    const lowered = this.typing.lowerKeepingBrands(this.isRefType(array) ? this.typing.rec(array).to : array) as ArrayType;
    if (this.isRefType(array)) this.coercions.set(x.value, lowered);
    this.clonable(this.typing.rec(lowered).element, x, "a spread");
    // Codegen converts each element from this type.
    this.types.set(x, this.typing.rec(lowered).element);
    return this.typing.rec(lowered).element;
  }

  // A call's arguments after the fixed parameters fill its rest parameter, as one array literal,
  // where a spread argument spreads as in any literal. Packed once, as a generic body is
  // checked again for each instance.
  /** @throws {CompileError} */
  private packRest<T extends Extract<Expr, { kind: "call" | "new" }>>(this: Mut<this>, e: T, list: Expr[], params: Param[]): T {
    if (this.packed.has(e)) return e;
    const fixed = params.length - 1;
    this.refuseSpread(list.slice(0, fixed));
    if (list.length < fixed) return e;
    const rest = list.slice(fixed);
    const at = rest.length > 0 ? { start: rest[0]!.start, end: rest.at(-1)!.end } : { start: e.end - 1, end: e.end - 1 };
    const made = this.rewrites.replace(e, { ...e, args: [...list.slice(0, fixed), { id: nextId(this.ids), kind: "array", elements: rest, ...at }] }) as T;
    this.packed.add(made);
    return made;
  }

  // `f(...t)` over a tuple named by a variable passes its elements, as `f(t[0], t[1])` would,
  // a rest tuple's array spreading after them. Each element reads the variable again, so a
  // tuple made for the call has to be named first.
  /** @throws {CompileError} */
  private spreadTuples<T extends Extract<Expr, { kind: "call" | "new" }>>(this: Mut<this>, e: T): T {
    const args = e.args ?? [];
    const tuples = args.map((a) => (a.kind === "spread" ? this.spreadTuple(a.value) : undefined));
    if (tuples.every((t) => t === undefined)) return e;
    const parts = args.flatMap((a, i): Expr[] => {
      const t = tuples[i];
      if (t === undefined || a.kind !== "spread") return [a];
      const source = this.rewrites.current(a.value) as Extract<Expr, { kind: "ident" }>;
      const at = { start: a.start, end: a.end };
      const element = (name: string): Expr => ({ id: nextId(this.ids), kind: "member", object: { ...source, id: nextId(this.ids) }, name, optional: false, ...at });
      const fixed = this.typing.elementsOf(t).map((_, n) => element(String(n)));
      return this.typing.rec(t).rest === undefined ? fixed : [...fixed, { id: nextId(this.ids), kind: "spread", value: element("..."), ...at }];
    });
    return this.rewrites.replace(e, { ...e, args: parts }) as T;
  }

  // The tuple a spread argument's variable holds, if it holds one.
  /** @throws {CompileError} */
  private spreadTuple(this: Mut<this>, source: Expr): ObjectType | undefined {
    source = this.rewrites.current(source);
    if (source.kind !== "ident") return undefined;
    const t = this.value(source);
    this.ctx.exprsState.once.add(source);
    const held = this.typing.lower(this.isRefType(t) ? this.typing.rec(t).to : t);
    return this.typing.isTuple(held) && !this.typing.rec(held as ObjectType).match ? (held as ObjectType) : undefined;
  }

  // A spread argument fills only a rest parameter, since an array's length isn't known while compiling.
  /** @throws {CompileError} */
  private refuseSpread(this: Mut<this>, list: Expr[]) {
    const spread = list.find((a) => a.kind === "spread");
    if (spread?.kind !== "spread") return;
    // A tuple reached any other way than by a variable would be read again for each element.
    const t = this.value(spread.value);
    const held = this.typing.lower(this.isRefType(t) ? this.typing.rec(t).to : t);
    if (this.typing.isTuple(held)) throw new CompileError("E0408", "a tuple spreads into parameters from a variable, since each element reads it again; name it first, as in 'const t = pair(); f(...t)'", spread.start, spread.end);
    throw new CompileError("E0408", "a spread argument fills only a rest parameter, as in 'function f(...xs: T[])', since an array's length isn't known while compiling; a tuple spreads into parameters from a variable, as in 'const t = pair(); f(...t)'", spread.start, spread.end);
  }

  // A closure that moves a capture out of itself can run only once, which a method calling it
  // again and again can't allow.
  /** @throws {CompileError} */
  private runsOften(c: ClosureType, name: string, calls: string, at: Span) {
    if (this.typing.rec(c).once) throw new CompileError("E0210", `'${name}' calls ${calls}, but this closure moves '${this.typing.rec(c).once}' out, so it can run only once; clone it inside instead`, at.start, at.end);
  }

  // `includes` and `indexOf` compare elements by value, as `===` does; `join` writes each as
  // `String(x)` would; `slice` gives clones of a range, its positions as JavaScript reads them.
  /** @throws {CompileError} */
  private readingCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (name === "concat") {
      // Each array given is read, as this one is, and its elements cloned.
      for (const a of e.args) {
        this.expect(a, array);
        const t = this.value(a);
        const given = this.isRefType(t) ? this.typing.rec(t).to : t;
        // A literal, `[]` and `[2]` among them, takes the element type as an annotated one does.
        if (!(a.kind === "array" && this.literalArray(a, t, array)) && !this.typing.fits(given, array)) throw new CompileError("E0504", `'concat' joins arrays of the same element type, '${this.typing.show(array)}', not '${this.typing.show(t)}'; to add single values, push them`, a.start, a.end);
        this.coercions.set(a, this.typing.refType(array, false));
      }
      return { type: array, what: "'concat'" };
    }
    if (name === "flat") {
      if (e.args.length > 0) throw new CompileError("E0504", "'flat' flattens one level so far, so it takes no depth", e.args[0]!.start, e.args[0]!.end);
      const inner = this.typing.lower(this.typing.rec(array).element);
      if (typeof inner === "string" || this.typing.rec(inner).kind !== "array") throw new CompileError("E0504", `'flat' flattens an array of arrays, not '${this.typing.show(array)}'`, callee.start, callee.end);
      return { type: inner, what: "'flat'" };
    }
    const [most, takes] = name === "includes" || name === "indexOf" || name === "lastIndexOf" ? [2, "a value to look for and an optional position to start from"] : name === "join" ? [1, "an optional separator"] : [2, "an optional start and end"];
    const least = name === "includes" || name === "indexOf" || name === "lastIndexOf" ? 1 : 0;
    if (e.args.length < least || e.args.length > most) throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    const argument = (a: Expr, want: Type) => {
      this.expect(a, want);
      const t = this.value(a);
      this.coerce(a, t, want, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(want)}'`);
    };
    if (name === "join") {
      // Literals, and unions of them, are written as their values.
      const writable = (t: Type): boolean => {
        const r = this.recOf(t);
        return isNumeric(t) || t === "boolean" || t === "string" || r?.kind === "literal" || (r?.kind === "union" && r.members.every(writable));
      };
      if (!writable(this.typing.lower(this.typing.rec(array).element))) {
        throw new CompileError("E0504", `'join' writes each element as 'String(x)' does, which works for numbers, booleans and strings, not '${this.typing.show(this.typing.rec(array).element)}'`, callee.start, callee.end);
      }
      if (e.args[0]) argument(e.args[0], "string");
      return { type: "string", what: "'join'" };
    }
    if (name === "slice") {
      for (const a of e.args) argument(a, "i64");
      return { type: array, what: "'slice'" };
    }
    const [sought, from] = e.args as [Expr, Expr | undefined];
    this.expect(sought, this.typing.rec(array).element);
    const t = this.value(sought);
    if (objectsMeet(this.typing, this.typing.rec(array).element, t)) throw new CompileError("E0112", `'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    // A value that fits the element type, a literal of a sized number too, is one.
    if (this.typing.fits(t, this.typing.rec(array).element) || (isNumeric(this.typing.widenLet(t)) && isNumeric(this.typing.rec(array).element) && isFloat(this.typing.widenLet(t)) === isFloat(this.typing.rec(array).element))) {
      if (from) argument(from, "i64");
      this.coerce(sought, t, this.typing.rec(array).element, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(this.typing.rec(array).element)}'`);
      return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
    }
    if (objectsMeet(this.typing, this.typing.rec(array).element, t)) throw new CompileError("E0112", `'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    if (!comparable(this.typing, this.typing.rec(array).element, t)) throw new CompileError("E0112", `'${name}' can never find a '${this.typing.show(this.typing.widenLet(t))}' among elements of type '${this.typing.show(this.typing.rec(array).element)}'`, sought.start, sought.end);
    if (from) argument(from, "i64");
    return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
  }

  // A raw pointer's methods, all inside `unsafe`: reading and writing what it points at, which
  // must be a plain value a raw write can't leave dangling, moving along by elements, and
  // telling whether it points anywhere.
  /** @throws {CompileError} */
  private pointerCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, p: PointerType): { type: Type; what: string } {
    const counts: Record<string, usize> = { read: 0, write: 1, offset: 1, isNull: 0 };
    if (!(callee.name in counts)) throw new CompileError("E1006", `raw pointers have no method '${callee.name}'; they have 'read', 'write', 'offset' and 'isNull'`, callee.start, callee.end);
    this.needsUnsafe(`'${callee.name}' on a raw pointer`, callee);
    if (this.linked(callee)) throw unsupported("optional chains calling raw pointer methods", callee);
    const held = this.types.get(callee.object)!;
    if (this.isRefType(held)) this.coercions.set(callee.object, p);
    if (e.args.length !== counts[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${counts[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const { to } = this.typing.rec(p);
    const plain = isNumeric(to) || to === "boolean" || this.recOf(to)?.kind === "pointer";
    if ((callee.name === "read" || callee.name === "write") && !plain) throw unsupported(`raw reads and writes of '${this.typing.show(to)}'`, callee);
    if (callee.name === "read") return { type: to, what: "'read'" };
    if (callee.name === "isNull") return { type: "boolean", what: "'isNull'" };
    const a = e.args[0]!;
    const want = callee.name === "write" ? to : "i64";
    if (callee.name === "write" && !this.typing.rec(p).mutable) throw new CompileError("E1006", "'write' needs a 'MutPtr'; a 'Ptr' only reads what it points at", callee.start, callee.end);
    this.expect(a, want);
    const t = this.value(a);
    this.coerce(a, t, want, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(want)}'`);
    return { type: callee.name === "write" ? "void" : p, what: `'${callee.name}'` };
  }

  // `new Atomic(v)`, `new Lock(v)`, `new Cell(v)`: one holding v, of its type argument, the type
  // expected of it, or else v's own type.
  /** @throws {CompileError} */
  private interiorNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, which: InteriorRecord["which"], list: Expr[]): Type {
    if (list.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", `'${which}' takes the value it starts with, as in 'new ${which}(0)'`, e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const given = e.typeArgs[0] ? this.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : r?.kind === "interior" && r.which === which ? r.of : undefined;
    if (given) this.expect(list[0]!, given);
    const t = this.value(list[0]!);
    const of = given ?? this.typing.heldArgument(this.typing.widenLet(t));
    this.coerce(list[0]!, t, of, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    return interior(this.typing, which, of, e);
  }

  // `new Rc(v)`: v moved into a new block with one count. `new Weak<T>()` reaches no value, so it
  // never upgrades, for a back-reference made before what it points to.
  /** @throws {CompileError} */
  private countedNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, which: "Rc" | "Weak", list: Expr[]): Type {
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const given = e.typeArgs[0] ? this.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : r?.kind === "shared" && r.which === which ? r.of : undefined;
    if (which === "Weak") {
      if (list.length !== 0 || e.typeArgs.length > 1 || given === undefined) throw new CompileError("E0504", "'new Weak<T>()' takes no value and reaches none; make a Weak that reaches one with 'rc.downgrade()'", e.start, e.end);
      return counted(this.typing, given, which, e);
    }
    if (list.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", "'Rc' takes the value it starts with, as in 'new Rc(node)'", e.start, e.end);
    if (given) this.expect(list[0]!, given);
    const t = this.value(list[0]!);
    const of = given ?? this.typing.heldArgument(this.typing.widenLet(t));
    this.coerce(list[0]!, t, of, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    return counted(this.typing, of, which, e);
  }

  // An Atomic's methods, JavaScript's `Atomics` on one value: each changes it in one step, seen
  // the same by every thread, and gives what it held before, except `store`.
  /** @throws {CompileError} */
  private interiorCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType): { type: Type; what: string } {
    this.where(callee, t);
    if (this.typing.rec(t).which === "Cell") return this.cellCall(e, callee, t);
    if (this.typing.rec(t).which === "Lock" || this.typing.rec(t).which === "RwLock") return this.lockCall(e, callee, t);
    if (this.typing.rec(t).which !== "Atomic") throw new CompileError("E0502", `'${this.typing.rec(t).which}' has no method '${callee.name}'`, callee.start, callee.end);
    const takes: Record<string, usize> = { load: 0, store: 1, add: 1, sub: 1, exchange: 1, compareExchange: 2 };
    if (!(callee.name in takes)) throw new CompileError("E0502", `'Atomic' has no method '${callee.name}'; it has 'load', 'store', 'add', 'sub', 'exchange' and 'compareExchange'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Atomic' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : `${takes[callee.name]} arguments`}`, e.start, e.end);
    const of = this.typing.lowerKeepingBrands(this.typing.rec(t).of);
    if ((callee.name === "add" || callee.name === "sub") && !isInteger(of)) throw new CompileError("E0504", `'${callee.name}' needs an integer 'Atomic', not '${this.typing.show(t)}'`, callee.start, callee.end);
    for (const a of e.args) {
      this.expect(a, of);
      const given = this.value(a);
      this.coerce(a, given, of, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    }
    return { type: callee.name === "store" ? "void" : of, what: `'${callee.name}'` };
  }

  // An Atomic's, Cell's or Lock's method changes it where it lives, so it is called on a place,
  // a reference, or a value just made; anything else would change a copy.
  /** @throws {CompileError} */
  private where(callee: Extract<Expr, { kind: "member" }>, t: InteriorType) {
    const inPlace = (written: Expr): boolean => {
      const e = this.rewrites.current(written);
      const type = this.types.get(e);
      if (this.recOf(type)?.kind === "ref") return true;
      if (e.kind === "ident" || e.kind === "this" || e.kind === "call" || e.kind === "new") return true;
      if (e.kind === "member") {
        // A field shared by a union's members is read from a copy of the union.
        const holder = this.recOf(this.types.get(e.object));
        const held = holder?.kind === "ref" ? this.recOf(holder.to) : holder;
        const inside = held?.kind === "object" || held?.kind === "class" || held?.kind === "shared";
        return inside && !this.calls.has(e) && !this.ctx.copiesOut.has(e) && inPlace(e.object);
      }
      return this.element(e) && inPlace(e.object);
    };
    if (inPlace(callee.object)) return;
    const hint = this.bare(callee.object).kind === "nonNull" ? "; narrow the Option with a check like 'if (x !== null)' instead of '!'" : "; narrow a union to one member first";
    throw new CompileError("E0212", `'${callee.name}' works on the '${this.typing.rec(t).which}' where it lives, so call it on a variable or a field${hint}`, callee.start, callee.end);
  }

  // A Cell's methods, Rust's: `get` copies out what it holds, `set` puts a value in, dropping
  // the old one, and `replace` puts one in and gives the old one back.
  /** @throws {CompileError} */
  private cellCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType): { type: Type; what: string } {
    const takes: Record<string, usize> = { get: 0, set: 1, replace: 1 };
    if (!(callee.name in takes)) throw new CompileError("E0502", `'Cell' has no method '${callee.name}'; it has 'get', 'set' and 'replace'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Cell' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError("E0504", `'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const of = this.typing.lowerKeepingBrands(this.typing.rec(t).of);
    if (callee.name === "get" && !this.typing.isCopy(of)) throw new CompileError("E0504", `'get' copies what a Cell holds, which a '${this.typing.show(of)}' can't be; use 'replace' to take it out and put another in`, callee.start, callee.end);
    for (const a of e.args) {
      this.expect(a, of);
      const given = this.value(a);
      this.coerce(a, given, of, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    }
    return { type: callee.name === "set" ? "void" : of, what: `'${callee.name}'` };
  }

  // `new Semaphore(n)` with n slots, and `new Channel<T>(capacity)`, of its type argument or the
  // type expected of it.
  /** @throws {CompileError} */
  private blockNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, which: "Semaphore" | "Channel", list: Expr[]): Type {
    const what = which === "Semaphore" ? "the number of slots it hands out, as in 'new Semaphore(4)'" : "how many values it holds before 'send' waits, as in 'new Channel<string>(8)'";
    if (list.length !== 1 || e.typeArgs.length > (which === "Channel" ? 1 : 0)) throw new CompileError("E0504", `'${which}' takes ${what}`, e.start, e.end);
    this.expect(list[0]!, "i64");
    const t = this.value(list[0]!);
    this.coerce(list[0]!, t, "i64", `argument of type '${this.typing.show(t)}' is not assignable to parameter of type 'i64'`);
    if (which === "Semaphore") return this.typing.blockType("Semaphore");
    const expected = this.ctx.exprsState.wanted.get(e);
    const r = this.recOf(expected);
    const of = e.typeArgs[0] ? this.ctx.resolveType(e.typeArgs[0]) : r?.kind === "block" && r.which === "Channel" ? r.of : undefined;
    if (!of) throw new CompileError("E0104", "'Channel' needs the type it carries, as in 'new Channel<string>(8)'", e.start, e.end);
    return channel(this.typing, of, e);
  }

  // Whether a place is read through a Dyn, or a runtime-computed property, anywhere along its
  // path: such a read gives a copy, which a change would be lost in.
  private readCopy(e: Expr): boolean {
    e = this.rewrites.current(e);
    for (let at = e; ; ) {
      if (this.computed.has(at)) return true;
      if (at.kind === "member" || at.kind === "index") at = at.object;
      else if (at.kind === "nonNull") at = at.expr;
      else return false;
    }
  }

  // A Map's and a Set's methods. Those changing it need it in a place that may change, or a
  // `Mut` borrow of it, which `set` and `add` give for chaining. What they give out are clones.
  /** @throws {CompileError} */
  private mapCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: MapType): { type: Type; what: string } {
    const name = callee.name;
    const kind = this.typing.rec(t).set ? "Set" : "Map";
    if (!(this.typing.rec(t).set ? SET_METHODS : MAP_METHODS).has(name)) throw new CompileError("E0502", `'${kind}' has no method '${name}' yet${didYouMean(name, this.typing.rec(t).set ? SET_METHODS : MAP_METHODS)}`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported(`optional chains calling '${kind}' methods`, callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    const count = MAP_ARGUMENTS[name]!;
    if (e.args.length !== count) throw new CompileError("E0504", `'${name}' takes ${count === 0 ? "no arguments" : count === 1 ? "1 argument" : `${count} arguments`}`, e.start, e.end);
    const held = this.types.get(callee.object)!;
    if (this.isRefType(held)) this.coercions.set(callee.object, t);
    if (MAP_CHANGES.has(name)) {
      if (this.readCopy(callee.object)) throw new CompileError("E0211", `'${name}' changes its ${kind}, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
      // A class extending Map or Set lends its collection where it is lent.
      const holder = callee.object.kind === "member" && callee.object.name === EMBEDDED ? this.types.get(callee.object.object) : undefined;
      const lent = (this.isRefType(held) && this.typing.rec(held).mutable) || (holder !== undefined && this.isRefType(holder) && this.typing.rec(holder).mutable);
      if (!this.place(callee.object) && !lent) throw new CompileError("E0212", `'${name}' changes its ${kind}, so call it on a variable or a field`, callee.start, callee.end);
      if (!lent) this.changeable(callee.object, name === "clear" ? "clear" : name === "delete" ? "delete from" : name === "update" ? "update" : "add to");
    }
    const argument = (x: Expr, to: Type) => {
      this.expect(x, to);
      const got = this.value(x);
      this.coerce(x, got, to, `argument of type '${this.typing.show(got)}' is not assignable to parameter of type '${this.typing.show(to)}'`);
    };
    if (count > 0 && name !== "forEach") argument(e.args[0]!, this.typing.rec(t).key);
    switch (name) {
      case "set":
      case "add":
        if (name === "set") argument(e.args[1]!, this.typing.rec(t).value);
        this.borrowsFrom.set(e, [callee.object]);
        return { type: this.typing.refType(t, true), what: `'${name}'` };
      case "get":
        this.clonable(this.typing.rec(t).value, callee, undefined, true);
        return { type: this.typing.unionType([this.typing.rec(t).value, "null"]), what: "'get'" };
      case "has":
      case "delete":
        return { type: "boolean", what: `'${name}'` };
      case "clear":
        return { type: "void", what: "'clear'" };
      case "keys":
        return { type: this.typing.arrayType(this.typing.rec(t).key), what: "'keys'" };
      case "values":
        if (this.typing.rec(t).set) return { type: this.typing.arrayType(this.typing.rec(t).key), what: "'values'" };
        this.clonable(this.typing.rec(t).value, callee, undefined, true);
        return { type: this.typing.arrayType(this.typing.rec(t).value), what: "'values'" };
      case "entries":
        this.clonable(this.typing.rec(t).value, callee, undefined, true);
        return { type: this.typing.arrayType(this.typing.tupleType(this.typing.rec(t).set ? [this.typing.rec(t).key, this.typing.rec(t).key] : [this.typing.rec(t).key, this.typing.rec(t).value])), what: "'entries'" };
    }
    // `update(k, f)` and `forEach(f)` call an arrow written in place: `update`'s gets the value
    // to change, once, and `forEach`'s each value and its key in turn, borrowed or copied.
    const callback = e.args[name === "update" ? 1 : 0]!;
    this.namedFunction(callback);
    if (callback.kind !== "arrow") throw new CompileError("E0506", `'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const lend = (u: Type) => (this.typing.isCopy(u) ? u : this.typing.refType(u, false));
    // A Set's forEach passes each member twice, as JavaScript's does.
    const { key, value: entry, set } = this.typing.rec(t);
    const params = name === "update" ? [this.typing.refType(entry, true)] : set ? [lend(key), lend(key)] : [lend(entry), lend(key)];
    const passes = name === "update" ? "the value to change" : set ? "each member" : "each value and its key";
    const signature = this.typing.functionType(params.map((_, i) => (i === 0 ? "value" : "key")), params, "void");
    this.typing.openThrows.add(signature);
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
  private mapNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, set: boolean, list: Expr[]): Type {
    const name = set ? "Set" : "Map";
    const shape = set ? "an array of members, as in 'new Set([\"a\", \"b\"])'" : "an array of key and value pairs, as in 'new Map([[\"a\", 1]])'";
    if (list.length > 1) throw new CompileError("E0504", `'new ${name}' takes ${shape}, or nothing`, e.start, e.end);
    if (e.typeArgs.length > 0 && e.typeArgs.length !== (set ? 1 : 2)) throw new CompileError("E0116", set ? "'Set' takes the type of its members, like 'new Set<string>()'" : "'Map' takes its key and value types, like 'new Map<string, i64>()'", e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const made = e.typeArgs.length > 0 ? collection(this.typing, this.ctx.resolveType(e.typeArgs[0]!), set ? "void" : this.ctx.resolveType(e.typeArgs[1]!), set, e)
      : this.recOf(expected)?.kind === "map" && this.typing.rec(expected as MapType).set === set ? expected as MapType : undefined;
    // The entries or members are moved in from an array, which gives the types when nothing else does.
    const from = list[0];
    const entries = made && (set ? this.typing.rec(made).key : this.typing.tupleType([this.typing.rec(made).key, this.typing.rec(made).value]));
    if (from) {
      if (entries) this.expect(from, this.typing.arrayType(entries));
      else if (!set && from.kind === "array") for (const x of from.elements) if (x?.kind === "array" && x.elements.length === 2) this.pairs.add(x);
      const t = this.value(from);
      if (made && entries) {
        const wants = this.typing.arrayType(entries);
        this.coerce(from, t, wants, `'new ${name}' takes ${shape}, not '${this.typing.show(t)}'`);
        return made;
      }
      const element = this.isArray(t) ? this.typing.lower(this.typing.rec(t).element) : undefined;
      const tuple = element !== undefined && this.typing.isTuple(element) ? this.typing.rec(element as ObjectType) : undefined;
      const pair = tuple && tuple.fields.length === 2 && tuple.rest === undefined && tuple.required === undefined ? this.typing.elementsOf(element as ObjectType) : undefined;
      if (element === undefined || (!set && !pair)) throw new CompileError("E0504", `'new ${name}' takes ${shape}, not '${this.typing.show(t)}'`, from.start, from.end);
      // Each closure is its own type, so which callable type the values share must be written.
      const v = set ? undefined : this.typing.lower(pair![1]!);
      const fn = this.recOf(v);
      if (fn?.kind === "closure") throw new CompileError("E0104", `a 'Map' of functions needs its types written, as in 'new Map<${this.typing.show(this.typing.widenLet(pair![0]!))}, ${fn.name}>(...)'`, e.start, e.end);
      const result = collection(this.typing, this.typing.widenLet(set ? element : pair![0]!), set ? "void" : this.typing.widenLet(pair![1]!), set, e);
      const wants = this.typing.arrayType(set ? this.typing.rec(result).key : this.typing.tupleType([this.typing.rec(result).key, this.typing.rec(result).value]));
      this.coerce(from, t, wants, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(wants)}'`);
      return result;
    }
    if (made) return made;
    throw new CompileError("E0104", set ? "'new Set()' needs the type of its members, as in 'new Set<string>()'" : "'new Map()' needs its key and value types, as in 'new Map<string, i64>()'", e.start, e.end);
  }

  // `handle.join()`: the task's handle, awaited as giving its value or throwing a TaskPanic.
  /** @throws {CompileError} */
  private handleCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: HandleType): { type: Type; what: string } {
    if (callee.name !== "join") throw new CompileError("E0305", `'${this.typing.show(t)}' has no method '${callee.name}'; ${this.typing.rec(t).joined ? "await it" : "it has 'join', and awaiting it gives what the task gave"}`, callee.start, callee.end);
    if (this.typing.rec(t).joined) throw new CompileError("E0305", "this is already the task's 'join()'; await it", callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'join'", callee);
    if (e.args.length !== 0) throw new CompileError("E0305", "'join' takes no arguments", e.start, e.end);
    if (this.isRefType(this.types.get(callee.object)!)) throw new CompileError("E0305", "'join' takes the handle over, so it needs the handle itself, not a borrow of it", callee.object.start, callee.object.end);
    this.joinCalls.add(e);
    return { type: this.typing.joinedType(t, this.arenas.classOf(this.classes.get("TaskPanic")!).type), what: "'join'" };
  }

  // A Semaphore's `acquire()` and `available()`, and a Channel's `send(v)`, `receive()` and
  // `close()`. A Permit has no methods: dropping it gives its slot back.
  /** @throws {CompileError} */
  private blockCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: BlockType): { type: Type; what: string } {
    const which = this.typing.rec(t).which;
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
      throw new CompileError("E0502", `'${this.typing.show(t)}' has no method '${callee.name}'; ${has}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported(`optional chains calling '${this.typing.rec(t).which}' methods`, callee);
    const signalled = waits && e.args.length === methods[callee.name]! + 1;
    if (e.args.length !== methods[callee.name] && !signalled) throw new CompileError("E0504", `'${callee.name}' takes ${methods[callee.name] === 1 ? "1 argument" : "no arguments"}${waits ? ", and may take an AbortSignal" : ""}`, e.start, e.end);
    if (signalled) this.signalArgument(e.args.at(-1)!, `'${callee.name}'`);
    // The std's own non-waiting send, which a promise's resolve and reject make.
    if (callee.name === "send" || callee.name === "settle") {
      const of = this.typing.lowerKeepingBrands(this.typing.rec(t).of);
      this.expect(e.args[0]!, of);
      const given = this.value(e.args[0]!);
      this.coerce(e.args[0]!, given, of, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    }
    if (callee.name === "available") return { type: "i64", what: "'available'" };
    // std's own TLS setup, `startTls(serverName, ca)` on a stream and `listenTls(cert, key)` on a
    // listener, giving why it failed, or an empty string.
    if (callee.name === "startTls" || callee.name === "listenTls") {
      for (const arg of e.args) {
        this.expect(arg, "string");
        const given = this.value(arg);
        this.coerce(arg, given, "string", `'${callee.name}' takes strings, not '${this.typing.show(given)}'`);
      }
      return { type: "string", what: `'${callee.name}'` };
    }
    if (callee.name === "accept") return { type: this.typing.leafFuture("accept", this.typing.rec(t).which === "UnixListener" ? this.typing.blockType("UnixStream") : "void", this.socketError(signalled), signalled), what: "'accept'" };
    // `read(max)` gives at most max bytes, and `write(bytes)` takes its bytes to send them all.
    if (callee.name === "read" || callee.name === "write") {
      const want = callee.name === "read" ? "i64" : this.typing.arrayType("u8");
      this.expect(e.args[0]!, want);
      const given = this.value(e.args[0]!);
      this.coerce(e.args[0]!, given, want, callee.name === "read" ? `'read' takes the most bytes to read as an 'i64', not '${this.typing.show(given)}'` : `'write' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '${this.typing.show(given)}'`);
      return { type: this.typing.leafFuture(callee.name, "void", this.socketError(signalled), signalled), what: `'${callee.name}'` };
    }
    if (callee.name === "abort") return { type: "void", what: "'abort'" };
    if (callee.name === "throwIfAborted") {
      this.ctx.raise(e, this.abortError(), "'throwIfAborted'");
      return { type: "void", what: "'throwIfAborted'" };
    }
    if (callee.name === "close" || callee.name === "settle") return { type: "void", what: `'${callee.name}'` };
    return { type: this.typing.leafFuture(callee.name as "acquire" | "send" | "receive", this.typing.lowerKeepingBrands(this.typing.rec(t).of), signalled ? this.abortError() : undefined, signalled), what: `'${callee.name}'` };
  }

  // A UdpSocket's `sendTo(bytes, host, port)`, `receiveFrom()`, `connect(host, port)`, `send(bytes)`
  // and `receive()`. Each but connect, which never waits, may take an AbortSignal last.
  /** @throws {CompileError} */
  private udpCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
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
    if (sends) take(e.args[0]!, this.typing.arrayType("u8"), (given) => `${what} takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '${this.typing.show(given)}'`);
    if (callee.name === "sendTo" || callee.name === "connect") {
      const [host, port] = callee.name === "sendTo" ? [e.args[1]!, e.args[2]!] : [e.args[0]!, e.args[1]!];
      take(host, "string", (given) => `the host is a 'string' like "127.0.0.1", not '${this.typing.show(given)}'`);
      take(port, "i64", (given) => `the port is an 'i64', not '${this.typing.show(given)}'`);
    }
    const method = sends ? "sendTo" : callee.name === "connect" ? "udpConnect" : "receiveFrom";
    return { type: this.typing.leafFuture(method, callee.name === "receive" ? this.typing.arrayType("u8") : "void", this.socketError(signalled), signalled), what };
  }

  // `AbortSignal.timeout(ms)`: a new signal that aborts itself after ms milliseconds. And
  // `AbortSignal.any(signals)`: one that aborts with the first of them, each lent to it.
  /** @throws {CompileError} */
  private signalStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name === "any") return this.signalAny(e);
    if (callee.name !== "timeout") throw new CompileError("E0502", `'AbortSignal' has no static method '${callee.name}'; it has 'timeout' and 'any'`, callee.start, callee.end);
    // The std library's own code is compiled whatever main is; a sync main never reaches it.
    if (!this.ctx.runtime && e.start < STD_BASE) throw new CompileError("E0301", "'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("E0504", "'AbortSignal.timeout' takes how many milliseconds until it aborts, like 'AbortSignal.timeout(5000)'", e.start, e.end);
    this.expect(e.args[0]!, "i64");
    const t = this.value(e.args[0]!);
    this.coerce(e.args[0]!, t, "i64", `'AbortSignal.timeout' takes milliseconds as an 'i64', not '${this.typing.show(t)}'`);
    return { type: this.typing.blockType("AbortSignal"), what: "'AbortSignal.timeout'" };
  }

  // A literal list lends each signal, as a wait's is, so 'req.signal' stays the request's.
  /** @throws {CompileError} */
  private signalAny(this: Mut<this>, e: Call): { type: Type; what: string } {
    const example = "like 'AbortSignal.any([a, b])'";
    if (e.args.length !== 1) throw new CompileError("E0504", `'AbortSignal.any' takes one list of signals, ${example}`, e.start, e.end);
    const list = e.args[0]!;
    const signal = this.typing.blockType("AbortSignal");
    if (list.kind === "array") {
      for (const x of list.elements) {
        if (!x || x.kind === "spread") throw new CompileError("E0504", `'AbortSignal.any' takes its signals listed one by one, ${example}`, (x ?? list).start, (x ?? list).end);
        this.signalArgument(x, "'AbortSignal.any'");
      }
    } else {
      const given = this.value(list);
      this.coerce(list, given, this.typing.refType(this.typing.arrayType(signal), false), `'AbortSignal.any' takes a list of 'AbortSignal's, not '${this.typing.show(given)}'`);
    }
    return { type: signal, what: "'AbortSignal.any'" };
  }

  // `TcpListener.bind(host, port)` and `TcpStream.connect(host, port)`, and the Unix ones taking a
  // socket path: futures the async runtime's reactor completes, throwing an `IoError` when the
  // system says no. std's own `TcpListener.unix(path)` and `TcpStream.unix(path)` give a socket on a
  // path typed as TCP's, so serve and fetch share their HTTP code.
  /** @throws {CompileError} */
  private socketStatic(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, which: "TcpListener" | "TcpStream" | "UnixListener" | "UnixStream" | "UdpSocket"): { type: Type; what: string } {
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
    this.coerce(host, h, "string", unix ? `the socket path is a 'string' like "/tmp/app.sock", not '${this.typing.show(h)}'` : `the host is a 'string' like "127.0.0.1", not '${this.typing.show(h)}'`);
    if (!unix) {
      const port = e.args[1]!;
      this.expect(port, "i64");
      const p = this.value(port);
      this.coerce(port, p, "i64", `the port is an 'i64', not '${this.typing.show(p)}'`);
    }
    return { type: this.typing.leafFuture(method, unix || which === "UdpSocket" ? this.typing.blockType(which) : "void", this.socketError(signalled), signalled), what: name };
  }

  // The std `IoError` class, which failed socket calls throw.
  private ioError(): Type {
    return this.arenas.classOf(this.classes.get("IoError")!).type;
  }

  // What a socket's wait throws: an IoError, or an AbortError too when it was given a signal.
  private socketError(signalled: boolean): Type {
    return signalled ? this.typing.unionType([this.ioError(), this.abortError()]) : this.ioError();
  }

  // A wait's AbortSignal, lent to it: the wait keeps a count on it of its own.
  /** @throws {CompileError} */
  private signalArgument(this: Mut<this>, a: Expr, what: string) {
    const signal = this.typing.blockType("AbortSignal");
    const given = this.value(a);
    this.coerce(a, given, this.typing.refType(signal, false), `${what} takes an 'AbortSignal' to stop waiting early, not '${this.typing.show(given)}'`);
  }

  // `new Promise<T>(executor)`, rewritten as the prelude's cell its executor settles, awaited.
  // T is written or the `Promise<T>` it meets; reject's error is its annotation's, or what the
  // function declares it throws, or `Error`.
  /** @throws {CompileError} */
  private promiseNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, list: Expr[]) {
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
    const declared = executor.kind === "arrow" ? executor : executor.kind === "ident" && !this.ctx.lookup(executor.name) ? this.bodyNamed(executor.name) : undefined;
    const raw = declared === undefined ? this.typing.lower(this.value(executor)) : undefined;
    const held = (raw && this.boundFunction(raw)) ?? raw;
    const r = this.recOf(held);
    const fn = r?.kind === "closure" || r?.kind === "function" ? r : held !== undefined && this.isCallable(held) ? this.recOf(this.typing.callableOf.get(this.typing.rec(held as DynType).of)) : undefined;
    if (declared === undefined && fn === undefined) throw new CompileError("E0305", `'new Promise' takes an executor, a function given 'resolve' and 'reject', ${example}; not '${this.typing.show(held!)}'`, executor.start, executor.end);
    const returned = this.recOf(fn?.returns);
    const async = declared?.async === true || (returned !== undefined && (returned.kind === "future" || this.typing.promiseElement(returned.kind === "dyn" ? returned.of : fn!.returns) !== undefined));
    if (async) throw new CompileError("E0305", "an executor runs at once, so it can't be async; call an async function that awaits and then calls 'resolve' instead", executor.start, executor.end);
    const takes = declared?.params.length ?? fn!.params.length;
    const rejects = takes >= 2;
    if (rejects && stored !== undefined) throw new CompileError("E0305", `a Promise stored as a '${this.typing.show(expected!)}' can't throw yet, so its executor can't take 'reject'; await it where it is made, or resolve it with a value saying it failed`, executor.start, executor.end);
    // Reject's own type, written on the executor's parameter or in its signature.
    const annotated = declared?.params[1]?.type;
    const reason = annotated ? this.ctx.resolveType(annotated) : fn?.params[1];
    const rejecting = this.recOf(reason);
    const signature = rejecting?.kind === "function" ? rejecting : reason !== undefined && this.isCallable(reason) ? this.recOf(this.typing.callableOf.get(this.typing.rec(reason as DynType).of)) : undefined;
    if (reason !== undefined && signature?.params.length !== 1) throw new CompileError("E0305", `'reject' takes the error it fails with, as in 'reject: (reason: Error) => void', not '${this.typing.show(reason)}'`, (annotated ?? executor).start, (annotated ?? executor).end);
    const error = signature?.params[0] ?? this.ctx.throwsDeclared() ?? this.arenas.classOf(this.classes.get("Error")!).type;
    const variant = `${rejects ? "" : " resolve"}${gives === "void" ? " void" : ""}`;
    const typeArgs = [...(gives === "void" ? [] : [this.presetNode(gives, e)]), ...(rejects ? [this.presetNode(error, e)] : [])];
    const at = { start: e.start, end: e.end };
    const cell: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: `promise cell${variant}`, ...at }, typeArgs, args: [executor], optional: false, ...at };
    const awaited = this.rewrites.replace(e, { id: 0, kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: `promise await${variant}`, ...at }, typeArgs, args: [cell], optional: false, ...at });
    if (gives !== "void") {
      const resolves = rejects ? "" : " resolve";
      this.promiseVariants.set(cell, { name: `promise cell${resolves}`, typeArgs });
      this.promiseVariants.set(awaited, { name: `promise await${resolves}`, typeArgs });
    }
    return awaited;
  }

  // The T of a `Promise<T>` a value meets, stored or taken by a parameter.
  private promiseMet(t: Type): Type | undefined {
    const r = this.recOf(t);
    const held = this.recOf(r?.kind === "param" ? r.bound : t);
    return held?.kind === "dyn" ? this.typing.promiseElement(held.of) : held?.kind === "interface" ? this.typing.promiseElement((r?.kind === "param" ? r.bound! : t) as InterfaceType) : undefined;
  }

  // A type argument for a rewritten call, standing for a type already known.
  private presetNode(this: Mut<this>, t: Type, at: Span): TypeNode {
    const made: TypeNode = { id: nextId(this.ids), kind: "ref", name: this.typing.show(t), args: [], start: at.start, end: at.end };
    this.presetTypes.set(made, t);
    return made;
  }

  // `setTimeout(callback, ms)`, `setInterval` and their clears, rewritten as the std's timers.
  /** @throws {CompileError} */
  private timerCall(this: Mut<this>, e: Call, name: string): Call {
    const at = { start: e.start, end: e.end };
    const helper = (named: string, args: Expr[]): Call => this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: named, start: e.callee.start, end: e.callee.end }, args, typeArgs: [] }) as Call;
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    if (e.args.some((a) => a.kind === "spread")) throw new CompileError("E0504", `'${name}' takes its arguments written out, not spread`, e.start, e.end);
    if (name === "clearTimeout" || name === "clearInterval") {
      if (e.args.length > 1) throw new CompileError("E0504", `'${name}' takes the timer to clear`, e.start, e.end);
      return helper("timeout clear", [e.args[0] ?? { id: nextId(this.ids), kind: "null", ...at }]);
    }
    if (e.args.length === 0) throw new CompileError("E0504", `'${name}' takes the function to run, then the milliseconds to wait`, e.start, e.end);
    if (!this.ctx.runtime && !this.ctx.async) throw new CompileError("E0301", `'${name}' can only be used inside an 'async' function here, where the runtime is running`, e.callee.start, e.callee.end);
    this.timerNames.set(e, name);
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
      const params = callback.params.map((p, i) => (!p.type && passed[i] ? this.rewrites.replaceParam(p, { ...p, type: this.presetNode(this.typing.widenLet(this.value(passed[i]!)), p) }) : p));
      callback = this.rewrites.replace(callback, { ...callback, params });
    }
    const span = { start: callback.start, end: callback.end };
    // Each run passes its own copy of a value that doesn't copy, as each of node's runs passes it.
    const given = passed.map((x): Expr => (x.kind === "ident" && !this.typing.isCopy(this.value(x)) ? { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: x, name: "clone", optional: false, start: x.start, end: x.end }, args: [], typeArgs: [], optional: false, start: x.start, end: x.end } : x));
    const run: Expr = { id: nextId(this.ids), kind: "call", callee: callback, args: given, typeArgs: [], optional: false, ...span };
    const body: Expr = this.givesPromise(callback) ? { id: nextId(this.ids), kind: "unary", op: "await", operand: run, ...span } : run;
    // An async arrow taking nothing is what the timer keeps, so its captures are made once.
    const own = callback.kind === "arrow" && callback.async && callback.params.length === 0 && Array.isArray(callback.body);
    const kept: Expr = own ? callback
      : { id: nextId(this.ids), kind: "arrow", move: false, async: true, typeParams: [], params: [], returnType: undefined, body: [{ id: nextId(this.ids), kind: "expr", expr: body, ...span }], ...span };
    const wrapper: Expr = this.givesPromise(callback) ? { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: "timer detached", ...span }, args: [kept], typeArgs: [], optional: false, ...span } : kept;
    this.timerWrappers.add(kept);
    if (!own) this.madeArrows.add(kept);
    const loop: Expr = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: "timer loop", ...at }, args: [], typeArgs: [], optional: false, ...at };
    const ms = e.args[1] ?? { id: nextId(this.ids), kind: "int", value: 0n, ...at };
    this.timerSets.add(e);
    return helper("timerSet", [wrapper, ms, { id: nextId(this.ids), kind: "bool", value: name === "setInterval", ...at }, loop]);
  }

  // Whether a timer's callback gives a Promise to await: an async arrow or one whose body calls a
  // function that does, or a function or value that does.
  private givesPromise(this: Mut<this>, callback: Expr): boolean {
    if (callback.kind === "arrow") {
      if (callback.async) return true;
      // A block body gives what its last statement returns.
      const last = Array.isArray(callback.body) ? callback.body.at(-1) : undefined;
      const given = Array.isArray(callback.body) ? (last?.kind === "return" ? last.value : undefined) : callback.body;
      return given?.kind === "call" && this.givesPromise(given.callee);
    }
    if (callback.kind !== "ident") return false;
    const local = this.ctx.lookup(callback.name);
    if (!local) {
      const f = this.bodyNamed(callback.name);
      return f?.async === true || (f?.returnType?.kind === "ref" && f.returnType.name === "Promise");
    }
    const held = this.typing.lower(local.type);
    const r = this.recOf(held);
    const fn = r?.kind === "closure" || r?.kind === "function" ? r : this.isCallable(held) ? this.recOf(this.typing.callableOf.get(this.typing.rec(held as DynType).of)) : undefined;
    const returns = fn?.returns;
    return returns !== undefined && (this.recOf(returns)?.kind === "future" || this.promiseMet(returns) !== undefined);
  }

  // `Promise.withResolvers<T>()`, rewritten as the prelude's cell with its promise and the
  // closures settling it; reject's error is what the function declares it throws, or `Error`.
  /** @throws {CompileError} */
  private promiseResolvers(this: Mut<this>, e: Call): Call {
    if (e.args.length > 0) throw new CompileError("E0305", "'Promise.withResolvers' takes no arguments", e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("E0305", "'Promise.withResolvers' takes one type argument, what its Promise gives", e.start, e.end);
    if (e.typeArgs.length === 0) throw new CompileError("E0305", "can't tell what this Promise gives; write it, as in 'Promise.withResolvers<i64>()'", e.start, e.end);
    const gives = this.ctx.resolveType(e.typeArgs[0]!);
    const error = this.ctx.throwsDeclared() ?? this.arenas.classOf(this.classes.get("Error")!).type;
    const at = { start: e.start, end: e.end };
    const made = this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: gives === "void" ? "promise with resolvers void" : "promise with resolvers", ...at }, typeArgs: [...(gives === "void" ? [] : [this.presetNode(gives, e)]), this.presetNode(error, e)] }) as Call;
    if (gives !== "void") this.promiseVariants.set(made, { name: "promise with resolvers", typeArgs: made.typeArgs });
    return made;
  }

  // `Promise.resolve(v)` and `Promise.reject(e)`, rewritten as the prelude's async functions
  // giving v or throwing e. Each gives the T it is written with or meets; a rejected one with
  // neither gives nothing.
  /** @throws {CompileError} */
  private promiseSettled(this: Mut<this>, e: Call, name: "resolve" | "reject"): Call {
    const at = { start: e.start, end: e.end };
    if (e.args.length > 1 || e.args[0]?.kind === "spread") throw new CompileError("E0305", `'Promise.${name}' takes ${name === "resolve" ? "the value it gives" : "the error it throws"}`, e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("E0305", `'Promise.${name}' takes one type argument, what it gives`, e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const met = (expected === undefined ? undefined : this.promiseMet(expected)) ?? this.ctx.exprsState.awaitedAs.get(e);
    const written = e.typeArgs[0] ? this.ctx.resolveType(e.typeArgs[0]) : undefined;
    if (name === "resolve") {
      const gives = written ?? (e.args.length === 0 ? "void" : met);
      if (gives === "void" && e.args.length > 0) throw new CompileError("E0305", "a 'Promise<void>' gives nothing, so 'Promise.resolve' takes no value for it", e.args[0]!.start, e.args[0]!.end);
      if (gives !== "void" && e.args.length === 0) throw new CompileError("E0305", `'Promise.resolve' takes the value it gives, of type '${this.typing.show(gives!)}'`, e.start, e.end);
      const given = e.args.length > 0 ? this.value(e.args[0]!) : undefined;
      const r = this.recOf(given);
      if (r?.kind === "future" || r?.kind === "handle" || (r?.kind === "dyn" && this.typing.promiseElement(r.of) !== undefined)) {
        throw new CompileError("E0305", "'Promise.resolve' of a Promise would hold one Promise inside another, which Fish doesn't flatten; await it first, or use the Promise itself", e.args[0]!.start, e.args[0]!.end);
      }
      return this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: gives === "void" ? "promise resolve void" : "promise resolve", ...at }, typeArgs: gives === "void" || gives === undefined ? [] : [this.presetNode(gives, e)] }) as Call;
    }
    if (e.args.length === 0) throw new CompileError("E0305", "'Promise.reject' takes the error it throws, as in 'Promise.reject(new Error(\"failed\"))'", e.start, e.end);
    const gives = written ?? met ?? "void";
    const reason = this.value(e.args[0]!);
    const made = this.rewrites.replace(e, { ...e, callee: { id: nextId(this.ids), kind: "ident", name: gives === "void" ? "promise reject void" : "promise reject", ...at }, typeArgs: [...(gives === "void" ? [] : [this.presetNode(gives, e)]), this.presetNode(this.typing.widenLet(reason), e)] }) as Call;
    if (gives !== "void") this.promiseVariants.set(made, { name: "promise reject", typeArgs: made.typeArgs });
    return made;
  }

  // The std `AbortError` class, which aborted work throws.
  private abortError(): Type {
    return this.arenas.classOf(this.classes.get("AbortError")!).type;
  }

  // Whether a value passes where a JS shape is wanted: a handle of a shape with its fields, or a
  // Fish value with them, converted; methods only a handle has.
  private takesShape(this: Mut<this>, from: Type, shape: InterfaceType | ObjectType): boolean {
    return this.missingField(from, shape) === undefined;
  }

  // Why a value doesn't pass where a JS shape is wanted, said of the first field that fails.
  private missingField(this: Mut<this>, from: Type, shape: InterfaceType | ObjectType): string | undefined {
    // A borrowed handle is the handle, counted again where it goes.
    if (this.isRefType(from) && this.typing.jsShape(this.typing.rec(from).to)) from = this.typing.rec(from).to;
    const own = this.typing.jsShape(from);
    if (own === shape) return undefined;
    // A pair of types met again while it is compared: handles' shapes referring to themselves
    // fit; a Fish type referring to itself has no value JS could take yet. Object types are
    // interned, so a nested value of another type is a pair of its own.
    const source = own ?? from;
    if (this.ctx.exprsState.comparing.get(source)?.has(shape)) return own ? undefined : `'${this.typing.show(from)}' refers to itself, which can't cross between Fish and JS yet`;
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
    const source = own ?? ((kind === "object" || kind === "class") && !this.typing.isTuple(from) ? from : undefined);
    if (!source) return `a '${this.typing.show(from)}' isn't an object`;
    const wanted = this.typing.rec(shape);
    const owned = own && this.typing.rec(own);
    if (!own && wanted.kind === "interface" && wanted.methods.length > 0) return `its methods come only with a value JS made`;
    // A handle of another shape has the methods this one declares, by name and types.
    if (own && wanted.kind === "interface") {
      const methods = owned?.kind === "interface" ? owned.methods : [];
      // A method fits as TypeScript's do: it may take fewer parameters, an extra one of its own
      // is optional, the wanted one's arguments pass for those it has, and what it gives passes for
      // what is wanted; a generic one is matched by its parameters' count.
      const same = (a: Method, b: Method) => {
        if (a.params.slice(b.params.length).some((p) => !this.typing.isOption(p))) return false;
        if (a.generic || b.generic) return a.params.length === b.params.length;
        return a.params.every((p, i) => i >= b.params.length || this.passesJs(b.params[i]!, p)) && (b.returns === "void" || this.passesJs(a.returns, b.returns));
      };
      const lacking = wanted.methods.find((m) => !methods.some((n) => n.name === m.name && same(n, m)));
      if (lacking) return methods.some((n) => n.name === lacking.name) ? `method '${lacking.name}' takes or gives other types` : `property '${lacking.name}' is missing`;
    }
    // A member Fish couldn't type that the shape declares is one only a handle of it has.
    const held = wanted.kind === "interface" ? this.typing.jsUntyped.get(shape as InterfaceType) : undefined;
    const optional = wanted.kind === "interface" ? this.typing.jsOptional.get(shape as InterfaceType) : undefined;
    const aside = [...(held ?? [])].filter(([n]) => !(optional?.has(n) ?? false)).map(([n]) => n);
    const unseen = aside.find((n) => owned?.kind !== "interface" || !(this.typing.jsUntyped.get(own as InterfaceType)?.has(n) ?? false));
    if (unseen !== undefined) return unseen.startsWith("[") ? `its ${unseen === "[index]" ? "index" : "call"} signature comes only with a value JS made` : `property '${unseen}' is missing`;
    // A Fish class's private fields stay its own.
    const r = this.typing.rec(source as Exclude<Type, string>);
    const fields = r.kind === "class" ? r.fields.filter((g) => (g.access ?? "public") === "public") : r.fields;
    for (const f of this.typing.rec(shape).fields) {
      const found = fields.find((g) => g.name === f.name);
      if (!found) {
        if (this.typing.isOption(f.type)) continue;
        return `property '${f.name}' is missing`;
      }
      if (!this.passesJs(found.type, f.type)) return `property '${f.name}' is a '${this.typing.show(found.type)}', not a '${this.typing.show(f.type)}'`;
      const why = own ? undefined : this.typing.uncrossable(found.type);
      if (why) return `property '${f.name}' is a '${this.typing.show(found.type)}', which can't cross between Fish and JS yet: ${why}`;
    }
    return undefined;
  }

  // Whether a value passes where a package declares a type: as it fits it, or as a value JS takes
  // for it, inside unions and arrays too.
  private passesJs(this: Mut<this>, from: Type, to: Type): boolean {
    const referred = this.isRefType(from) ? this.recOf(this.typing.rec(from).to) : undefined;
    if (this.isRefType(from) && referred?.kind === "block" && referred.which === "JsValue") from = this.typing.rec(from).to;
    if (this.typing.fits(from, to)) return true;
    // An integer is a number in JS, as a literal in an object for one is written.
    // ponytail: past 2^53 an integer loses precision, as it would in JS; refuse if that matters
    if (isInteger(from) && to === "f64") return true;
    const source = this.recOf(from);
    if (source?.kind === "union") return source.members.every((m) => this.passesJs(m, to));
    if (typeof to === "string") return false;
    const r = this.typing.rec(to);
    if (r.kind === "union") return r.members.some((m) => this.passesJs(from, m));
    if (r.kind === "array") return source?.kind === "array" && this.passesJs(source.element, r.element);
    // A nested object becomes a new JS object as the one holding it does, so it takes a Fish value
    // of its shape the same way.
    const shape = this.typing.jsShape(to) ?? (r.kind === "object" && !r.tuple ? (to as ObjectType) : undefined);
    if (shape) return this.takesShape(from, shape);
    return r.kind === "block" && r.which === "JsValue" && this.typing.uncrossable(from) === undefined;
  }

  // Whether a type holds a JS handle or an any, where Fish values of other types pass.
  private holdsJs(t: Type): boolean {
    return this.typing.holdsPart(t, (u) => {
      const r = this.recOf(u);
      return r?.kind === "block" && r.which === "JsValue";
    });
  }

  // A shape's member Fish couldn't type, as the refusal of its declaration, noting this use.
  private untyped(shape: InterfaceType | ObjectType | undefined, name: string, at: Span): CompileError | undefined {
    const why = shape && this.typing.rec(shape).kind === "interface" ? this.typing.jsUntyped.get(shape as InterfaceType)?.get(name) : undefined;
    if (why && !why.note) why.note = { message: `'${name}' is used here`, start: at.start, end: at.end };
    return why;
  }

  // A type a handle's member gives or takes, refused when it can't cross between Fish and JS.
  /** @throws {CompileError} */
  private crossing(t: Type, what: string, at: Span): Type {
    // A generic body's definition holds placeholders, which each instance checks as what they are.
    if (this.typing.holdsPart(t, (p) => this.placeholder(p))) return t;
    const why = t === "void" ? undefined : this.typing.uncrossable(t);
    if (why) throw new CompileError("E1005", `${what} '${this.typing.show(t)}', which can't cross between Fish and JS yet: ${why}`, at.start, at.end);
    return t;
  }

  // A JS handle's property, as its shape declares it, read from JS.
  /** @throws {CompileError} */
  private jsProperty(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, t: BlockType): Type {
    if (this.typing.rec(t).of === "void") {
      if (this.ctx.exprsState.writing === e) throw new CompileError("E1005", "writing a JS value's properties isn't supported yet; a 'JsValue' is read with 'get'", e.start, e.end);
      if (["get", "at", "has"].includes(e.name)) throw new CompileError("E1005", `'${e.name}' is a method of a 'JsValue'; call it, as in '${this.placeText(e)}(...)'`, e.start, e.end);
      throw new CompileError("E1005", `a 'JsValue' could be anything, as an 'unknown' could, so it has no property '${e.name}' to use; read one with '${this.placeText(e.object)}.get("${e.name}")'`, e.start, e.end);
    }
    const shape = this.typing.jsShape(t);
    const found = shape && this.typing.rec(shape).fields.find((f) => f.name === e.name);
    if (found) {
      this.jsMembers.add(e);
      // A callback or a Promise goes to JS when written, but Fish has no reading of one back.
      const kept = (u: Type) => typeof u !== "string" && this.typing.rec(u).kind === "dyn" && this.typing.keptByJs(u);
      if (this.ctx.exprsState.writing !== e && this.typing.holdsPart(found.type, kept)) {
        const promise = this.typing.holdsPart(found.type, (u) => kept(u) && this.typing.promiseElement(this.typing.rec(u as DynType).of) !== undefined);
        throw new CompileError("E0801", `reading property '${e.name}' of '${this.typing.show(t)}' isn't supported yet: it holds a ${promise ? "Promise" : "function"}, which Fish can give JS but not read back`, e.start, e.end);
      }
      return this.crossing(this.typing.jsView(found.type), `property '${e.name}' of '${this.typing.show(t)}' is a`, e);
    }
    const r = this.recOf(shape);
    const method = r?.kind === "interface" && r.methods.some((m) => m.name === e.name);
    if (method) throw new CompileError("E0503", `'${e.name}' is a method of '${this.typing.show(t)}'; call it, as in '${this.placeText(e)}(...)'`, e.start, e.end);
    throw this.untyped(shape, e.name, e) ?? new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(t)}'`, e.start, e.end);
  }

  // `v.get(key)` and `v.at(i)` read a property or an element of a JsValue, and `v.has(key)` tests
  // for one.
  /** @throws {CompileError} */
  private jsAccessor(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const name = callee.name;
    const takes = ({ get: "string", has: "string", at: "i64" } as Record<string, Type>)[name];
    if (!takes) throw new CompileError("E1005", `a 'JsValue' has no method '${name}': its own are 'get', 'at' and 'has', and it is narrowed with 'typeof' to read it`, callee.start, callee.end);
    const what = takes === "i64" ? "an index, as an 'i64'" : "a key, as a 'string'";
    if (e.args.length !== 1) throw new CompileError("E0504", `'${name}' takes ${what}`, e.start, e.end);
    this.expect(e.args[0]!, takes);
    const given = this.value(e.args[0]!);
    this.coerce(e.args[0]!, given, takes, `'${name}' takes ${what}, not '${this.typing.show(given)}'`);
    this.jsAccessors.add(e);
    return { type: name === "has" ? "boolean" : this.typing.blockType("JsValue"), what: `'${name}'` };
  }

  // A JS handle's method, called with its declared parameters.
  /** @throws {CompileError} */
  private jsMethodCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: BlockType): { type: Type; what: string } {
    if (this.typing.rec(t).of === "void") return this.jsAccessor(e, callee);
    const shape = this.typing.jsShape(t);
    const r = this.recOf(shape);
    const method = r?.kind === "interface" ? r.methods.find((m) => m.name === callee.name) : undefined;
    if (!method) {
      const field = r?.fields.some((f) => f.name === callee.name);
      throw this.untyped(shape, callee.name, callee) ?? new CompileError(field ? "E0503" : "E0502", field ? `'${callee.name}' is a property of '${this.typing.show(t)}', not a method` : `property '${shownName(callee.name)}' does not exist on type '${this.typing.show(t)}'`, callee.start, callee.end);
    }
    this.jsMethods.add(e);
    // A generic one is typed for the call's type arguments, written or inferred.
    if (method.generic) {
      // An optional parameter left out is undefined, as JS gives it.
      const missing = method.params.slice(e.args.length);
      const left = missing.findIndex((p) => !this.typing.isOption(p));
      const nulls = missing.slice(0, left < 0 ? missing.length : left).map((): Expr => ({ id: nextId(this.ids), kind: "null", start: e.end, end: e.end }));
      if (nulls.length > 0) e = this.rewrites.replace(e, { ...e, args: [...e.args, ...nulls] }) as Call;
      this.jsCrossings.add(e);
      this.jsOptionalOf.set(e, method.optional ?? []);
      const typed = this.familyCall(e, { generic: method.generic }, `'${callee.name}'`);
      e.args.forEach((a) => this.crossing(this.types.get(a) ?? "void", `'${callee.name}' of '${this.typing.show(t)}' is given a`, a));
      return { type: this.crossing(typed.type === "void" ? "void" : this.typing.jsView(typed.type), `'${callee.name}' of '${this.typing.show(t)}' gives a`, e), what: typed.what };
    }
    // A callback or a Promise it takes is one JS keeps, and an object type a JS object's shape.
    const params = method.params.map((t) => this.typing.jsTakes(t));
    params.forEach((p) => this.crossing(p, `'${callee.name}' of '${this.typing.show(t)}' takes a`, e));
    this.jsArgs(e, params, method.optional ?? []);
    return { type: this.crossing(method.returns === "void" ? "void" : this.typing.jsView(method.returns), `'${callee.name}' of '${this.typing.show(t)}' gives a`, e), what: `'${callee.name}'` };
  }

  // The signature of a package's function a call takes: the first, in the order declared, whose
  // parameters the arguments pass for; a generic one is taken on the count of its arguments.
  /** @throws {CompileError} */
  private jsOverload(this: Mut<this>, e: Call, first: Body): Body {
    const signatures = [first, ...first.js!.overloads!.map((f) => this.arenas.bodyOf(this.jsBodies.get(f)!))];
    if (e.args.some((a) => a.kind === "arrow" || a.kind === "spread")) return first;
    const given = e.args.map((a) => this.value(a));
    // In a generic body's definition an argument may be a placeholder: each instance picks again.
    const open = given.some((t) => this.typing.holdsPart(t, (p) => this.placeholder(p)));
    const fitting = signatures.find((f) => {
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (given.length < required || (given.length > f.params.length && !f.params.at(-1)?.rest)) return false;
      if ((f.typeParams?.length ?? 0) > 0 || open) return true;
      return given.every((t, i) => {
        const p = f.params[Math.min(i, f.params.length - 1)]!;
        const declared = p.type ? this.ctx.resolveType(p.type) : this.typing.blockType("JsValue");
        return this.passesJs(t, p.optional ? this.typing.unionType([declared, "null"]) : declared);
      });
    });
    if (fitting) return fitting;
    const shown = signatures.map((f) => `(${f.params.map((p) => `${(p.pattern as { name?: string }).name ?? "_"}${p.optional ? "?" : ""}: ${p.type ? this.typing.show(this.ctx.resolveType(p.type)) : "any"}`).join(", ")})`).join(", ");
    throw new CompileError("E0507", `no signature of '${first.js!.name}' takes (${given.map((t) => this.typing.show(t)).join(", ")}); it takes ${shown}`, e.start, e.end);
  }

  // The overload a call takes: the first, in the order declared, whose parameters its arguments
  // pass for, as TypeScript picks one. A generic one is taken on the count of its arguments.
  /** @throws {CompileError} */
  private overload(this: Mut<this>, e: Call, impl: Body): Body {
    const spread = e.args.find((a) => a.kind === "spread");
    if (spread) throw new CompileError("E0801", `spreading arguments into the overloaded '${impl.name}' isn't supported yet; pass them one by one`, spread.start, spread.end);
    const given = e.args.map((a) => (a.kind === "arrow" ? undefined : this.tried(a)));
    const overloads = impl.overloads!.map((f) => this.arenas.bodyOf(f));
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
        const type = types ? this.typing.show(types[i]!) : "_";
        return name.startsWith("argument ") ? type : `${p.rest ? "..." : ""}${name}${p.optional ? "?" : ""}: ${type}`;
      });
      return `(${params.join(", ")}): ${f.returnType ? this.typing.show(this.ctx.resolveType(f.returnType)) : "_"}`;
    });
    const args = given.map((t) => (t === undefined ? "a function" : this.typing.show(t)));
    throw new CompileError("E0507", `no overload of '${impl.name}' takes (${args.join(", ")}); its overloads are ${shown.join(", ")}`, e.start, e.end);
  }

  // What an overload's body gives back: the implementation's value, as the members of its type the
  // signature's return type takes; codegen panics on any other.
  /** @throws {CompileError} */
  private narrowedReturn(this: Mut<this>, call: Expr, node: TypeNode): Type {
    const from = this.value(call);
    const to = this.ctx.resolveType(node);
    if (this.typing.fits(from, to)) return from;
    const r = this.recOf(from);
    const kept = r?.kind === "union" ? r.members.filter((m) => this.typing.fits(m, to)) : [];
    if (kept.length === 0 && this.typing.fits(to, from)) throw new CompileError("E0410", `it returns '${this.typing.show(to)}', narrower than the implementation's '${this.typing.show(from)}', which isn't a union whose members it could be narrowed to; give the implementation a union return type, as in '${this.typing.show(to)} | ...'`, node.start, node.end);
    if (kept.length === 0) throw new CompileError("E0410", `this overload signature is not compatible with its implementation, which returns '${this.typing.show(from)}', never a '${this.typing.show(to)}'`, node.start, node.end);
    return kept.length === 1 ? kept[0]! : this.typing.unionType(kept);
  }

  // An argument's type before it meets a parameter, or nothing when it needs one to be typed.
  private tried(this: Mut<this>, a: Expr): Type | undefined {
    try {
      return this.value(a);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A signature's parameter types, unless it is generic, when each call's instance decides them.
  /** @throws {CompileError} */
  private signatureTypes(this: Mut<this>, f: Body): Type[] | undefined {
    if ((f.typeParams ?? []).some((p) => !isLifetime(p)) || f.params.some((p) => p.comptime)) return undefined;
    const bounds = this.ctx.implicitOf(f);
    // With an implicit parameter, an instance would check the signature's body against bounds,
    // so the others are read as declared.
    const known = bounds.size > 0 ? this.ctx.members().paramTypesOf(f.bodyId) : this.ctx.paramTypes(this.ctx.instanceOf(f));
    return f.params.map((p, i) => {
      const t = bounds.get(i) ?? known[i]!;
      return p.optional ? this.typing.unionType([t, "null"]) : p.rest && this.isArray(this.typing.lower(t)) ? this.typing.rec(this.typing.lower(t) as ArrayType).element : t;
    });
  }

  // Whether an argument passes for a parameter, as choosing an overload asks before the call
  // checks it against the one chosen.
  /** @throws {CompileError} */
  private passes(this: Mut<this>, a: Expr, given: Type | undefined, to: Type, p: Param): boolean {
    if (a.kind === "arrow") return this.arrowPasses(a, to);
    if (given === undefined) return true;
    if (this.typing.fits(given, to)) return true;
    if (this.isRefType(to)) return this.passes(a, this.isRefType(given) ? this.typing.rec(given).to : given, this.typing.rec(to).to, p);
    if (this.isRefType(given)) return this.passes(a, this.typing.rec(given).to, to, p);
    const n = this.numberLiteral(a);
    if (typeof to === "string") {
      if (n === undefined || !isNumeric(to)) return false;
      if (isFloat(to)) return true;
      return typeof n === "bigint" && isInteger(to) && n >= range(to)[0] && n <= range(to)[1];
    }
    const r = this.typing.rec(to);
    if (r.kind === "union") return r.members.some((m) => this.passes(a, given, m, p));
    if (r.kind === "interface") return unsatisfied(given, to as InterfaceType, this.ctx.members(), a) === undefined;
    if (r.kind === "literal") return (a.kind === "string" || a.kind === "bool") ? a.value === r.value : n !== undefined && n === r.value;
    return false;
  }

  // Whether an arrow passes for a function type: no more parameters than it takes, each one
  // written with a type taking what it is given. Without a function type, the call decides.
  private arrowPasses(this: Mut<this>, a: Extract<Expr, { kind: "arrow" }>, to: Type): boolean {
    const r = this.recOf(to);
    if (r?.kind === "union") return r.members.some((m) => this.arrowPasses(a, m));
    if (r?.kind !== "function" || r.generic) return true;
    if (a.params.length > r.params.length) return false;
    return a.params.every((q, i) => {
      if (!q.type) return true;
      const written = this.tryType(q.type);
      return written === undefined || this.typing.fits(r.params[i]!, written);
    });
  }

  private tryType(this: Mut<this>, t: TypeNode): Type | undefined {
    try {
      return this.ctx.resolveType(t);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A numeric literal's value, negated or not: a bigint for an integer, a number for a float.
  private numberLiteral(a: Expr): bigint | f64 | undefined {
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
    this.jsCrossings.add(e);
    this.jsOptionalOf.set(e, optional);
    const list = e.args ?? [];
    let required = params.length;
    while (required > 0 && this.typing.isOption(params[required - 1]!)) required--;
    if (list.length < required || list.length > params.length) {
      const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
      throw new CompileError("E0501", `expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${list.length}`, e.start, e.end);
    }
    list.forEach((a, i) => {
      if (a.kind === "spread") throw new CompileError("E1005", "spreading arguments into a package's functions isn't supported yet", a.start, a.end);
      this.expect(a, params[i]!);
      const given = this.value(a);
      this.coerce(a, given, params[i]!, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(params[i]!)}'`);
      this.givenToJs(a, given);
    });
  }

  // A value given to JS, which the call or write converts: refused when it has no JS form.
  /** @throws {CompileError} */
  private givenToJs(this: Mut<this>, a: Expr, given: Type) {
    this.jsGiven.add(a);
    // A type parameter is what it stands for in this instance.
    for (let r = this.recOf(given); r?.kind === "param" && r.concrete !== undefined; r = this.recOf(given)) given = r.concrete;
    // A callback given to JS is kept by JS, which may call it later from whichever task calls
    // into JS next, so what it holds goes with it to any thread.
    // A future given to JS is a promise, running as a task from when it is given.
    if (typeof given !== "string" && (this.typing.rec(given).kind === "future" || this.typing.rec(given).kind === "handle")) {
      if (!this.ctx.async) throw new CompileError("E1005", "a Promise given to JS starts running as a task when it is given, so it is given only inside an 'async' function", a.start, a.end);
      const blocker = this.unsent(given);
      if (blocker) throw new CompileError("E1005", `a Promise given to JS runs as a task of its own, so it must own everything it uses; it holds a '${this.typing.show(blocker)}'`, a.start, a.end);
      return;
    }
    if (typeof given !== "string" && (this.typing.rec(given).kind === "closure" || this.typing.rec(given).kind === "function" || this.typing.rec(given).kind === "dyn")) {
      const blocker = this.unsent(given);
      if (blocker) throw new CompileError("E1005", `a callback given to JS must own everything it uses, as JS may keep it and call it from another task; it holds a '${this.typing.show(blocker)}'`, a.start, a.end);
      return;
    }
    // JS keeps a callback or a future, so one only borrowed here can't be given; one inside
    // another value would be dropped by Fish as well as kept by JS.
    if (this.isRefType(given) && this.typing.keptByJs(this.typing.rec(given).to)) throw new CompileError("E1005", "JS keeps a callback or a Promise given to it, so it is given owned, not borrowed; give it a clone, or take it owned", a.start, a.end);
    if (this.typing.holdsPart(given, (u) => u !== given && this.typing.keptByJs(u))) throw new CompileError("E1005", "a callback or a Promise inside another value isn't supported yet; give it to JS on its own", a.start, a.end);
    const open = this.typing.holdsPart(given, (p) => this.placeholder(p));
    if (!open && !this.typing.jsConverts(given)) throw new CompileError("E1005", `a '${this.typing.show(given)}' has no JS form yet, so it can't be given to JS`, a.start, a.end);
  }

  // A package's declared parameters as Fish types: an optional one is an Option.
  /** @throws {CompileError} */
  private jsParams(this: Mut<this>, params: Param[]): Type[] {
    return params.map((p) => {
      const declared = this.typing.jsTakes(p.type ? this.ctx.resolveType(p.type) : this.typing.blockType("JsValue"));
      return p.optional ? this.typing.unionType([declared, "null"]) : declared;
    });
  }

  // `new C(...)` of a package's class: its constructor's parameters, giving a handle.
  /** @throws {CompileError} */
  private jsNew(this: Mut<this>, e: Extract<Expr, { kind: "new" }>, c: Interface): Type {
    if (c.typeParams.length > 0) throw unsupported("generic classes of a package", e);
    const constructor = this.jsChain(c).find((k) => k.jsClass!.constructors.length > 0)?.jsClass!.constructors[0] ?? [];
    const params = this.jsParams(constructor);
    params.forEach((p) => this.crossing(p, `'${c.name}''s constructor takes a`, e));
    this.jsArgs(e, params, constructor.map((p) => p.optional));
    this.jsNews.set(e, c.js!);
    return this.ctx.resolveType({ id: nextId(this.ids), kind: "ref", name: c.name, args: [], start: e.start, end: e.end });
  }

  // A package's class and the classes it extends, nearest first: a class without its own
  // constructor takes its base's, and inherits its statics, as in JS.
  private jsChain(c: Interface): Interface[] {
    const chain = [c];
    for (let at = c; ; ) {
      const base = at.extends[0]?.kind === "ref" ? this.jsClasses.get(at.extends[0].name) : undefined;
      if (!base || chain.includes(base)) return chain;
      chain.push(base);
      at = base;
    }
  }

  // A property or method of an `unknown`, which has none until a check says what it holds.
  private unnarrowed(e: Extract<Expr, { kind: "member" }>): CompileError {
    return new CompileError("E0502", `an 'unknown' could hold anything, so it has no property '${shownName(e.name)}' until it is narrowed; check what it holds first, with 'typeof', 'instanceof' or a type predicate`, e.start, e.end);
  }

  // A package's class's static member: a property read, or a method called.
  /** @throws {CompileError} */
  private jsStatic(this: Mut<this>, c: Interface, name: string, at: Expr): TypeMember {
    const found = this.jsChain(c).flatMap((k) => k.jsClass!.statics).find((m) => "name" in m && m.name === name);
    if (!found) throw new CompileError("E0502", `property '${name}' does not exist on '${c.name}'`, at.start, at.end);
    this.jsStatics.set(at, c.js!);
    return found;
  }

  // `c.signal` on a controller, another handle to its signal, and `signal.aborted`, whether
  // its controller has aborted: values computed by the runtime, not fields.
  /** @throws {CompileError} */
  private blockProperty(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, t: BlockType): Type {
    if (this.linked(e)) throw unsupported(`optional chains through '${this.typing.rec(t).which}' values`, e);
    this.computed.add(e);
    if (this.typing.rec(t).which === "JsValue") return this.jsProperty(e, t);
    if (this.typing.rec(t).which === "AbortController" && e.name === "signal") return this.typing.blockType("AbortSignal");
    if (this.typing.rec(t).which === "AbortSignal" && e.name === "aborted") return "boolean";
    if ((this.typing.rec(t).which === "TcpListener" || this.typing.rec(t).which === "UdpSocket") && e.name === "port") return "i64";
    throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(t)}'`, e.start, e.end);
  }

  // `shared(v)`: v moved into a new counted block, of its type argument, the type expected of
  // it, or else v's own type.
  /** @throws {CompileError} */
  private sharedNew(this: Mut<this>, e: Call): { type: Type; what: string } {
    if (e.args.length !== 1 || e.typeArgs.length > 1) throw new CompileError("E0504", "'shared' takes the value it starts with, as in 'shared({ hits: 0 })'", e.start, e.end);
    const expected = this.ctx.exprsState.wanted.get(e);
    const given = e.typeArgs[0] ? this.typing.heldArgument(this.ctx.resolveType(e.typeArgs[0])) : typeof expected !== "string" && expected !== undefined && this.typing.rec(expected).kind === "shared" ? (this.typing.rec(expected as SharedType)).of : undefined;
    const a = e.args[0]!;
    if (given) this.expect(a, given);
    const t = this.value(a);
    const of = given ?? this.typing.heldArgument(this.typing.widenLet(t));
    this.coerce(a, t, of, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(of)}'`);
    return { type: shareable(this.typing, of, e), what: "'shared'" };
  }

  // A shared value's `update`, a Lock's: the callback changes the value under the block's lock.
  /** @throws {CompileError} */
  private sharedCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: SharedType): { type: Type; what: string } {
    const which = this.typing.rec(t).which;
    if (which === "Weak") return this.weakCall(e, callee, t);
    if (which === "Rc" && callee.name === "downgrade") {
      if (e.args.length > 0) throw new CompileError("E0504", "'downgrade' takes no arguments", e.start, e.end);
      return { type: this.typing.sharedType(this.typing.rec(t).of, "Weak"), what: "'downgrade'" };
    }
    const inner = this.typing.lowerKeepingBrands(this.typing.rec(t).of);
    const stored = typeof inner !== "string" && (this.typing.rec(inner).kind === "object" || this.typing.rec(inner).kind === "class") ? this.typing.field(inner, callee.name) : undefined;
    if (stored && this.isCallable(this.typing.lower(stored.type))) return this.callableCall(e, callee, this.typing.lower(stored.type) as DynType);
    if (which === "Rc" && callee.name === "read") return this.lockCall(e, callee, this.typing.interiorType("RwLock", this.typing.rec(t).of), true, true);
    const method = which === "Rc" && this.recOf(inner)?.kind === "class" ? inherited(this.arenas, this.ctx.classOf(inner as ClassType), "methods", callee.name) : undefined;
    if (method) return this.rcMethod(e, callee, method);
    if (callee.name !== "update") throw new CompileError("E0502", `'${which}' has no method '${callee.name}'; read its fields, change it with 'update', ${which === "Rc" ? "read it in place with 'read', share it again with 'clone', or reach it weakly with 'downgrade'" : "or share it again with 'clone'"}`, callee.start, callee.end);
    return this.lockCall(e, callee, this.typing.interiorType("Lock", this.typing.rec(t).of), true, which === "Rc");
  }

  // `rc.m(args)` for a method that only reads: `rc.read((v) => v.m(args))`, so its call counts as
  // a read of the value, which nested reads may share and an update may not.
  /** @throws {CompileError} */
  private rcMethod(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, method: Body): { type: Type; what: string } {
    if (method.self?.mutable || method.self?.owned) {
      throw new CompileError("E0304", `'${callee.name}' changes its object, so on an Rc it runs inside 'update', as in '${this.placeText(this.bare(callee.object))}.update((v) => v.${callee.name}(...))'`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported("optional chains calling methods through an Rc", callee);
    const at = { start: e.start, end: e.end };
    const name = "rc value";
    const param: Param = { ...at, id: nextId(this.ids), pattern: { id: nextId(this.ids), kind: "ident", name, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false };
    const inner: Expr = { ...e, id: nextId(this.ids), callee: { ...callee, id: nextId(this.ids), object: { id: nextId(this.ids), kind: "ident", name, start: callee.object.start, end: callee.object.end } } };
    const arrow: Expr = { id: nextId(this.ids), kind: "arrow", move: false, async: false, typeParams: [], params: [param], returnType: undefined, body: inner, ...at };
    const read = this.rewrites.replace(e, { ...e, callee: { ...callee, id: nextId(this.ids), name: "read" }, args: [arrow], typeArgs: [] }) as Call;
    return this.call(read);
  }

  // `Rc.ptrEq(a, b)`: whether two Rcs share one block, which `===` doesn't ask, since it
  // compares values. Each is borrowed for the test.
  /** @throws {CompileError} */
  private ptrEq(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name !== "ptrEq") throw new CompileError("E0502", `'Rc' has no '${callee.name}'; it has 'ptrEq', which tells whether two Rcs share one value`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError("E0505", "'Rc' is always there, so 'Rc.ptrEq' is called without '?.'", e.start, e.end);
    if (e.args.length !== 2 || e.typeArgs.length > 0 || e.args.some((a) => a.kind === "spread")) throw new CompileError("E0504", "'Rc.ptrEq' takes the two Rcs to compare, as in 'Rc.ptrEq(a, b)'", e.start, e.end);
    const held = e.args.map((a) => {
      const t = this.value(a);
      const r = this.recOf(this.isRefType(t) ? this.typing.rec(t as RefType).to : t);
      if (r?.kind !== "shared" || r.which !== "Rc") throw new CompileError("E0504", `'Rc.ptrEq' compares two Rcs, not '${this.typing.show(t)}'`, a.start, a.end);
      if (!this.isRefType(t)) this.coerce(a, t, this.typing.refType(t, false), "");
      return this.typing.lower(r.of);
    });
    if (held[0] !== held[1]) throw new CompileError("E0504", `'Rc.ptrEq' compares two Rcs of one type, not '${this.typing.show(this.types.get(e.args[0]!)!)}' and '${this.typing.show(this.types.get(e.args[1]!)!)}'`, e.start, e.end);
    return { type: "boolean", what: "'Rc.ptrEq'" };
  }

  // `w.upgrade()`: an Rc of the value a Weak reaches while any Rc of it is left, or else null.
  /** @throws {CompileError} */
  private weakCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: SharedType): { type: Type; what: string } {
    if (callee.name !== "upgrade") throw new CompileError("E0502", `'Weak' has no method '${callee.name}'; reach its value with 'upgrade', which gives an 'Rc' or null, or copy it with 'clone'`, callee.start, callee.end);
    if (this.linked(callee)) throw unsupported("optional chains calling 'Weak' methods", callee);
    if (e.args.length > 0) throw new CompileError("E0504", "'upgrade' takes no arguments", e.start, e.end);
    return { type: this.typing.unionType([this.typing.sharedType(this.typing.rec(t).of, "Rc"), "null"]), what: "'upgrade'" };
  }

  // `s.f` on a shared value: an interior-mutable field is borrowed where it lives, unlocked,
  // since it changes only through its own methods; any other is copied out under the lock.
  /** @throws {CompileError} */
  private sharedField(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, t: SharedType): Type {
    if (this.linked(e)) throw unsupported("optional chains through shared values", e);
    if (this.typing.rec(t).which === "Weak") throw new CompileError("E0502", `a 'Weak' reaches its value only through 'upgrade()', which gives an 'Rc' while one is left, as in 'const p = ${this.placeText(this.bare(e.object))}.upgrade()'`, e.start, e.end);
    const inner = this.typing.lowerKeepingBrands(this.typing.rec(t).of);
    const ir = this.recOf(inner);
    if (ir?.kind === "class") this.ctx.classOf(inner as ClassType);
    const found = ir === undefined || ir.kind === "closure" ? undefined : this.typing.field(inner as Exclude<Type, string>, e.name);
    if (!found) throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(t)}'${didYouMean(e.name, this.memberNames(inner))}`, e.start, e.end);
    if (ir?.kind === "class") this.visible(found.access, this.declaring(inner as ClassType, e.name), e.name, e);
    // A Rust value is reached only under the lock, and a read here would copy its handle out.
    let rust: RustClass | undefined;
    if (this.typing.holdsPart(found.type, (u) => (rust ??= rustClassOf(this.typing, u)) !== undefined)) {
      throw new CompileError("E1004", `'${e.name}' holds a Rust '${rust!.name}', which a shared value gives only inside 'update', as in 's.update((v) => v.${e.name}...)'`, e.start, e.end);
    }
    if (!this.typing.interiorMutable(found.type)) this.ctx.copiesOut.add(e);
    return found.type;
  }

  // `lock.update(v => ...)`: the callback changes what the lock holds while it is locked, and
  // gives what the callback gives; an RwLock's `read` lends it read-only, beside other readers.
  // A closure can't return a reference, so nothing it gives borrows from the value once the
  // lock is released.
  /** @throws {CompileError} */
  private lockCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType, sharing = false, counting = false): { type: Type; what: string } {
    const method = callee.name;
    const which = this.typing.rec(t).which;
    if (method !== "update" && !(method === "read" && which === "RwLock")) {
      const has = which === "RwLock" ? "'read' runs a callback with a read-only view of what it holds, and 'update' with a mutable one" : "'update' runs a callback with what it holds";
      throw new CompileError("E0502", `'${which}' has no method '${method}'; ${has}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported(`optional chains calling '${which}' methods`, callee);
    if (e.args.length !== 1) throw new CompileError("E0506", `'${method}' takes 1 argument, a callback like 'v => ...'`, e.start, e.end);
    const callback = e.args[0]!;
    if (callback.kind !== "arrow") throw unsupported(`callbacks passed to '${method}' by name; write the arrow function in place`, callback);
    const held = this.typing.refType(this.typing.lowerKeepingBrands(this.typing.rec(t).of), method === "update");
    const signature = this.typing.functionType(["value"], [held], "void");
    this.typing.lockCallbacks.set(signature, method);
    if (sharing) this.typing.sharedCallbacks.add(signature);
    if (counting) this.typing.rcCallbacks.add(signature);
    this.expect(callback, signature);
    const c = this.recOf(this.value(callback));
    if (c?.kind !== "closure" || c.params.length > 1) throw new CompileError("E0506", `'${method}' passes its callback a '${this.typing.show(held)}'`, callback.start, callback.end);
    if (c.params[0] !== undefined) this.passedExactly(method, held, c.params[0], callback.kind === "arrow" ? callback.params[0] : undefined, callback);
    return { type: c.returns, what: `'${method}'` };
  }

  // `await p`: the future runs to completion, the async function stopping while it is pending,
  // and gives its value, or raises its error as a call would. It moves into the await.
  /** @throws {CompileError} */
  private awaited(this: Mut<this>, e: Extract<Expr, { kind: "unary" }>): Type {
    if (this.ctx.locked && this.ctx.counting) throw new CompileError("E0304", `an Rc's '${this.ctx.locked}' callback can't 'await': the value stays marked as ${this.ctx.locked === "read" ? "read" : "changed"} until the callback returns, and code running meanwhile would find it so; finish the ${this.ctx.locked}, then await`, e.start, e.end);
    if (this.ctx.locked) throw new CompileError("E0304", `'${this.ctx.locked}' holds its lock while the callback runs, so the callback can't 'await': every task needing the lock would wait too; finish the ${this.ctx.locked}, then await`, e.start, e.end);
    if (!this.ctx.async || this.ctx.syncMain) throw new CompileError("E0301", "'await' can only be used inside an 'async' function", e.start, e.end);
    if (!this.ctx.awaitable.has(e)) throw new CompileError("E0801", "'await' inside an expression isn't supported yet; give its value a name first, as in 'const x = await ...;'", e.start, e.end);
    this.awaitedNow.add(e.operand);
    let t = this.value(e.operand);
    // Through a bound: in an instance, the concrete method's own future; in the definition, what
    // the bound's `Promise<T>` gives.
    const p = this.recOf(t);
    if (p?.kind === "param" && p.concrete) t = p.concrete;
    const r = this.recOf(t);
    const promise = r?.kind === "param" ? r.bound : t;
    const described = this.recOf(promise)?.kind === "interface" ? this.typing.promiseElement(promise!) : undefined;
    if (described !== undefined && (r?.kind === "interface" || r?.kind === "param")) return described;
    if (r?.kind === "param" || r?.kind === "interface") throw unsupported("awaits of 'Promise<T>' parameters", e.operand);
    if (r?.kind === "dyn" && this.typing.promiseElement(r.of) !== undefined) return this.typing.promiseElement(r.of)!;
    if (r === undefined || (r.kind !== "future" && r.kind !== "handle")) throw new CompileError("E0305", `'await' needs a Promise, like an async function's call, not '${this.typing.show(t)}'`, e.operand.start, e.operand.end);
    if (r.throws) this.ctx.raise(e, r.throws, "this Promise");
    return r.gives;
  }

  // `Promise.all`, `race`, `allSettled` and `any`: one future awaiting those in the list at once,
  // in this task. It is awaited where it is made, so the futures' borrows end with the await.
  /** @throws {CompileError} */
  private combined(this: Mut<this>, e: Call, kind: Combiner): { type: Type; what: string } {
    const name = `'Promise.${kind}'`;
    if (e.optional) throw new CompileError("E0505", `${name} is always there, so it is called without '?.'`, e.start, e.end);
    if (!this.awaitedNow.has(e)) throw new CompileError("E0305", `${name} is awaited where it is called, as in 'await Promise.${kind}([a(), b()])'`, e.start, e.end);
    const [list] = e.args;
    if (e.args.length !== 1 || list === undefined || list.kind === "spread") throw new CompileError("E0305", `${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])'`, e.start, e.end);
    // An array of `Promise<T>` values gives a `T[]`, or for `race` a `T`.
    if (list.kind !== "array") {
      const t = this.value(list);
      const lr = this.recOf(t);
      const er = this.recOf(lr?.kind === "array" ? lr.element : undefined);
      if (er?.kind !== "dyn" || this.typing.promiseElement(er.of) === undefined) throw new CompileError("E0305", `${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])' or a 'Promise<T>[]', not '${this.typing.show(t)}'`, list.start, list.end);
      this.combinedCalls.add(e);
      // Boxed futures throw nothing, so an `any` over them fails only when the array is empty,
      // with no errors, typed as null.
      return { type: this.typing.combinedFuture({ kind, futures: [], array: t as ArrayType, aggregate: kind === "any" ? this.aggregateOf("null", e) : undefined, at: e }), what: name };
    }
    if (list.elements.length === 0) throw new CompileError("E0305", `${name} needs a Promise to wait for${kind === "race" ? "; an empty race never settles" : ""}`, list.start, list.end);
    const futures = list.elements.map((x) => {
      if (x === undefined || x.kind === "spread") throw new CompileError("E0305", `${name} takes each Promise written in the list`, (x ?? list).start, (x ?? list).end);
      if (x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise" && COMBINERS.includes(x.callee.name) && !this.ctx.lookup("Promise") && !this.classes.has("Promise")) {
        throw new CompileError("E0305", `'Promise.${(x.callee as { name: string }).name}' can't be in another Promise's list; give it an async function of its own, as in 'async function both() { return await Promise.all([...]); }', and put its call in the list`, x.start, x.end);
      }
      let t = this.value(x);
      const p = this.recOf(t);
      if (p?.kind === "param" && p.concrete) t = p.concrete;
      const r = this.recOf(t);
      if (r?.kind === "dyn" && this.typing.promiseElement(r.of) !== undefined) return t as DynType;
      if (r === undefined || (r.kind !== "future" && r.kind !== "handle")) throw new CompileError("E0305", `${name} takes Promises, like an async function's call, not '${this.typing.show(t)}'`, x.start, x.end);
      return t as FutureType | HandleType;
    });
    // An `any` fails only when every future can, with all their errors.
    const thrown = futures.map((f) => { const r = this.typing.rec(f); return r.kind === "dyn" ? undefined : r.throws; });
    const aggregate = kind === "any" && thrown.every((x) => x !== undefined) ? this.aggregateOf(this.typing.unionType(thrown as Type[]), e) : undefined;
    const type = this.typing.combinedFuture({ kind, futures, aggregate, at: e });
    this.combinedCalls.add(e);
    return { type, what: name };
  }

  // The prelude's `AggregateError<E>` for errors of type `E`.
  /** @throws {CompileError} */
  private aggregateOf(this: Mut<this>, errors: Type, at: Span): ClassType {
    return this.ctx.construct("AggregateError", [], [this.typing.arrayType(errors)], at)!.type as ClassType;
  }

  // What keeps a value from moving to another thread: a reference, which borrows from the
  // thread that made it, a raw pointer, which nothing checks, a Cell, which changes unlocked, or
  // an Rc or a Weak, whose counts do.
  private unsent(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    // A type holding itself is looked into once.
    if (typeof t === "string" || seen.has(t)) return undefined;
    seen.add(t);
    const r = this.typing.rec(t);
    if (r.kind === "ref" || r.kind === "pointer" || (r.kind === "interior" && r.which === "Cell") || (r.kind === "shared" && r.which !== "shared") || (r.kind === "dyn" && this.typing.borrowing.has(r.of))) return t;
    // A Rust type is Send, which the shim asserts.
    if (rustClassOf(this.typing, t)) return undefined;
    const parts = r.kind === "interior" ? [r.of] : r.kind === "future" || r.kind === "generator" ? r.params.map((f) => f.type)
      : r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "map" ? [r.key, r.value] : r.kind === "class" && r.base ? [r.base, ...r.fields.map((f) => f.type)] : this.typing.fieldsOf(t).map((f) => f.type);
    for (const part of parts) {
      const found = this.unsent(part, seen);
      if (found) return found;
    }
    return undefined;
  }

  // `g.next()` runs a generator to its next `yield`, changing it, so it needs a place. An async
  // generator's gives a future borrowing it, awaited where it is made so the borrow ends there.
  /** @throws {CompileError} */
  private generatorCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, generator: Type, yields: Type, async = false): { type: Type; what: string } {
    if (!async && Object.hasOwn(GENERATOR_HELPERS, callee.name)) return this.helperCall(e, callee, yields);
    if (callee.name !== "next") throw new CompileError("E0502", `generators have no method '${callee.name}' yet${didYouMean(callee.name, async ? ["next"] : ["next", ...Object.keys(GENERATOR_HELPERS)])}`, callee.start, callee.end);
    if (async && !this.awaitedNow.has(e)) throw new CompileError("E0305", "an async generator's 'next()' is awaited where it is called, as in 'await g.next()'", e.start, e.end);
    if (this.linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    const sends = this.typing.generatorSends(generator);
    if (e.args.length > 0 && async) throw unsupported("values sent into an async generator's 'next'", e.args[0]!);
    if (e.args.length > 0 && sends === undefined) throw new CompileError("E0606", `this generator takes nothing through 'next'; to send it values, declare what it takes, as in 'Generator<${this.typing.show(yields)}, void, string>'`, e.args[0]!.start, e.args[0]!.end);
    if (e.args.length > 1) throw new CompileError("E0606", "'next' takes at most 1 argument, the value the generator's 'yield' gives", e.args[1]!.start, e.args[1]!.end);
    // Like JavaScript, `next()` with nothing sent is allowed; a `yield` whose value is used panics.
    const arg = e.args[0];
    if (arg) {
      this.expect(arg, sends!);
      const t = this.value(arg);
      if (this.typing.holdsRef(t)) throw unsupported("references sent into generators", arg);
      this.coerce(arg, t, sends!, `argument of type '${this.typing.show(t)}' is not assignable to parameter of type '${this.typing.show(sends!)}'`);
    }
    const held = this.types.get(callee.object)!;
    if (this.isRefType(held)) this.coercions.set(callee.object, generator);
    if (!this.place(callee.object)) throw new CompileError("E0212", "'next' changes its generator, so call it on a variable or a field", callee.start, callee.end);
    this.changeable(callee.object, "advance");
    const error = this.typing.generatorThrows(generator);
    if (!async && error) this.ctx.raise(e, error, "'next'");
    if (!async) return { type: this.typing.nextResult(yields), what: "'next'" };
    const g = this.recOf(generator);
    const made = this.recOf(g?.kind === "param" && g.concrete ? g.concrete : generator);
    return { type: made?.kind === "generator" ? this.typing.leafFuture("next", (g?.kind === "param" && g.concrete ? g.concrete : generator as GeneratorType)) : this.typing.promiseInterface(this.typing.nextResult(yields)), what: "'next'" };
  }

  // The iterator helpers call std's generators and functions over the generator, which they take
  // over. `map`, `filter`, `take`, `drop` and `flatMap` give a generator that pulls from it only
  // when pulled; the rest run it at once. Callbacks get each value and its index, the predicates
  // a borrow of the value.
  /** @throws {CompileError} */
  private helperCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, yields: Type): { type: Type; what: string } {
    const name = callee.name;
    const source = callee.object;
    if (this.linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${name}' takes no type arguments`, e.start, e.end);
    if (this.isRefType(this.types.get(source)!)) throw new CompileError("E0202", `'${name}' takes its generator over, and this one is borrowed; call it on a generator this code owns`, source.start, source.end);
    this.ctx.exprsState.once.add(source);
    const at = { start: e.start, end: e.end };
    const helper = (helperName: string, args: Expr[]): Call => ({ id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "ident", name: helperName, ...at }, args, typeArgs: [], optional: false, shown: name, ...at }) as Call;
    // A count or a fold that can't give a value panics at the call, with JavaScript's reason.
    const unwrap = (expr: Expr, reason: string): Expr => ({ id: nextId(this.ids), kind: "nonNull", expr, reason, ...at }) as Expr;
    const counted = name === "take" || name === "drop";
    if (name === "toArray" ? e.args.length !== 0 : name === "reduce" ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      const takes = name === "toArray" ? "no arguments" : counted ? "1 argument, a count" : name === "reduce" ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'";
      throw new CompileError("E0504", `'${name}' takes ${takes}`, e.start, e.end);
    }
    if (name === "toArray") return this.call(this.rewrites.replace(e, helper("array collect", [source])) as Call);
    if (counted) return this.call(this.rewrites.replace(e, helper(GENERATOR_HELPERS[name]!, [source, unwrap(helper("iter count", [e.args[0]!]), `'${name}''s count can't be negative`)])) as Call);
    const [named, init] = e.args as [Expr, Expr | undefined];
    // A declared function given by name becomes an arrow calling it, as for array methods.
    let callback = this.namedFunction(named);
    const reducing = name === "reduce";
    const lent = PREDICATES.has(name);
    const each = lent ? this.typing.refType(yields, false) : yields;
    const acc = !reducing ? undefined : init ? this.typing.widenLet(this.value(init)) : yields;
    if (init) this.ctx.exprsState.once.add(init);
    const params = acc ? [acc, each, "i64" as const] : [each, "i64" as const];
    if (callback.kind === "arrow" && callback.params.length > params.length) {
      throw new CompileError("E0506", `'${name}' passes its callback ${acc ? "the accumulator, " : ""}the value and its index`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    const names = acc ? ["accumulator", "value", "index"] : ["value", "index"];
    // std calls the callback with every argument, so an arrow leaving some out takes them under
    // names no program can write.
    if (callback.kind === "arrow" && callback.params.length < params.length) {
      const at = { start: callback.start, end: callback.start };
      const unnamed = names.slice(callback.params.length, params.length).map((n): Param => ({ id: nextId(this.ids), pattern: { id: nextId(this.ids), kind: "ident", name: `_ ${n}`, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, ...at }));
      callback = this.rewrites.replace(callback, { ...callback, params: [...callback.params, ...unnamed] });
    }
    // std lends a predicate even a value that copies; a function taking the copy reads it there.
    if (callback.kind === "arrow" && lent && this.typing.isCopy(yields) && this.presetParams.get(callback.params[0]!) === yields) this.presetParams.delete(callback.params[0]!);
    this.expect(callback, this.typing.functionType(names, params, "void"));
    const called = this.value(callback);
    const c = this.recOf(called);
    this.ctx.exprsState.once.add(callback);
    if (c?.kind !== "closure") throw new CompileError("E0506", `'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    c.params.forEach((p, i) => this.passedExactly(name, params[i]!, p, callback.kind === "arrow" ? callback.params[i] : undefined, callback, i !== params.length - 1));
    this.runsOften(called as ClosureType, name, "its callback once per value", callback);
    const gives = c.returns;
    if (lent && gives !== "boolean") {
      throw new CompileError("E0506", `'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
    }
    if (acc && !this.typing.fits(gives, acc)) throw new CompileError("E0506", `'${name}''s callback gives the next accumulator, a '${this.typing.show(acc)}', but this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || this.typing.holdsRef(gives))) throw new CompileError("E0506", `'map''s callback has to give a value to keep, not '${this.typing.show(gives)}'`, callback.start, callback.end);
    let target = GENERATOR_HELPERS[name]!;
    if (name === "flatMap") {
      if (this.typing.yieldsOf(this.typing.lower(gives)) !== undefined) target = "iter flat map generator";
      else if (!this.isArray(this.typing.lower(gives))) throw new CompileError("E0506", `'flatMap''s callback gives a generator or an array for each value, whose values make up the result; this one gives '${this.typing.show(gives)}'`, callback.start, callback.end);
      else this.clonable(this.typing.rec(this.typing.lower(gives) as ArrayType).element, callback, "flatMap");
    }
    if (reducing && !init) {
      // std gives the fold in a one-element tuple, or nothing when the generator was empty.
      const folded = unwrap(helper("iter reduce first", [source, callback]), "reduce of empty generator with no initial value");
      return { type: this.typeOf(this.rewrites.replace(e, { id: 0, kind: "index", object: folded, index: { id: nextId(this.ids), kind: "int", value: 0n, ...at }, optional: false, ...at })), what: "'reduce'" };
    }
    return this.call(this.rewrites.replace(e, helper(target, init ? [source, callback, init] : [source, callback])) as Call);
  }

  // Whether an expression is an index into an array, a place inside it.
  private element(e: Expr): e is Extract<Expr, { kind: "index" }> {
    e = this.rewrites.current(e);
    if (e.kind !== "index") return false;
    const object = this.types.get(e.object);
    const held = object !== undefined && (this.isRefType(object) ? this.typing.rec(object).to : object);
    return held !== false && (this.isArray(held) || this.isFixed(held));
  }

  // A string read where a string's property or method is used: a literal becomes its string,
  // and a reference is read through. In an optional chain, the chain reads the Option.
  /** @throws {CompileError} */
  private text(this: Mut<this>, object: Expr, type: Type, chained: boolean) {
    if (chained && type !== "string") throw unsupported("optional chains on string literal types", object);
    const held = this.types.get(object);
    if (held && this.isRefType(held)) this.coercions.set(object, "string");
    else if (type !== "string" && !chained) this.coerce(object, type, "string", "");
  }

  // A member of a data-carrying enum: a variant, read on its own only when it holds nothing.
  // A generic enum's type arguments come from those written, then from the payload, then from
  // the type expected where the value goes.
  /** @throws {CompileError} */
  private variant(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, named: EnumInfo, alone: boolean, given: Type[] = [], typeArgs: TypeNode[] = []): VariantType {
    const data = named.data!;
    const member = data.members.find((m) => m.name === e.name);
    if (!member) throw new CompileError("E0502", `property '${e.name}' does not exist on enum '${data.name}'${didYouMean(e.name, data.members.map((m) => m.name))}`, e.start, e.end);
    if (typeArgs.length > 0 && typeArgs.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError("E0707", `enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, e.start, e.end);
    }
    const bindings = new Map<string, Type>();
    const expected = typeArgs.length > 0 ? undefined : this.expectedVariant(e, named, given);
    if (typeArgs.length > 0) data.params.forEach((p, i) => bindings.set(p, this.ctx.resolveType(typeArgs[i]!)));
    else if (expected) data.params.forEach((p, i) => bindings.set(p, this.typing.rec(expected).args[i]!));
    else {
      const names = new Set(data.params);
      (member.payload ?? []).forEach((node, i) => given[i] && infer(this.ctx.tables, node, this.typing.widenLet(given[i]!), names, bindings, e));
    }
    const missing = data.params.find((p) => !bindings.has(p));
    if (missing) {
      throw new CompileError("E0104", `can't tell what '${missing}' is for '${data.name}.${e.name}'; give it a declared type, like 'const x: ${data.name}<${data.params.join(", ")}> = ...' with real types`, e.start, e.end);
    }
    const found = this.ctx.enumInstance(named, data.params.map((p) => bindings.get(p)!), e).variants.get(e.name)!;
    if (alone && this.typing.rec(found).fields.length > 0) throw new CompileError("E0503", `'${this.typing.rec(found).name}' holds ${this.typing.rec(found).fields.length === 1 ? "a value" : "values"}; build it with '${this.typing.rec(found).name}(...)'`, e.start, e.end);
    if (!alone && this.typing.rec(found).fields.length === 0) throw new CompileError("E0503", `'${this.typing.rec(found).name}' holds nothing, so it isn't called; write '${this.typing.rec(found).name}'`, e.start, e.end);
    return found;
  }

  // The variant of this enum the type expected here holds: of the instances it names, one whose
  // fields the payload fits, if it is given, or else the first.
  /** @throws {CompileError} */
  private expectedVariant(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, named: EnumInfo, given?: Type[]): VariantType | undefined {
    const want = this.ctx.exprsState.wanted.get(e);
    const wr = this.recOf(want);
    const members = want === undefined ? [] : wr?.kind === "union" ? wr.members : [want];
    const candidates = members.flatMap((t) => {
      const m = this.recOf(t);
      if (m?.kind !== "variant" || m.enum !== named.data!.name) return [];
      const v = this.ctx.enumInstance(named, m.args, e).variants.get(e.name);
      return v ? [v] : [];
    });
    // A payload that fits exactly decides first; then a number takes a number type of its own
    // kind, an integer an integer type and a float a float type.
    const suits = (exact: boolean) => (v: VariantType) => this.typing.rec(v).fields.every((f, i) => {
      const g = given?.[i];
      if (g === undefined || this.typing.fits(g, f.type)) return true;
      return !exact && isNumeric(g) && isNumeric(f.type) && isFloat(g) === isFloat(f.type);
    });
    return (given && (candidates.find(suits(true)) ?? candidates.find(suits(false)))) ?? candidates[0];
  }

  // Whether `x.clone()` is the compiler's copy: for any value whose class doesn't declare a
  // `clone` method of its own. A base's `clone` makes a base, so it doesn't count.
  /** @throws {CompileError} */
  private copies(this: Mut<this>, t: Type): boolean {
    if (typeof t === "string") return true;
    const r = this.typing.rec(t);
    if (r.kind === "literal" || r.kind === "pattern") return true;
    // A generator's frame may hold a view into what it iterates, which a copy would share.
    if (r.kind === "generator") return false;
    if (r.kind === "class") return !this.ctx.classOf(t as ClassType).methods.has("clone");
    const bound = this.recOf(r.kind === "param" ? r.bound : r.kind === "interface" ? t : undefined);
    return !bound || bound.kind !== "interface" || !bound.methods.some((m) => m.name === "clone");
  }

  // The compiler's copy of a value, or in an instance, the concrete class's own `clone()`.
  /** @throws {CompileError} */
  private cloned(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    if (e.args.length > 0 || e.typeArgs.length > 0) throw new CompileError("E0213", "'clone' takes no arguments", e.start, e.end);
    const stored = this.typing.lower(receiver);
    // A generator runs once, through its frame, so there is no second one to make.
    const sr = this.recOf(stored);
    if (sr?.kind === "generator") throw new CompileError("E0213", "a generator can't be cloned: it runs once, and a copy would share its place in the run", e.start, e.end);
    // A copy of a value holding references borrows what it does.
    if (this.typing.holdsRef(receiver)) this.borrowsFrom.set(e, [callee.object]);
    if (stored !== receiver && sr?.kind === "class" && this.ctx.classOf(stored as ClassType).methods.has("clone")) {
      return { type: this.concreteMethod(e, callee, stored as ClassType, receiver), what: "'clone'" };
    }
    this.clonable(receiver, e);
    // A clone of what a recursive type's block holds is a value of its own.
    return { type: this.typing.unfold(receiver), what: "'clone'" };
  }

  // Refuses a value that can't be cloned, for `clone()` and for the array methods that give
  // clones of elements, named by `by`; `dyns` copies Dyns one by one, as those methods do.
  /** @throws {CompileError} */
  private clonable(this: Mut<this>, type: Type, at: Span, by?: string, dyns: boolean = by !== undefined) {
    const stored = this.typing.lower(type);
    const say = (why: string) => new CompileError("E0213", by ? `'${by}' gives clones of the array's elements, and ${why}` : why, at.start, at.end);
    const permit = this.typing.holdsPart(stored, (u) => {
      const r = this.recOf(u);
      return r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit");
    });
    if (permit) throw say("can't clone a 'Semaphore' or a 'Permit', or a value holding one: a semaphore's slots are counted, so share it inside a shared value or a class instead");
    let rust: ClassType | undefined;
    const behind = this.isRefType(stored) ? this.typing.rec(stored as RefType).to : stored;
    this.typing.holdsPart(behind, (u) => (rustClassOf(this.typing, u) ? ((rust = u as ClassType), true) : false));
    if (rust) {
      const name = rustClassOf(this.typing, rust)!.name;
      if (this.ctx.classOf(rust).methods.has("clone")) throw say(`can't clone a value holding a Rust '${name}' as a whole; clone each '${name}' with its 'clone()'`);
      throw say(`can't clone a Rust '${name}'${rustClassOf(this.typing, behind) ? "" : ", or a value holding one,"} unless its class declares 'clone(): ${name}', which calls its Clone`);
    }
    // An array method's copy of a Dyn may panic, which unwinds as a Dyn's own copy does; only
    // `clone()` written on a value holding one asks for its Dyns to be cloned one by one.
    if (!dyns && (typeof stored === "string" || this.typing.rec(stored).kind !== "dyn") && this.typing.holdsPart(stored, (u) => typeof u !== "string" && this.typing.rec(u).kind === "dyn")) throw say("can't clone a value holding a Dyn, whose clone may fail at run time; clone its Dyns one by one");
    const inner = this.typing.holdsInterior(stored);
    if (inner) throw say(`can't clone ${inner === stored ? "" : "a value holding "}${article(this.typing.rec(inner as InteriorType).which)}, which is changed in place wherever it is shared; make a new one from what it holds`);
    if (this.typing.holdsHandle(stored)) throw say("can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself");
    // Its value is given once, so a copy awaited after the first would find nothing to give.
    if (this.typing.holdsPart(stored, (u) => {
      const r = this.recOf(u);
      return r?.kind === "future" && r.name.startsWith("promise await");
    })) throw say("can't clone a Promise made with 'new Promise', or a value holding one: its value is given once, to one await; await it once and share the value");
    // Two mutable references to one thing can't be.
    if (this.typing.holdsMut(type)) throw say("can't clone a value holding a mutable reference ('Mut'), since the copy would change the same thing");
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  /** @throws {CompileError} */
  private receiverType(this: Mut<this>, callee: Extract<Expr, { kind: "member" }>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !this.ctx.lookup(object.name) && (this.classes.has(object.name) || this.ctx.definedClass(object.name) || this.enums.has(object.name)))) return undefined;
    if (object.kind === "ident") this.ctx.exprsState.objects.add(object);
    const type = this.linked(callee) ? this.unwrapped(object, callee.optional) : this.value(object);
    // A method called through a reference gets the pointer itself.
    const r = this.recOf(type);
    return this.typing.unfold(r?.kind === "ref" ? r.to : this.plainOf(type));
  }

  // Whether a field read or method call is a link of an optional chain: written `?.`, or after
  // one in the same chain. Such a link reads what the Option holds, and gives an Option, empty
  // when the chain was.
  private linked(e: Extract<Expr, { kind: "member" }>): boolean {
    return e.optional || this.chained(e.object);
  }

  private chained(e: Expr): boolean {
    e = this.rewrites.current(e);
    for (let x = e; x.kind === "member" || x.kind === "call"; x = x.kind === "member" ? x.object : x.callee) {
      if (x.kind === "member" && x.optional) return true;
    }
    return false;
  }

  // What a link of an optional chain gives: an Option of what it reads.
  /** @throws {CompileError} */
  private optional(t: Type, at: Expr): Type {
    if (this.typing.holdsRef(t) && !this.isRefType(t)) throw unsupported("Options holding references", at);
    return this.typing.unionType([t, "null"]);
  }

  // The object a link reads, as what its Option holds.
  /** @throws {CompileError} */
  private unwrapped(this: Mut<this>, object: Expr, written: boolean): Type {
    const option = this.value(object);
    if (!this.typing.isOption(option)) {
      if (written) throw new CompileError("E0108", `'?.' reads through an Option, and this is a '${this.typing.show(option)}', which is never empty; use '.'`, object.start, object.end);
      return option;
    }
    const inner = this.held(option);
    this.coercions.set(object, inner);
    return inner;
  }

  // A method of an interface, called while checking a generic body at its definition on a
  // value of a type parameter bounded by it, or of an interface a call returned. Each
  // instance resolves the call to its concrete type's method.
  /** @throws {CompileError} */
  private traitCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: ParamType | InterfaceType): { type: Type; what: string } {
    const r = this.typing.rec(receiver);
    const trait = this.recOf(r.kind === "param" ? r.bound : receiver);
    const found = trait?.kind === "interface" ? trait.methods.find((m) => m.name === callee.name) : undefined;
    if (!found) throw new CompileError("E0502", `property '${shownName(callee.name)}' does not exist on type '${r.name}'${didYouMean(callee.name, this.memberNames(receiver))}`, callee.start, callee.end);
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
      this.coerce(a, type, found.params[i]!, `argument of type '${this.typing.show(type)}' is not assignable to parameter of type '${this.typing.show(found.params[i]!)}'`);
    });
    // A reference an interface's method returns borrows from its receiver, as may the future a
    // `Promise<T>` describes, which in the definition is checked as one borrowing it.
    const promised = this.typing.promiseElement(found.returns);
    if (this.typing.holdsRef(found.returns) || promised !== undefined) this.borrowsFrom.set(e, [callee.object, ...e.args.filter((a) => this.lends(a))]);
    if (!absent && typeof stored !== "string" && this.recOf(stored)?.kind === "class") return { type: this.concreteMethod(e, callee, stored as ClassType, found.returns, found.throws), what: `'${callee.name}'` };
    if (!absent && found.throws && promised === undefined) this.ctx.raise(e, found.throws, `'${callee.name}'`);
    return { type: promised !== undefined ? this.typing.lentPromise(promised) : found.returns, what: `'${callee.name}'` };
  }

  // Whether an instance's concrete type for a type parameter leaves out a method: an object,
  // or a class without it.
  /** @throws {CompileError} */
  private lacks(stored: Type | undefined, name: string): boolean {
    return stored !== undefined && (this.recOf(stored)?.kind !== "class" || !inherited(this.arenas, this.ctx.classOf(stored as ClassType), "methods", name));
  }

  // `h.m !== undefined`, `h.m === null` or `typeof h.m === "function"` on an interface's optional
  // method tests whether the value's type has it; read any other way, a method is called.
  /** @throws {CompileError} */
  private presence(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): boolean {
    if (e.op !== "===" && e.op !== "!==") return false;
    const test = typeofTest(e);
    const empty = (x: Expr) => isEmpty(x, this.locals as NodeMap<Expr, LocalId>);
    const named = test?.name.kind === "string" ? test.name.value : undefined;
    if (test && named !== "function" && named !== "undefined") return false;
    if (!test && !empty(e.left) && !empty(e.right)) return false;
    const member = this.rewrites.current(test ? test.operand : empty(e.right) ? e.left : e.right);
    if (member.kind !== "member" || member.optional || this.chained(member.object)) return false;
    // A class's or an enum's name reads a static, not a method.
    if (member.object.kind === "ident" && !this.ctx.lookup(member.object.name)) return false;
    if (member.object.kind === "ident") this.ctx.exprsState.objects.add(member.object);
    const object = this.value(member.object);
    const r = this.recOf(object);
    const t = this.typing.unfold(r?.kind === "ref" ? r.to : this.plainOf(object));
    const held = this.recOf(t);
    const trait = this.recOf(held?.kind === "dyn" ? held.of : held?.kind === "param" ? held.bound : t);
    const m = trait?.kind === "interface" ? trait.methods.find((x) => x.name === member.name) : undefined;
    if (!m?.omittable) {
      this.ctx.exprsState.once.add(member.object);
      return false;
    }
    // A Dyn's table has no slot for a method no Dyn can call, so it can't say whether one is there.
    if (held?.kind === "dyn" && (m.generic || (this.recOf(m.returns)?.kind === "interface" && this.typing.promiseElement(m.returns) === undefined))) {
      throw new CompileError("E0211", `'${m.name}' can't be called through a Dyn, ${m.generic ? "being generic" : "returning an interface type"}, so a Dyn can't tell whether it is there; take a type parameter bounded by '${(trait as { name: string }).name}' instead`, member.start, member.end);
    }
    const when = test ? (e.op === "===") === (named === "function") : e.op === "!==";
    this.presenceTests.set(e, { object: member.object, name: member.name, when });
    if (held?.kind === "param" && this.lacks(held.concrete, member.name)) (this.ctx.instance.absent ??= new NodeSet()).add(e);
    return true;
  }

  // `h.m?.()` calls only an optional method, which a plain call may call only where a check
  // found it there.
  /** @throws {CompileError} */
  private omittableCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, m: Method, shown: string) {
    if (!e.optional) {
      if (m.omittable && !this.ctx.present(callee.object, m.name)) throw new CompileError("E0108", `'${m.name}' may be missing, since '${shown}' declares it optional; call it as '${this.placeText(callee)}?.()', or check '${this.placeText(callee)} !== undefined' first`, callee.start, callee.end);
      return;
    }
    if (!m.omittable) throw new CompileError("E0505", `'${m.name}' is always there in '${shown}', so it is called without '?.'`, e.start, e.end);
    if (this.linked(callee)) throw unsupported("optional calls in an optional chain", e);
    if (m.owned) throw unsupported("optional calls of methods taking their object over", e);
    if (this.typing.promiseElement(m.returns) !== undefined) throw unsupported("optional calls of methods giving a Promise", e);
    this.optionalCalls.add(e);
  }

  // In an instance, a call through a type parameter runs its concrete class's method. An
  // interface it returns is, as for any call, the one concrete type the method returns.
  /** @throws {CompileError} */
  private concreteMethod(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, c: ClassType, returns: Type, declaredThrows?: Type): Type {
    const target = inherited(this.arenas, this.ctx.classOf(c), "methods", callee.name)!;
    if (target.self!.owned) this.takesOver(callee.object, callee.name);
    else if (target.self!.mutable) this.mutates(callee.object, callee.name);
    const instance = this.ctx.instantiate(target, e.typeArgs, e.args, e.args.map((a) => this.coercions.get(a) ?? this.types.get(a)!), e);
    this.calls.set(e, instance.id);
    if (declaredThrows && !target.async && this.typing.promiseElement(returns) === undefined) this.ctx.raise(e, declaredThrows, `'${callee.name}'`);
    const error = this.ctx.errorOf(instance);
    if (error && error !== declaredThrows && !target.async) this.ctx.raise(e, error, `'${callee.name}'`);
    const r = this.recOf(returns);
    if (r?.kind !== "interface") return returns;
    return this.typing.wrapped(r.name, returns as InterfaceType, this.typing.lower(this.ctx.returnOf(instance, e)));
  }

  // An owning method takes its object over, which can't happen through a borrow.
  /** @throws {CompileError} */
  private takesOver(object: Expr, name: string) {
    const type = this.types.get(object);
    if (typeof type !== "string" && type !== undefined && this.typing.rec(type).kind === "ref") {
      throw new CompileError("E0202", `can't call '${name}' through the reference '${this.placeText(object)}': it takes its object over, and a reference only borrows it; call it on the value itself`, object.start, object.end);
    }
    if ((object.kind === "this" || object.kind === "super") && !this.self?.owned) {
      throw new CompileError("E0202", `can't call '${name}' on 'this' here: it takes its object over, and this method only borrows 'this'; declare 'this: Own<this>' to give it away`, object.start, object.end);
    }
  }

  // A mutating method's receiver must be a place that could change, or a temporary.
  /** @throws {CompileError} */
  private mutates(this: Mut<this>, object: Expr, name: string) {
    const type = this.types.get(object);
    if (typeof type !== "string" && type !== undefined && this.typing.rec(type).kind === "ref" && !this.typing.rec(type as RefType).mutable) {
      throw new CompileError("E0206", `cannot call '${name}' on '${this.placeText(object)}' because it is a shared reference ('Ref'), which only reads`, object.start, object.end);
    }
    if (object.kind === "conditional") {
      throw new CompileError("E0212", `can't call '${name}' on a '?:', which would change a copy; call it in each branch`, object.start, object.end);
    }
    // `x!` gives a copy of what x holds, which a change wouldn't reach.
    const through = this.copied(object);
    if (through) throw new CompileError("E0212", `can't call '${name}' through '${through}', which would change a copy; check '!== null' first, or call it with '?.'`, object.start, object.end);
    if (this.readCopy(object)) throw new CompileError("E0211", `'${name}' changes its object, and this one is read through a Dyn, which gives a copy; change it through a method`, object.start, object.end);
    intoMember(this.typing, object, this.types, `call '${name}' on`);
    if (this.place(object)) this.changeable(object, `call '${name}' on`);
  }

  // The `!` or `??` a place is read through, if any, which gives a copy of what the place holds,
  // so a change through it would be lost. A temporary has no place to change.
  private copied(this: Mut<this>, e: Expr, through?: string): string | undefined {
    e = this.rewrites.current(e);
    switch (e.kind) {
      // A getter's result is a temporary.
      case "member":
        return this.calls.has(e) ? undefined : this.copied(e.object, through);
      case "nonNull":
        return this.copied(e.expr, redundantBang(e) ? through : "!");
      case "as": {
        const [from, to] = [this.coercions.get(e.expr) ?? this.types.get(e.expr), this.types.get(e)];
        const narrows = from !== undefined && to !== undefined && this.recOf(from)?.kind === "union" && !this.typing.fits(from, to);
        return this.copied(e.expr, narrows ? "as" : through);
      }
      case "binary":
        return e.op === "??" ? (this.copied(e.left, "??") ?? this.copied(e.right, "??")) : undefined;
      case "conditional":
        return (this.types.has(e.then) ? this.copied(e.then, through) : undefined) ?? (this.types.has(e.else) ? this.copied(e.else, through) : undefined);
      case "this":
        return through;
      case "ident":
        return through && this.ctx.lookup(e.name) ? through : undefined;
      default:
        return undefined;
    }
  }

  // A class's static property, `C.x`: a `static readonly` field, the const `C.x`, or a static
  // accessor, the static methods `get x` and `set x`. Reads and writes of one are rewritten in
  // place into a read of that const or a call of those methods, forms the rest of the compiler knows.
  
  // The nearest class declaring `x` decides what it is, as in TypeScript: a class declaring only
  // a setter hides its base's getter.
  private staticProperty(this: Mut<this>, e: Expr): Static | undefined {
    if (e.kind !== "member" || e.optional || e.object.kind !== "ident" || this.ctx.lookup(e.object.name)) return undefined;
    const c = this.arenas.classOf(this.classes.get(e.object.name));
    return c && this.staticOf(c, e.name);
  }

  private staticOf(c: ClassInfo, name: string): Static | undefined {
    for (let b: ClassInfo | undefined = c; b; b = this.arenas.classOf(b.base)) {
      const field = b.staticFields.get(name);
      if (field) return { field, declaring: b };
      const getter = this.arenas.bodyOf(b.statics.get(`get ${name}`));
      const setter = this.arenas.bodyOf(b.statics.get(`set ${name}`));
      if (getter || setter) return { getter, setter, declaring: b };
    }
    return undefined;
  }

  // The class, or the base it extends, holding the Map or Set its `extends` names.
  /** @throws {CompileError} */
  private embeddedOf(t: Type | undefined): ClassInfo | undefined {
    if (t === undefined || this.recOf(t)?.kind !== "class") return undefined;
    for (let b: ClassInfo | undefined = this.ctx.classOf(t as ClassType); b; b = this.arenas.classOf(b.base)) if (b.embedded) return b;
    return undefined;
  }

  // Whether `name` on a class reaches the Map or Set it embeds: neither it nor its bases declare it.
  // Only the collection's own members are: `clone`, `equals` and the like stay the class's.
  /** @throws {CompileError} */
  private delegated(t: Type | undefined, name: string): boolean {
    const embedding = this.embeddedOf(t);
    if (!embedding || !collectionMember(embedding, name)) return false;
    const c = this.ctx.classOf(t as ClassType);
    return !this.typing.field(t as ClassType, name) && !(["methods", "getters", "setters"] as const).some((table) => inherited(this.arenas, c, table, name));
  }

  // Whether `super.name` reaches the embedded Map or Set: no base between declares it.
  /** @throws {CompileError} */
  private superDelegated(name: string): boolean {
    const self = this.self?.type;
    const embedding = self && this.embeddedOf(self);
    if (!embedding || !collectionMember(embedding, name)) return false;
    const base = this.arenas.classOf(this.ctx.classOf(self).base);
    return !base || !(this.typing.field(base.type, name) || (["methods", "getters", "setters"] as const).some((table) => inherited(this.arenas, base, table, name)));
  }

  // `x.name` as `x`'s embedded collection's `name`; `super.name` as `this`'s.
  private throughEmbedded(e: Extract<Expr, { kind: "member" }>): Extract<Expr, { kind: "member" }> {
    const at = { start: e.object.start, end: e.object.end };
    const object: Expr = e.object.kind === "super" ? { id: nextId(this.ids), kind: "this", ...at } : e.object;
    return { ...e, id: nextId(this.ids), object: { id: nextId(this.ids), kind: "member", object, name: EMBEDDED, optional: false, ...at } };
  }

  // Replaces `e` with `to`, keeping its own span and id.
  private become(e: Expr, to: Expr): Expr {
    return this.rewrites.replace(e, { ...to, start: e.start, end: e.end });
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
    return this.recOf(held)?.kind === "map" && this.typing.rec(held as MapType).dict ? held as MapType : undefined;
  }

  // `e`, a dictionary's read, write, delete or key test, become the call of its Map method.
  private dictCall(e: Expr, object: Expr, name: string, args: Expr[]): Call {
    const call = this.become(e, this.dictMethod(object, name, args, e)) as Call;
    this.dictCalls.add(call);
    return call;
  }

  private dictMethod(object: Expr, name: string, args: Expr[], at: Span): Call {
    const call: Call = { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object, name, optional: false, start: at.start, end: at.end }, args, typeArgs: [], optional: false, start: at.start, end: at.end };
    this.dictCalls.add(call);
    return call;
  }

  // `o[k]` or `o.k` on a dictionary, being written or deleted: its object, checked, and its key.
  /** @throws {CompileError} */
  private dictEntry(this: Mut<this>, written: Expr): { place: Expr; object: Expr; key: Expr } | undefined {
    const place = this.bare(written);
    if ((place.kind !== "index" && place.kind !== "member") || place.optional) return undefined;
    // A name that isn't a variable may be a class or an enum, which the write's own check reads.
    if (place.object.kind === "ident" && !this.ctx.lookup(place.object.name)) return undefined;
    if (place.object.kind === "ident") this.ctx.exprsState.objects.add(place.object);
    const t = this.value(place.object);
    this.ctx.exprsState.once.add(place.object);
    if (!this.dictOf(t)) return undefined;
    const key: Expr = place.kind === "index" ? this.dictKey(place.index) : { id: nextId(this.ids), kind: "string", value: place.name, start: place.start, end: place.end };
    return { place, object: place.object, key };
  }

  // A dictionary's key, checked to be a string where it is written.
  /** @throws {CompileError} */
  private dictKey(this: Mut<this>, key: Expr): Expr {
    const t = this.value(key);
    this.coerce(key, t, "string", `a dictionary's keys are strings, not '${this.typing.show(t)}'`);
    this.ctx.exprsState.once.add(key);
    return key;
  }

  // `source[Symbol.iterator]()`, when `held` is a class with that method: what iterating it runs.
  /** @throws {CompileError} */
  iteratorCall(this: Mut<this>, source: Expr, held: Type): Expr | undefined {
    const t = this.typing.lower(held);
    const r = this.recOf(t);
    // A parameter of an interface declaring the method has it in every instance.
    const bound = r?.kind === "param" && this.typing.iterableElement(t) === undefined ? this.recOf(r.bound) : undefined;
    const has = r?.kind === "class" ? inherited(this.arenas, this.ctx.classOf(t as ClassType), "methods", ITERATOR) !== undefined : bound?.kind === "interface" && bound.methods.some((m) => m.name === ITERATOR);
    if (!has) return undefined;
    const at = { start: source.start, end: source.end };
    return { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: source, name: ITERATOR, optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
  }

  // The Map or Set a class extending one embeds, which iterating the class iterates unless the
  // class declares its own `[Symbol.iterator]`.
  /** @throws {CompileError} */
  embeddedIterated(source: Expr, held: Type): Expr | undefined {
    const t = this.typing.lower(held);
    if (!this.embeddedOf(t) || inherited(this.arenas, this.ctx.classOf(t as ClassType), "methods", ITERATOR)) return undefined;
    return { id: nextId(this.ids), kind: "member", object: source, name: EMBEDDED, optional: false, start: source.start, end: source.end };
  }

  // A dictionary isn't iterable, as a plain object isn't in JavaScript.
  notIterable(at: Span): CompileError {
    return new CompileError("E0119", "a dictionary can't be looped over or spread, as a plain object can't; use 'Object.keys', 'Object.values' or 'Object.entries'", at.start, at.end);
  }

  // Why a dictionary's entry can't be updated in place.
  private dictWrite(place: Expr): CompileError {
    return new CompileError("E0801", `a dictionary's entry is read as an Option, so it isn't updated in place; read it, then write it back, as in '${this.placeText(place)} = (${this.placeText(place)} ?? 0) + 1'`, place.start, place.end);
  }

  // `o[k]` on a dictionary reads the entry under k as an Option, as the Map's `get` does.
  /** @throws {CompileError} */
  private undict(this: Mut<this>, e: Expr): boolean {
    e = this.rewrites.current(e);
    if (e.kind !== "index") return false;
    const through = this.value(e.object);
    this.ctx.exprsState.once.add(e.object);
    if (!this.dictOf(through)) return false;
    if (e.optional) throw unsupported("optional index expressions", e);
    if (this.ctx.exprsState.writing === e) throw this.dictWrite(e);
    this.dictCall(e, e.object, "get", [this.dictKey(e.index)]);
    return true;
  }

  /** @throws {CompileError} */
  private staticRead(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, found: Static): Expr {
    const at = { start: e.start, end: e.end };
    if (found.field) {
      this.visible(found.field.access, found.declaring!.type, e.name, e);
      return { id: nextId(this.ids), kind: "ident", name: `${this.typing.rec(found.declaring!.type).name}.${e.name}`, ...at };
    }
    if (!found.getter) {
      const base = this.arenas.classOf(found.declaring.base);
      const hidden = base && this.staticOf(base, e.name)?.getter;
      throw new CompileError("E0208", hidden ? `'${this.typing.rec(found.declaring.type).name}' declares only a setter for '${e.name}', which hides the getter of its base; declare a getter in '${this.typing.rec(found.declaring.type).name}' too` : `property '${e.name}' has a setter but no getter`, e.start, e.end);
    }
    this.visible(found.getter.access, found.declaring.type, e.name, e);
    return this.staticCall(e, "get", []);
  }

  private staticCall(e: Extract<Expr, { kind: "member" }>, kind: "get" | "set", args: Expr[]): Expr {
    const at = { start: e.start, end: e.end };
    return { id: nextId(this.ids), kind: "call", callee: { id: nextId(this.ids), kind: "member", object: e.object, name: `${kind} ${e.name}`, optional: false, ...at }, typeArgs: [], args, optional: false, ...at };
  }

  // `C.x = v`, `C.x += v` and `C.x++` on a static setter call it with the value to store. Whether
  // the write was rewritten.
  /** @throws {CompileError} */
  private staticWrite(this: Mut<this>, e: Extract<Expr, { kind: "assign" | "update" }>): boolean {
    const target = e.kind === "assign" ? e.target : e.operand;
    const found = this.staticProperty(target);
    if (!found) return false;
    const member = target as Extract<Expr, { kind: "member" }>;
    if (!found.setter) throw new CompileError("E0208", `cannot assign to '${member.name}' because it is a read-only property`, member.start, member.end);
    this.visible(found.setter.access, found.declaring.type, member.name, member);
    const op = e.kind === "update" ? (e.op === "++" ? "+" : "-") : ASSIGNMENTS[e.op];
    if (!op) throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
    const at = { start: e.start, end: e.end };
    const right: Expr = e.kind === "update" ? { id: nextId(this.ids), kind: "int", value: 1n, ...at } : e.value;
    const given: Expr = op === "=" ? right : { id: nextId(this.ids), kind: "binary", op, left: this.staticRead(member, found), right, ...at };
    this.become(e, this.staticCall(member, "set", [given]));
    return true;
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  /** @throws {CompileError} */
  private method(this: Mut<this>, callee: Extract<Expr, { kind: "member" }>, receiver: Type | undefined): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !this.ctx.lookup(object.name) ? (this.arenas.classOf(this.classes.get(object.name)) ?? this.ctx.definedClass(object.name)) : undefined;
    if (named) {
      const found = inherited(this.arenas, named, "statics", name);
      const property = found ? undefined : this.staticOf(named, name);
      if (property) throw new CompileError("E0706", `'${name}' is a static ${property.field ? "field" : "accessor"} of '${this.typing.rec(property.declaring.type).name}', not a method; read it as '${this.typing.rec(named.type).name}.${name}'`, callee.start, callee.end);
      if (!found) throw new CompileError("E0502", `property '${name}' does not exist on type 'typeof ${this.typing.rec(named.type).name}'${didYouMean(name, this.staticNames(named))}`, callee.start, callee.end);
      this.visible(found.access, found.declared ?? found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return this.superMethod(callee);
    const type = receiver!;
    const tr = this.recOf(type);
    const found = tr?.kind === "class" ? inherited(this.arenas, this.ctx.classOf(type as ClassType), "methods", name) : undefined;
    if (!found && tr?.kind === "class" && tr.name === "RequestCookies" && this.arenas.bodyOf(this.ctx.classOf(type as ClassType).constructor).start >= STD_BASE && (name === "set" || name === "delete")) {
      throw new CompileError("E0502", `a request's cookies can't be changed, so 'RequestCookies' has no method '${name}'; ${name} the cookie on the response instead, as 'res.cookies.${name}(...)'`, callee.start, callee.end);
    }
    if (tr?.kind === "unknown") throw this.unnarrowed(callee);
    if (!found) throw new CompileError("E0502", `'${this.typing.show(type)}' has no method '${name}'${didYouMean(name, this.memberNames(type))}`, callee.start, callee.end);
    this.visible(found.access, found.declared ?? found.owner!, name, callee);
    if (found.self!.owned) this.takesOver(object, name);
    else if (found.self!.mutable) this.mutates(object, name);
    return found;
  }

  // `super.m()` runs the base's `m` on the embedded base.
  /** @throws {CompileError} */
  private superMethod(this: Mut<this>, callee: Extract<Expr, { kind: "member" }>): Body {
    // In a copy of a base's member, `super` is the base of the class it was written in.
    const base = this.recOf((this.owner && this.self && this.typing.derives(this.self.type, this.owner) ? this.owner : this.self?.type))?.base;
    if (!base) throw new CompileError("E0708", "'super' can only be used in a class that extends another", callee.start, callee.end);
    if (!this.ctx.thisReady(callee.object)) throw new CompileError("E0703", "'super' can't be used until every field is assigned", callee.object.start, callee.object.end);
    let found = inherited(this.arenas, this.ctx.classOf(base), "methods", callee.name);
    if (!found) throw new CompileError("E0502", `'${this.typing.rec(base).name}' has no method '${callee.name}'${didYouMean(callee.name, this.memberNames(base))}`, callee.start, callee.end);
    if (found.abstract) throw new CompileError("E0701", `'${callee.name}' is abstract in '${this.typing.rec(found.owner!).name}', so 'super.${callee.name}()' has nothing to run`, callee.start, callee.end);
    // A template runs as this class's own copy of it, on this class's `this`.
    const original = this.arenas.bodyOf(found.copyOf) ?? found;
    const copied = (original.template === true || selfTyped(original)) && !this.typing.rec(this.self!.type).abstract;
    if (copied) found = this.arenas.bodyOf(copyFor(this.ctx.tables, this.ctx.classOf(this.self!.type).classId, original.bodyId));
    this.visible(found.access, found.declared ?? found.owner!, callee.name, callee);
    if (found.self!.mutable && !this.self!.mutable) {
      throw new CompileError("E0206", `cannot call '${callee.name}' on 'super' because 'this' is read-only here; declare 'this: Mut<this>'`, callee.start, callee.end);
    }
    // It may change any of this object's fields, as a method called on `this` may.
    if (found.self!.mutable) this.changesThis("", `call '${callee.name}' on`, callee.object);
    this.types.set(callee.object, copied ? this.self!.type : base);
    if (found.self!.owned) this.takesOver(callee.object, callee.name);
    return found;
  }

  // Inside an abstract class's code, its copies included, `this.name` naming one of its abstract
  // members is typed by the declaration, which each implementation's result is converted to.
  /** @throws {CompileError} */
  private abstractDeclaration(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, table: "methods" | "getters"): Body | undefined {
    if (e.object.kind !== "this" || !this.recOf(this.owner)?.abstract) return undefined;
    const declared = inherited(this.arenas, this.ctx.classOf(this.owner!), table, e.name);
    return declared?.abstract ? declared : undefined;
  }

  // TypeScript's access rules: a private member is reachable only from inside its class, and
  // a protected one also from the classes that embed it.
  /** @throws {CompileError} */
  private visible(this: Mut<this>, access: Access | undefined, declaring: ClassType, name: string, at: Span) {
    // Only delegation reads the embedded collection, from wherever the class is used.
    if (name === EMBEDDED || this.accessible(access, declaring, name)) return;
    const message = name.startsWith("#")
      ? `property '${shownName(name)}' is not accessible outside class '${this.typing.rec(declaring).name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${this.typing.rec(declaring).name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError("E0709", message, at.start, at.end);
  }

  // Access is by declaration, as in TypeScript, so any two instances of one generic class share it.
  private sameClass(a: ClassType, b: ClassType): boolean {
    const g = this.typing.rec(a).generic;
    return a === b || (g !== undefined && g.name === this.typing.rec(b).generic?.name);
  }

  /** @throws {CompileError} */
  private accessible(this: Mut<this>, access: Access | undefined, declaring: ClassType, name: string): boolean {
    if (!access || access === "public" || (this.owner && this.sameClass(this.owner, declaring))) return true;
    if (access === "protected" && this.owner) for (let b: ClassType | undefined = this.typing.rec(this.owner).base; b; b = this.typing.rec(b).base) if (this.sameClass(b, declaring)) return true;
    // A base reaches a subclass's implementation of its abstract member.
    return access === "protected" && this.owner !== undefined && this.typing.derives(declaring, this.owner) && abstractIn(this.arenas, this.ctx.classOf(this.owner), name);
  }

  // The members of a type this body can reach, for suggesting one: an object's fields; a
  // class's fields, methods and accessors with its bases', those private or protected only where
  // accessible; an interface's or a Dyn's fields and methods.
  /** @throws {CompileError} */
  private memberNames(this: Mut<this>, t: Type | undefined): string[] {
    if (t === undefined || typeof t === "string") return [];
    const r = this.typing.rec(t);
    if (r.kind === "ref") return this.memberNames(r.to);
    if (r.kind === "param") return this.memberNames(r.bound);
    if (r.kind === "dyn") return this.memberNames(r.of);
    if (r.kind === "interface") return [...r.fields, ...r.methods].map((m) => m.name);
    if (r.kind === "object") return r.fields.map((f) => f.name);
    if (r.kind !== "class") return [];
    const names: string[] = [];
    for (let c: ClassInfo | undefined = this.ctx.classOf(t as ClassType); c; c = this.arenas.classOf(c.base)) {
      const declaring = c.type;
      names.push(...this.typing.rec(declaring).fields.filter((f) => this.accessible(f.access, declaring, f.name)).map((f) => shownName(f.name)));
      for (const table of [c.methods, c.getters, c.setters]) for (const [name, body] of table) if (this.accessible(this.arenas.bodyOf(body).access, declaring, name)) names.push(shownName(name));
    }
    return names;
  }

  // A class's static members, with its bases', for suggesting one.
  /** @throws {CompileError} */
  private staticNames(this: Mut<this>, c: ClassInfo): string[] {
    const names: string[] = [];
    for (let b: ClassInfo | undefined = c; b; b = this.arenas.classOf(b.base)) {
      for (const [name, body] of b.statics) if (this.accessible(this.arenas.bodyOf(body).access, b.type, name)) names.push(shownName(name.replace(/^[gs]et /, "")));
      for (const [name, f] of b.staticFields) if (this.accessible(f.access, b.type, name)) names.push(shownName(name));
    }
    return names;
  }

  // The class whose own fields include `name`: `t` itself or a base it embeds.
  private declaring(t: ClassType, name: string): ClassType {
    const { fields, base } = this.typing.rec(t);
    return fields.some((f) => f.name === name) || !base ? t : this.declaring(base, name);
  }

  /** @throws {CompileError} */
  private args(this: Mut<this>, list: Expr[], argTypes: Type[], target: Instance, at: Span) {
    // A package's function takes a callback or a Promise as its signature made it for JS, a
    // stored one JS keeps.
    if (bodyOf(this.arenas, target).js && target.concrete) this.ctx.returnOf(target, at);
    const signature = bodyOf(this.arenas, target).js && target.concrete ? target.signature : undefined;
    const params = signature && signature.length > 0 ? signature : this.ctx.paramTypes(target);
    this.arity(list.length, bodyOf(this.arenas, target).params, at);
    list.forEach((a, i) => {
      const [type, expected] = [argTypes[i]!, params[i]!];
      if (this.isRefType(expected) && this.typing.rec(expected).mutable) this.readOnlySubarray(a);
      const shown = this.defaultedArg(a, type, bodyOf(this.arenas, target).params[i]!) ?? expected;
      this.coerce(a, type, expected, `argument of type '${this.typing.show(type)}' is not assignable to parameter of type '${this.typing.show(shown)}'`);
    });
  }

  // A parameter with a default takes a value of its declared type, which this gives: leaving the
  // argument out gives the default, so a null or an Option where none is declared is refused.
  /** @throws {CompileError} */
  private defaultedArg(a: Expr, type: Type, p: Param): Type | undefined {
    const declared = this.declaredTypes.get(p);
    if (!declared || holdsNull(this.typing, declared)) return declared;
    if (holdsNull(this.typing, type)) throw new CompileError("E0108", "this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default", a.start, a.end);
    return declared;
  }

  /** @throws {CompileError} */
  value(this: Mut<this>, written: Expr): Type {
    const e = this.keyed(this.rewrites.current(written));
    if (this.ctx.exprsState.once.delete(e)) return this.types.get(e)!;
    const type = this.typeOf(e);
    // An abstract class's code sees `this` as the abstract class, which exists only embedded in
    // a subclass, so a value of that type, such as `this.clone()`, can't be made there.
    if (this.recOf(this.owner)?.abstract && type === this.owner && e.kind !== "this" && e.kind !== "super") {
      throw new CompileError("E0701", `this would make a value of the abstract class '${this.typing.rec(this.owner).name}', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there`, e.start, e.end);
    }
    this.types.set(e, type);
    return type;
  }

  // An object literal with computed keys, as the same literal with each key's name written.
  /** @throws {CompileError} */
  private keyed(this: Mut<this>, e: Expr): Expr {
    if (e.kind !== "object" || e.props.every((p) => !("key" in p) || typeof p.key === "string")) return e;
    const props = e.props.map((p) => ("key" in p && typeof p.key !== "string" ? this.rewrites.replaceObjectProp(p, { ...p, key: this.knownKey(p.key) }) : p));
    return this.rewrites.replace(e, { ...e, props });
  }

  // The name a computed key gives: a literal's, or one a const, an `as const` value or an enum
  // member holds, as its literal type says.
  /** @throws {CompileError} */
  knownKey(this: Mut<this>, key: Expr): string {
    return knownKey(key, (leaf) => {
      const t = this.value(leaf);
      const r = this.recOf(t);
      if (r?.kind === "literal") return String(r.value);
      // A const holding a number is typed by its number type, so its name comes from its value.
      const local = leaf.kind === "ident" ? this.ctx.lookup(leaf.name) : undefined;
      const number = local && this.ctx.tables.numberKeys.get(local.localId);
      if (number !== undefined) return number;
      if (leaf.kind === "ident" && !local && isNumeric(t) && this.ctx.tables.topKeys) return this.ctx.tables.topKeys(leaf);
      throw unknownKey(leaf, `this is a '${this.typing.show(t)}'`);
    });
  }

  /** @throws {CompileError} */
  private typeOf(this: Mut<this>, e: Expr): Type {
    switch (e.kind) {
      // A literal is an i64 unless where it is written gives it another number type.
      case "int":
        if (e.value > I64_MAX) this.ctx.exprsState.oversized.push(e);
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
        if (!this.typing.fits(t, wanted)) throw new CompileError("E0101", `type '${this.typing.show(t)}' does not satisfy the expected type '${this.typing.show(wanted)}'`, e.expr.start, e.expr.end);
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
        if (narrows) return this.narrowedReturn(e.expr, narrows);
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
        if (nested) {
          this.nestedEnv(e, nested, e);
          return nested.type;
        }
        const local = this.ctx.lookup(e.name, e);
        // A generic arrow a const holds, as a value, is the function it was lifted to.
        if (local?.generic) return this.typeOf(this.rewrites.replace(e, { ...e, name: local.generic.name }));
        if (!local && e.name === "undefined") return "null";
        // A package's const, read from JS.
        const jsConst = local ? undefined : this.bodyNamed(e.name);
        if (jsConst?.js?.const) {
          const type = this.typing.jsView(this.ctx.resolveType(jsConst.returnType!));
          if (this.typing.jsConverts(type)) this.jsExports.set(e, jsConst.js);
          else this.jsUses.push(e);
          return type;
        }
        // A top-level const: its value, computed while compiling. An aggregate is read where it
        // lives, through a reference, as a const can't change.
        const constant = local ? undefined : this.bodyNamed(`const ${e.name}`);
        if (constant) {
          const instance = this.ctx.instanceOf(constant);
          this.calls.set(e, instance.id);
          const type = this.ctx.returnOf(instance, e);
          return this.typing.isCopy(type) || type === "string" ? type : this.typing.refType(type, false);
        }
        // A declared function named as a value is a closure calling it.
        const declared = local ? undefined : this.bodyNamed(e.name);
        if (declared?.overloads) throw new CompileError("E0801", `'${e.name}' is overloaded, so it can't be used as a value yet; pass an arrow that calls it, as in '(x) => ${e.name}(x)'`, e.start, e.end);
        if (declared && !declared.comptime && declared.typeParams?.some((p) => !isLifetime(p))) return this.genericValue(declared, e);
        if (declared && !declared.comptime) return this.typeOf(this.functionValue(e, declared));
        if (!local) {
          const message = this.byName.has(e.name) ? "functions can't be used as values yet"
            : this.classes.has(e.name) ? "classes can't be used as values yet; construct one with 'new'"
            : this.enums.has(e.name) ? "an enum can't be used as a value; name one of its members"
            : `cannot find name '${e.name}'${didYouMean(e.name, this.ctx.names(e.start))}`;
          throw new CompileError("E0401", message, e.start, e.end);
        }
        if (!this.ctx.reachable(local)) {
          throw new CompileError("E0403", `'${e.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, e.start, e.end);
        }
        this.locals.set(e, local.localId);
        const lr = this.recOf(local.type);
        const held = lr?.kind === "ref" ? lr.to : local.type;
        if (this.ctx.sharing && local.param && !this.ctx.exprsState.objects.has(e) && this.typing.interiorMutable(held)) {
          throw new CompileError("E0304", this.ctx.counting ? `inside an Rc's 'update', use '${e.name}' only through its fields: its interior-mutable parts are borrowed where they live, and another name for it could replace them` : `inside a shared value's 'update', use '${e.name}' only through its fields: other tasks borrow its interior-mutable parts without the lock, and another name for it could replace them`, e.start, e.end);
        }
        const read = this.ctx.exprsState.asDeclared.has(e) ? undefined : this.ctx.narrowed(local);
        if (read !== undefined) this.ctx.narrowRead(local, e);
        // A JsValue narrowed by `typeof` to one kind of value is read out of JS, as a new value
        // each time; one narrowed to several stays a JsValue.
        const js = this.typing.jsRead(local.type, read);
        if (js === "one") this.ctx.copiesOut.add(e);
        if (js === "several") return this.stillJs(local.type);
        return read ?? local.type;
      }
      // Its literal type, which a string takes it as.
      case "string":
        return this.typing.literalType(e.value);
      // A string's one-unit string at a `usize` index.
      case "index": {
        if (e.object.kind === "ident") this.ctx.exprsState.objects.add(e.object);
        // An enum's reverse mapping, `Color[0]`, has no meaning yet.
        if (e.object.kind === "ident" && !this.ctx.lookup(e.object.name) && this.enums.has(e.object.name)) throw unsupported(EXPRESSION_FORMS.index, e);
        if (this.untuple(e) || this.undict(e) || this.rewrites.current(e) !== e) return this.typeOf(this.rewrites.current(e));
        const through = this.value(e.object);
        const object = this.isRefType(through) ? this.typing.rec(through).to : through;
        // A fixed array's element, checked against its known length when the program runs.
        if (this.isFixed(object)) {
          if (e.optional) throw unsupported("optional index expressions", e);
          const index = this.value(e.index);
          this.coerce(e.index, index, "usize", `a fixed array's index is a 'usize', not '${this.typing.show(index)}'`);
          return this.typing.unfolded(this.typing.rec(object).element);
        }
        const array = this.isArray(object);
        if (this.typing.isPlainJs(object)) throw new CompileError("E1005", `a 'JsValue' could be anything, as an 'unknown' could, so its elements are read with 'at': '${this.placeText(e.object)}.at(i)'`, e.start, e.end);
        if (!stringLike(this.typing, object) && !array) throw unsupported(EXPRESSION_FORMS.index, e);
        if (e.optional) throw unsupported("optional index expressions", e);
        if (array && object !== through) this.coercions.set(e.object, object);
        if (!array) this.text(e.object, object, false);
        const index = this.value(e.index);
        this.coerce(e.index, index, "usize", `${array ? "an array" : "a string"}'s index is a 'usize', not '${this.typing.show(index)}'`);
        return array ? this.typing.unfolded(this.typing.rec(object).element) : "string";
      }
      // Text alone is a literal; with substitutions, a new string.
      case "template":
        if (e.exprs.length === 0) return this.typing.literalType(e.quasis[0]!);
        for (const x of e.exprs) this.joined(x, this.operand(x), "a template");
        return "string";
      case "member": {
        if (e.object.kind === "super" && this.superDelegated(e.name)) return this.typeOf(this.become(e, this.throughEmbedded(e)));
        // A static property of a package's class.
        const jsClass = e.object.kind === "ident" && !this.ctx.lookup(e.object.name) ? this.jsClasses.get(e.object.name) : undefined;
        if (jsClass) {
          const m = this.jsStatic(jsClass, e.name, e);
          if (m.kind !== "property") throw new CompileError("E0503", `'${e.name}' is a method of '${jsClass.name}'; call it`, e.start, e.end);
          const declared = m.type ? this.ctx.resolveType(m.type) : this.typing.blockType("JsValue");
          return this.crossing(this.typing.jsView(m.optional ? this.typing.unionType([declared, "null"]) : declared), `'${jsClass.name}.${e.name}' is a`, e);
        }
        if (e.object.kind === "ident" && isTypedName(e.object.name) && !this.ctx.lookup(e.object.name) && !this.classes.has(e.object.name)) {
          if (e.name !== "BYTES_PER_ELEMENT" || e.object.name === "ArrayBuffer") throw new CompileError("E0502", `'${e.object.name}' has no static property '${shownName(e.name)}'`, e.start, e.end);
          return this.typeOf(this.become(e, { id: nextId(this.ids), kind: "int", value: BigInt(typedSize(e.object.name)), start: e.start, end: e.end }));
        }
        if (this.isMath(e.object)) {
          if (MATH_CONSTANTS[e.name] === undefined) throw new CompileError("E0503", `'Math.${e.name}' is a function, or not in Fish yet; the constants are ${Object.keys(MATH_CONSTANTS).join(", ")}`, e.start, e.end);
          this.maths.add(e);
          return "f64";
        }
        const property = this.staticProperty(e);
        if (property) {
          return this.typeOf(this.become(e, this.staticRead(e, property)));
        }
        // `Color.Red` names an enum member, whose value is known; the enum's name is no value.
        const named = e.object.kind === "ident" && !this.ctx.lookup(e.object.name) ? this.enums.get(e.object.name) : undefined;
        if (named?.data) return this.variant(e, named, true);
        if (named && e.object.kind === "ident") {
          const found = this.ctx.enumMember(e.object.name, e.name);
          if (!found) throw new CompileError("E0502", `property '${e.name}' does not exist on enum '${e.object.name}'${didYouMean(e.name, this.ctx.enumMemberNames(e.object.name))}`, e.start, e.end);
          return found;
        }
        if (e.object.kind === "ident") this.ctx.exprsState.objects.add(e.object);
        const through = this.linked(e) ? this.unwrapped(e.object, e.optional) : this.value(e.object);
        const tr = this.recOf(through);
        const object = this.typing.unfold(tr?.kind === "ref" ? tr.to : through);
        if (object === "never") return "never";
        const or = this.recOf(object);
        // A field read through a reference loads what it points to; a getter gets the pointer.
        if (or?.kind === "unknown") throw this.unnarrowed(e);
        if (or?.kind === "shared") return this.sharedField(e, object as SharedType);
        if (or?.kind === "block") return this.blockProperty(e, object as BlockType);
        if (or?.kind === "dyn") return this.dynField(e, object as DynType);
        const rx = this.asRegex(object);
        if (rx) {
          if (object !== through) this.coercions.set(e.object, object);
          return this.regexMember(e, rx, this.typing.lower(object) !== rx);
        }
        const load = () => object !== through && this.coercions.set(e.object, object);
        const shared = or?.kind === "union" ? unionField(this.typing, object as UnionType, e.name, e) : undefined;
        if (shared) {
          load();
          return this.linked(e) ? this.optional(shared, e) : shared;
        }
        if (or?.kind === "class") this.ctx.classOf(object as ClassType);
        // A dictionary's property is the entry under that key, as `o[k]` reads it.
        if (or?.kind === "map" && or.dict) {
          if (this.linked(e)) throw unsupported("optional chains reading a dictionary", e);
          if (this.ctx.exprsState.writing === e) throw this.dictWrite(e);
          this.ctx.exprsState.once.add(e.object);
          return this.typeOf(this.dictCall(e, e.object, "get", [{ id: nextId(this.ids), kind: "string", value: e.name, start: e.start, end: e.end }]));
        }
        // A Map's or a Set's one property is its size, the number of entries it holds.
        if (or?.kind === "map") {
          if ((or.set ? SET_METHODS : MAP_METHODS).has(e.name)) throw new CompileError("E0503", `'${or.set ? "Set" : "Map"}' methods can only be called, like 'm.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "size") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(object)}'${didYouMean(e.name, ["size", ...(or.set ? SET_METHODS : MAP_METHODS)])}`, e.start, e.end);
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A tuple's one property is its length: the count of its elements, up to the last
        // optional one there.
        if (this.typing.isTuple(object) && !this.typing.rec(object as ObjectType).match && e.name === "length") {
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A fixed array's one property is its length, known while compiling.
        if (this.isFixed(object)) {
          if (e.name !== "length") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(object)}'${didYouMean(e.name, ["length"])}`, e.start, e.end);
          load();
          return "usize";
        }
        // An array's properties are its length and its capacity, the room before a push grows it;
        // capacity isn't JavaScript's.
        if (this.isArray(object)) {
          const typed = this.typing.typedName(object);
          if (typed && TYPED_MEMBERS.has(e.name)) return this.typedMember(e, typed);
          if (ARRAY_METHODS.has(e.name)) throw new CompileError("E0503", `array methods can only be called, like 'a.${e.name}(...)'`, e.start, e.end);
          // A shared value's array is read as a copy, which has only the room it needs.
          if (e.name === "capacity" && this.ctx.copiesOut.has(e.object)) throw new CompileError("E0304", `a shared value's array is read as a copy, so read its capacity inside '${this.placeText(e.object).split(".")[0]}.update(...)'`, e.start, e.end);
          if (e.name !== "length" && e.name !== "capacity") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(object)}'${didYouMean(e.name, ["length", "capacity", ...ARRAY_METHODS])}`, e.start, e.end);
          load();
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        // A string's one property is its length in UTF-16 code units, a type parameter's bounded
        // by strings included.
        const plain = this.plainOf(object);
        if (stringLike(this.typing, plain)) {
          if (stringMethods(this.typing)[e.name]) throw new CompileError("E0503", `string methods can only be called, like 's.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "length") throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type 'string'${didYouMean(e.name, ["length", ...Object.keys(stringMethods(this.typing))])}`, e.start, e.end);
          this.text(e.object, plain, this.linked(e));
          return this.linked(e) ? this.optional("usize", e) : "usize";
        }
        if (this.delegated(object, e.name)) return this.typeOf(this.become(e, this.throughEmbedded(e)));
        const found = or === undefined || or.kind === "closure" ? undefined : this.typing.field(object as Exclude<Type, string>, e.name);
        const c = or?.kind === "class" ? this.ctx.classOf(object as ClassType) : undefined;
        const getter = !found && c ? inherited(this.arenas, c, "getters", e.name) : undefined;
        if (getter) {
          this.visible(getter.access, getter.declared ?? getter.owner!, e.name, e);
          this.calls.set(e, this.ctx.instanceOf(getter).id);
          const returns = this.ctx.returnOf(this.ctx.instanceOf(this.abstractDeclaration(e, "getters") ?? getter), e);
          // A getter's reference borrows from its object.
          if (this.typing.holdsRef(returns)) this.borrowsFrom.set(e, [e.object]);
          return this.linked(e) ? this.optional(returns, e) : returns;
        }
        if (!found && c && inherited(this.arenas, c, "methods", e.name)) throw new CompileError("E0801", "methods can't be used as values yet; call it", e.start, e.end);
        if (!found && c && inherited(this.arenas, c, "setters", e.name)) throw new CompileError("E0208", `property '${e.name}' has a setter but no getter`, e.start, e.end);
        if (!found) throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(object)}'${didYouMean(e.name, this.memberNames(object))}`, e.start, e.end);
        if (or?.kind === "class") this.visible(found.access, this.declaring(object as ClassType, e.name), e.name, e);
        // Through a type parameter the field has its bound's type, and in an instance the
        // concrete class may give it with a getter.
        const stored = this.typing.lower(object);
        const sr = this.recOf(stored);
        if (stored !== object && sr?.kind === "class" && !this.typing.field(stored as ClassType, e.name)) {
          const instance = this.ctx.instanceOf(inherited(this.arenas, this.ctx.classOf(stored as ClassType), "getters", e.name)!);
          this.ctx.returnOf(instance, e);
          this.calls.set(e, instance.id);
        }
        if (!this.calls.has(e)) load();
        if (this.linked(e)) return this.optional(this.typing.unfolded(found.type), e);
        const narrowed = this.calls.has(e) || this.ctx.exprsState.asDeclared.has(e) ? undefined : this.ctx.narrowedField(e);
        if (narrowed === undefined) {
          this.ctx.instance.narrowedFields?.delete(e);
          return this.typing.unfolded(found.type);
        }
        (this.ctx.instance.narrowedFields ??= new NodeMap()).set(e, this.typing.unfolded(found.type));
        return narrowed;
      }
      case "object": {
        const tuple = this.ctx.exprsState.tuples.get(e);
        if (tuple) return this.tupleLiteral(e, tuple);
        if ((this.ctx.exprsState.shaped.has(e) || this.pairs.has(e)) && this.tupleLiterals.has(e)) return this.tupleLiteral(e, this.shapedTuple(e, this.tupleParts(e).map((x) => this.typing.widenLet(this.value(x!)))));
        if (e.props.some((p) => p.kind === "spread")) return this.objectSpread(e);
        return this.typing.objectType(fields(e.props.map((p) => this.property(p)), e.props));
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
        if (this.pairs.has(e)) {
          const parts = (e.elements as Expr[]).map((x) => {
            const t = this.typing.widenLet(this.value(x));
            this.ctx.exprsState.once.add(x);
            return t;
          });
          return this.tupleLiteral(e, this.typing.tupleType(parts));
        }
        // `Array.of<T>(...)`: an array of T, its elements checked against it.
        const written = this.ofElements.get(e);
        if (written) {
          // Resolved as an array's element is, so references and functions get the same rules.
          const element = this.typing.rec(this.ctx.resolveType({ id: nextId(this.ids), kind: "array", element: written, start: written.start, end: written.end } as TypeNode) as ArrayType).element;
          for (const x of e.elements as Expr[]) {
            this.expect(x, element);
            const t = this.value(x);
            this.coerce(x, t, element, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(element)}'`);
          }
          return this.typing.arrayType(element);
        }
        const inline = this.ctx.exprsState.fixedLiterals.get(e);
        if (inline) {
          const given = e.elements as Expr[];
          if (given.length !== this.typing.rec(inline).size) throw new CompileError("E0117", `type '${this.typing.show(inline)}' holds ${this.typing.rec(inline).size} element${this.typing.rec(inline).size === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
          const spread = given.find((x) => x.kind === "spread");
          if (spread) throw unsupported("spread elements in fixed array literals", spread);
          for (const x of given) {
            const t = this.value(x);
            this.coerce(x, t, this.typing.rec(inline).element, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(this.typing.rec(inline).element)}'`);
          }
          return inline;
        }
        if (this.ctx.exprsState.shaped.has(e) && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
          return this.tupleLiteral(e, this.shapedTuple(e, (e.elements as Expr[]).map((x) => this.typing.widenLet(this.value(x)))));
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
        const callable = typeof want !== "string" && this.recOf(want)?.kind === "dyn" && this.typing.callableOf.has(this.typing.rec(want as DynType).of) ? want : undefined;
        const promise = typeof want !== "string" && this.recOf(want)?.kind === "dyn" && this.typing.promiseElement(this.typing.rec(want as DynType).of) !== undefined ? want : undefined;
        const given = elements.map((x) => {
          const spread = spreads.get(x);
          if (spread !== undefined) return spread;
          const t = this.value(x);
          const boxed = typeof t !== "string" && ((this.typing.rec(t).kind === "closure" && callable) || (this.typing.rec(t).kind === "future" && promise));
          if (boxed) {
            const into = (callable ?? promise)!;
            this.coerce(x, t, into, `type '${this.typing.show(t)}' is not assignable to type '${this.typing.show(into)}'`);
            return into;
          }
          if (typeof t !== "string" && this.typing.rec(t).kind === "closure") throw unsupported("arrays of functions", x);
          if (this.typing.holdsRef(t)) throw unsupported("arrays of references", x);
          const widened = this.typing.widenLet(t);
          if (widened !== t) this.coerce(x, t, widened, "");
          return widened;
        });
        const fromSpreads = spreads.size > 0 && !this.ctx.exprsState.wanted.has(e);
        const element = given.length === 0 ? "never" : fromSpreads ? this.typing.unionType([...spreads.values()]) : this.typing.unionType(given);
        elements.forEach((x, i) => {
          if (given[i] === element || this.typing.sameLowered(given[i]!, element)) return;
          // A spread's elements are each converted to the array's type, which has to hold them.
          if (spreads.has(x)) {
            if (!this.typing.fits(given[i]!, element)) throw new CompileError("E0101", `this spread gives '${this.typing.show(given[i]!)}' elements, which an array of '${this.typing.show(element)}' can't hold`, x.start, x.end);
            return;
          }
          this.coerce(x, this.types.get(x)!, element, `type '${this.typing.show(this.types.get(x)!)}' is not assignable to type '${this.typing.show(element)}', the type of the spread's elements`);
        });
        return this.typing.arrayType(element);
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
        if (!this.self) throw new CompileError("E0708", "'this' can only be used inside a class", e.start, e.end);
        if (!this.ctx.thisReady(e)) throw new CompileError("E0703", "'this' can't be used until every field is assigned", e.start, e.end);
        this.ctx.noteThis(e);
        return this.self.type;
      case "new": {
        const spread = this.spreadTuples(e);
        if (spread !== e) return this.typeOf(spread);
        let list = e.args ?? [];
        if (e.callee.kind === "ident" && INTERIORS.has(e.callee.name) && !this.ctx.lookup(e.callee.name) && !this.classes.has(e.callee.name)) {
          return this.interiorNew(e, e.callee.name as InteriorRecord["which"], list);
        }
        if (e.callee.kind === "ident" && (e.callee.name === "Rc" || e.callee.name === "Weak") && !this.ctx.lookup(e.callee.name) && !this.classes.has(e.callee.name)) {
          return this.countedNew(e, e.callee.name, list);
        }
        if (e.callee.kind === "ident" && (e.callee.name === "Semaphore" || e.callee.name === "Channel") && !this.ctx.lookup(e.callee.name) && !this.classes.has(e.callee.name)) {
          return this.blockNew(e, e.callee.name, list);
        }
        if (e.callee.kind === "ident" && (e.callee.name === "Map" || e.callee.name === "Set") && !this.ctx.lookup(e.callee.name)) return this.mapNew(e, e.callee.name === "Set", list);
        if (e.callee.kind === "ident" && !this.ctx.lookup(e.callee.name) && this.jsClasses.has(e.callee.name)) return this.jsNew(e, this.jsClasses.get(e.callee.name)!);
        if (e.callee.kind === "ident" && e.callee.name === "Promise" && !this.ctx.lookup("Promise") && !this.classes.has("Promise")) {
          return this.typeOf(this.promiseNew(e, list));
        }
        if (e.callee.kind === "ident" && e.callee.name === "RegExp" && !this.ctx.lookup("RegExp") && !this.classes.has("RegExp")) return this.regexNew(e, list);
        if (e.callee.kind === "ident" && e.callee.name === "AbortController" && !this.ctx.lookup(e.callee.name) && !this.classes.has(e.callee.name)) {
          if (list.length > 0 || e.typeArgs.length > 0) throw new CompileError("E0504", "'AbortController' takes no arguments", e.start, e.end);
          return this.typing.blockType("AbortController");
        }
        if (e.callee.kind === "ident" && isTypedName(e.callee.name) && !this.ctx.lookup(e.callee.name) && !this.classes.has(e.callee.name)) return this.typedNew(e, e.callee.name, list);
        const named = e.callee.kind === "ident" && !this.ctx.lookup(e.callee.name) ? this.arenas.classOf(this.classes.get(e.callee.name)) : undefined;
        if (named?.node.abstract) throw new CompileError("E0701", `cannot create an instance of the abstract class '${this.typing.rec(named.type).name}'`, e.start, e.end);
        const written = this.arenas.bodyOf(named?.constructor)?.params ?? (e.callee.kind === "ident" && !this.ctx.lookup(e.callee.name) ? this.ctx.templateParams(e.callee.name) : undefined);
        if (written?.at(-1)?.rest && e.args) list = this.packRest(e, e.args, written).args!;
        else this.refuseSpread(list);
        if (named) this.expectFrom(this.arenas.bodyOf(named.constructor), list);
        // A generic class's written type arguments type the arrows given for parameters they name,
        // as in `new Box<(n: i64) => i64>((n) => n * 2)`.
        const early = !named && e.typeArgs.length > 0 && e.callee.kind === "ident" && !this.ctx.lookup(e.callee.name) ? this.ctx.construct(e.callee.name, e.typeArgs, [], e) : undefined;
        const earlyConstructor = this.arenas.bodyOf(early?.constructor);
        earlyConstructor?.params.forEach((p, i) => {
          const held = p.type?.kind === "ref" && p.type.args.length === 0 ? (earlyConstructor.scope ?? early!.scope).get(p.type.name) : undefined;
          if (list[i]?.kind === "arrow" && held) this.expect(list[i]!, held);
        });
        // JavaScript's `new Array(n)` holds n holes, which Fish has no way to make.
        if (e.callee.kind === "ident" && e.callee.name === "Array" && !this.ctx.lookup("Array") && !this.classes.has("Array")) {
          const one = list.length === 1 ? this.value(list[0]!) : undefined;
          throw new CompileError("E0104", list.length === 0 ? "'new Array()' is an empty array; write '[]', with its type where it can't be inferred, as in 'const xs: string[] = []'"
            : one !== undefined && isInteger(one) ? "'new Array(n)' would hold n empty slots, which Fish has no way to make; fill it, as in 'new Array(n).fill(0)', or use 'Array.from({ length: n }, (_, i) => ...)'"
            : list.length === 1 ? "'new Array(x)' of one value that isn't a length makes '[x]'; write 'Array.of(x)' or '[x]'"
            : "'new Array(a, b)' makes an array of its arguments; write 'Array.of(a, b)' or '[a, b]'", e.start, e.end);
        }
        const argTypes = list.map((a) => this.value(a));
        if (named && this.typing.rec(named.type).name === "Date" && named.node.start >= STD_BASE) this.dateNew(e, list, argTypes);
        const c = e.callee.kind === "ident" ? this.ctx.construct(e.callee.name, e.typeArgs, argTypes, e) : undefined;
        if (!c) throw new CompileError("E0503", `only a class can be constructed with 'new'${e.callee.kind === "ident" && !this.ctx.lookup(e.callee.name) ? didYouMean(e.callee.name, this.ctx.classNames(e.callee.start)) : ""}`, e.callee.start, e.callee.end);
        const rust = rustClassOf(this.typing, c.type);
        const made = this.arenas.bodyOf(c.constructor);
        if (rust && !made.rust) throw new CompileError("E1004", `the Rust type '${rust.name}' declares no constructor; declare one, as in 'constructor(x: i64);', or make it with a static function`, e.start, e.end);
        this.ctx.constructs(made, list, argTypes);
        const constructor = this.ctx.instantiate(made, [], list, argTypes, e);
        this.args(list, argTypes, constructor, e);
        this.calls.set(e, constructor.id);
        const error = this.ctx.errorOf(constructor);
        if (error) this.ctx.raise(e, error, `'new ${this.typing.rec(c.type).name}'`);
        // An instance holding references borrows from what it was built from.
        if (this.typing.holdsRef(c.type)) this.borrowsFrom.set(e, list.filter((a) => this.lends(a)));
        return c.type;
      }
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
        return this.unsafely(() => this.value(e.expr));
      // Checked as the code it is; it runs while compiling, and codegen bakes its value.
      case "comptime":
        return this.ctx.comptime(() => this.value(e.expr));
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
          return this.typeOf(this.become(e, { id: nextId(this.ids), kind: "binary", op: "||", left: removed, right: { id: nextId(this.ids), kind: "bool", value: true, ...at }, ...at }));
        }
        if (e.op !== "-" && e.op !== "!" && e.op !== "~") throw new CompileError("E0801", `operator '${e.op}' is not supported yet`, e.start, e.end);
        const operand = this.operand(e.operand);
        // A brand's operators work on its base; a unit negated keeps its unit.
        const type = this.typing.unbranded(operand);
        // The smallest i64 is written as the negation of a literal one past the largest.
        if (e.op === "-" && e.operand.kind === "int" && e.operand.value === I64_MAX + 1n) this.ctx.exprsState.fitted.add(e.operand);
        if (e.op === "!" ? type !== "boolean" : type !== "bigint" && (e.op === "~" ? !isInteger(type) : !isNumeric(type))) {
          throw new CompileError("E0103", `operator '${e.op}' cannot be applied to type '${this.typing.show(type)}'`, e.start, e.end);
        }
        if (e.op === "-" && isInteger(type) && !INTEGERS[type].signed) {
          throw new CompileError("E0110", `'${this.typing.show(type)}' is unsigned, so it can't be negated; convert it to a signed type with 'as' first`, e.start, e.end);
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
          if (this.ctx.exprsState.statementAssign !== e) throw new CompileError("E0801", "writing a dictionary's entry gives no value to use, so write it as a statement of its own", e.start, e.end);
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
          : op === "+" && this.typing.unbranded(target) === "string" ? this.join(place, target, e.value, this.widen(e.value, assigned))
          : op === "**" ? this.power(place, target, e.value, this.widen(e.value, assigned), e)
          : binaryType(this.typing, op, ...this.sameNumbers(place, target, e.value, this.widen(e.value, assigned)), e);
        // A parameter typed by an object type or interface takes any value with its members, so
        // what it holds may have more fields than any value written here.
        const param = place.kind === "ident" ? this.localAt(place) : undefined;
        if (op === "=" && param?.param && this.recOf(target)?.kind === "param" && !this.typing.fits(type, target)) {
          throw new CompileError("E0101", `'${param.name}' takes any value with the members of '${this.typing.show(target)}', which may have more, so it can't be given a '${this.typing.show(type)}'; declare 'let ${param.name}2: ${this.typing.show(target)} = ${param.name}' to hold just those`, e.start, e.end);
        }
        this.coerce(e.value, type, target, `type '${this.typing.show(type)}' is not assignable to type '${this.typing.show(target)}'`);
        // A handle's property is written in JS, with the value converted.
        if (this.jsMembers.has(place)) {
          this.givenToJs(e.value, assigned);
          // What JS is given is JS's to keep, so nothing is left to be the assignment's value.
          if (this.typing.keptByJs(target) && this.ctx.exprsState.statementAssign !== e) throw new CompileError("E1005", `a callback or a Promise written to property '${(place as { name: string }).name}' goes to JS, so the assignment has no value to use; write it as a statement of its own`, e.start, e.end);
        }
        const local = place.kind === "ident" ? this.localAt(place) : undefined;
        if (local && typeof local.type !== "string" && this.typing.rec(local.type).kind === "ref" && !this.coercions.has(place)) this.rebind(local, e.value);
        const narrow = local && this.ctx.narrowed(local);
        if (local && op === "=" && this.coercions.has(place) && narrow && this.isRefType(narrow) && !this.typing.fits(type, this.typing.rec(narrow).to)) this.ctx.rewritten(local, e);
        if (local && op === "=") this.ctx.forget(local, e);
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
          throw new CompileError("E0103", `operator '${e.op}' gives a '${this.typing.show(brand.base)}', which a '${this.typing.show(target)}' is made from only with 'as'; write it as an assignment, like 'x = (x ${e.op[0]} 1) as ${this.typing.show(target)}'`, e.start, e.end);
        }
        if (!isNumeric(target) && target !== "bigint") throw new CompileError("E0103", `operator '${e.op}' cannot be applied to type '${this.typing.show(target)}'`, e.start, e.end);
        return target;
      }
      case "conditional": {
        this.condition(e.cond);
        const proven = this.ctx.proves(e.cond);
        const ruledOut = (facts: Facts) => [...facts.values()].includes("never");
        if (ruledOut(proven.yes)) return this.ctx.assume(proven.no, () => this.value(e.else));
        if (ruledOut(proven.no)) return this.ctx.assume(proven.yes, () => this.value(e.then));
        let [then, otherwise] = [this.ctx.assume(proven.yes, () => this.value(e.then)), this.ctx.assume(proven.no, () => this.value(e.else))];
        [then, otherwise] = this.sameNumbers(e.then, then, e.else, otherwise);
        if (then === otherwise) return then;
        // Two references lend shared what both point to, or a type both fit; otherwise a side
        // that borrows gives its value.
        const isRef = (t: Type) => typeof t !== "string" && this.typing.rec(t).kind === "ref";
        if (isRef(then) && isRef(otherwise)) {
          const [a, b] = [this.typing.rec(then as RefType).to, this.typing.rec(otherwise as RefType).to];
          if (this.typing.rec(then as RefType).mutable && this.typing.rec(otherwise as RefType).mutable && this.typing.lower(a) === this.typing.lower(b)) return then;
          const bound = (t: Type) => {
            const r = this.recOf(t);
            return r?.kind === "param" ? r.bound : undefined;
          };
          const common = [a, b, bound(a), bound(b)].find((t) => t && this.typing.fits(a, t) && this.typing.fits(b, t));
          if (common) {
            const shared = this.typing.refType(common, false);
            this.coerce(e.then, then, shared, "");
            this.coerce(e.else, otherwise, shared, "");
            return shared;
          }
        }
        // A reference against nothing is a reference or nothing.
        const option = isRef(then) && otherwise === "null" ? this.typing.unionType([then, "null"]) : isRef(otherwise) && then === "null" ? this.typing.unionType([otherwise, "null"]) : undefined;
        if (option) {
          this.coerce(e.then, then, option, "");
          this.coerce(e.else, otherwise, option, "");
          return option;
        }
        if (isRef(then) || isRef(otherwise)) [then, otherwise] = [this.loaded(e.then, then), this.loaded(e.else, otherwise)];
        if (then === otherwise) return then;
        // A tuple of literals, as `as const` writes one, beside a tuple it fits is that tuple, since a
        // union of tuples can't be destructured.
        if (this.typing.isTuple(then) && this.typing.isTuple(otherwise)) {
          const wider = this.typing.fits(otherwise, then) ? then : this.typing.fits(then, otherwise) ? otherwise : undefined;
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
        if (this.deepEqualities.has(e)) {
          for (const a of [e.left, e.right]) {
            const t = this.value(a);
            this.ctx.exprsState.once.add(a);
            if (holdsFloat(this.typing, t)) throw new CompileError("E0801", "'isDeepStrictEqual' over floats isn't supported yet: Node's compares them as Object.is does, NaN equal to NaN and -0 apart from 0, unlike '==='", a.start, a.end);
          }
        }
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError("E0802", `'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (e.op === "&&" || e.op === "||") {
          // The right side runs only when the left is true, for `&&`, or false, for `||`.
          const left = this.operand(e.left);
          const proven = this.ctx.proves(e.left);
          return binaryType(this.typing, e.op, left, this.ctx.assume(e.op === "&&" ? proven.yes : proven.no, () => this.operand(e.right)), e);
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
          if (stringLike(this.typing, left) || stringLike(this.typing, right) || enumText(this.typing, left) || enumText(this.typing, right)) return this.join(e.left, left, e.right, right);
        }
        return binaryType(this.typing, e.op, ...this.sameNumbers(e.left, this.operand(e.left), e.right, this.operand(e.right), false), e);
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
  private winner(e: Extract<Expr, { kind: "object" }>, name: string): ObjectProp | undefined {
    return e.props.findLast((q) => {
      if (q.kind === "property") return q.key === name;
      if (q.kind === "shorthand") return q.name === name;
      if (q.kind !== "spread") return false;
      const t = this.types.get(q.value)!;
      const low = this.typing.lower(this.isRefType(t) ? this.typing.rec(t).to : t);
      const lr = this.recOf(low);
      const br = lr?.kind === "param" ? this.recOf(lr.bound) : undefined;
      const source = br?.kind === "object" ? (lr as ParamRecord).bound! : low;
      return typeof source === "string" || (br?.kind !== "object" && lr?.kind === "param") || this.typing.field(source, name) !== undefined;
    });
  }

  /** @throws {CompileError} */
  private adaptFields(this: Mut<this>, e: Expr, type: Type, to: Type): Type {
    to = this.typing.unfolded(to);
    // An object literal meeting a union adapts to the member it names, then joins the union.
    if (e.kind === "object") to = this.memberNamed(e, to) ?? to;
    if (e.kind !== "object" || typeof to === "string" || (this.typing.rec(to).kind !== "object" && this.typing.rec(to).kind !== "class")) return type;
    // Only a property no later part replaces gives its field, so only that one adapts.
    const winners = e.props.filter((p): p is Extract<ObjectProp, { kind: "property" }> =>
      p.kind === "property" && typeof p.key === "string" && this.winner(e, p.key) === p);
    let changed = false;
    for (const p of winners) {
      const key = p.key as string;
      const want = this.typing.field(to, key)?.type;
      const have = this.types.get(p.value)!;
      // A string literal widened for the object keeps its literal type where one is wanted.
      if (want && want !== "string" && this.coercions.get(p.value) === "string" && this.typing.fits(have, want)) {
        this.coercions.delete(p.value);
        changed = true;
        continue;
      }
      if (!want || have === want) continue;
      // An array literal meeting a union becomes the union's array, which then joins the union.
      const adapted = this.adapt(p.value, want) ? want : this.literalArray(p.value, have, want) ? this.types.get(p.value)! : this.adaptFields(p.value, have, want);
      if (adapted !== have) {
        this.types.set(p.value, adapted);
        changed = true;
      }
    }
    if (!changed) return type;
    const fields = this.typing.rec(type as ObjectType).fields.map((f) => {
      const p = winners.find((q) => q.key === f.name);
      return p ? { ...f, type: this.coercions.get(p.value) ?? this.types.get(p.value)! } : f;
    });
    // A tuple stays one, its rest taken from its adapted array.
    const tuple = type as ObjectType;
    const many = fields.find((f) => f.name === "...")?.type as ArrayType | undefined;
    const remade = this.typing.isTuple(tuple) && !this.typing.rec(tuple).match ? this.typing.tupleType(tupleElements(fields), this.typing.rec(tuple).required, this.recOf(many)?.element) : this.typing.objectType(fields);
    this.types.set(e, remade);
    return remade;
  }

  // `**` raises an integer to a `u32` power, like Rust's `pow`, and a float to a float power of
  // its own type, like `powf`. A literal base takes its type from the exponent's only when that
  // is a float.
  /** @throws {CompileError} */
  private power(this: Mut<this>, base: Expr, left: Type, exponent: Expr, right: Type, at: Expr): Type {
    // A bigint's exponent is a bigint, as in JavaScript.
    if (left === "bigint" || right === "bigint") return binaryType(this.typing, "*", left, right, at);
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
      throw new CompileError("E0110", `the exponent of '**' on an integer is a 'u32', as in Rust's 'pow', not '${this.typing.show(right)}'; convert it with 'as u32'`, exponent.start, exponent.end);
    }
    if (!isNumeric(left) || (isFloat(left) && left !== right)) {
      throw new CompileError("E0103", `operator '**' cannot be applied to types '${this.typing.show(left)}' and '${this.typing.show(right)}'`, at.start, at.end);
    }
    return left;
  }

  // What an Option holds when it isn't empty.
  private held(option: UnionType): Type {
    return this.typing.unionType(this.typing.rec(option).members.filter((m) => m !== "null"));
  }

  // `a ?? b` is what `a` holds, or `b` when `a` is empty, which only then runs. With an Option
  // for `b`, the result may still be empty.
  /** @throws {CompileError} */
  private orElse(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): Type {
    // A destructuring default in a generic instance meets the Option its type parameter is.
    const option = this.unusedDefaults.has(e) ? this.typing.lower(this.read(e.left)) : this.read(e.left);
    // A default a destructuring assignment adds is only for an Option's absence.
    // Its default is still checked, as TypeScript checks it.
    if (!this.typing.isOption(this.typing.lower(option)) && this.unusedDefaults.has(e)) {
      this.value(e.right);
      return option;
    }
    // An unknown may hold null, and is still an unknown once a default replaces it.
    const unknown = this.typing.isUnknown(option);
    if (!this.typing.isOption(option) && !unknown) throw new CompileError("E0108", `the left side of '??' is a '${this.typing.show(option)}', which is never empty; '??' gives a default for an Option`, e.left.start, e.left.end);
    const inner = unknown ? option : this.held(option as UnionType);
    // A parameter's default is checked as an argument for it would be; a nullable one's is null.
    const declared = this.fallbacks.get(e);
    if (declared) {
      const to = holdsNull(this.typing, this.ctx.resolveType(declared)) ? option : inner;
      this.expect(e.right, to);
      const fallback = this.value(e.right);
      this.coerce(e.right, fallback, to, `a default of type '${this.typing.show(fallback)}' is not assignable to parameter of type '${this.typing.show(to)}'`);
      return to;
    }
    const fallback = this.value(e.right);
    // An Option of a reference takes a place to lend as its fallback.
    const to = this.typing.fits(fallback, inner) || this.adaptable(e.right, inner) || (this.isRefType(inner) && this.typing.fits(fallback, this.typing.rec(inner).to)) ? inner : option;
    this.coerce(e.right, fallback, to, `type '${this.typing.show(fallback)}' is not assignable to type '${this.typing.show(to)}', what '${this.typing.show(option)}' holds`);
    return to;
  }

  // A brand's base, which `Math` works on as it would on any of its values; a unit stays, since
  // what `Math` gives would lose it.
  private brandBase(t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "brand" && !r.unit ? r.base : t;
  }

  // Whether an expression of only literals could take this number type.
  private adaptable(e: Expr, to: Type): boolean {
    e = this.rewrites.current(e);
    return isNumeric(to) && this.literalOnly(e, isFloat(to));
  }

  // An array literal takes a declared element type, each element meeting it.
  /** @throws {CompileError} */
  private literalArray(this: Mut<this>, e: Expr, type: Type, to: Type): boolean {
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
      this.coercions.delete(x);
      this.coerce(x, this.types.get(x)!, this.typing.rec(to).element, `type '${this.typing.show(this.types.get(x)!)}' is not assignable to type '${this.typing.show(this.typing.rec(to).element)}'`);
    }
    this.types.set(e, to);
    return true;
  }

  // `v === null` and `v === undefined` test a JsValue for JS's two empty values, which Fish's one
  // empty value can't tell apart.
  /** @throws {CompileError} */
  private jsEmpty(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): Type | undefined {
    for (const [subject, other] of [[e.left, e.right], [e.right, e.left]] as const) {
      if (!isEmpty(other, this.locals as NodeMap<Expr, LocalId>)) continue;
      const t = this.value(subject);
      this.ctx.exprsState.once.add(subject);
      if (!this.typing.isPlainJs(this.isRefType(t) ? this.typing.rec(t).to : t)) return undefined;
      this.ctx.exprsState.once.delete(subject);
      this.value(other);
      this.jsEmptyTests.set(e, [subject, other.kind === "null" ? "null" : "undefined"]);
      return "boolean";
    }
    return undefined;
  }

  // `===` between values holding objects, arrays or instances compares them by value, as Fish's
  // Eq does, where TypeScript compares objects by identity: every part has to compare, and the
  // wider value is compared as the narrower.
  /** @throws {CompileError} */
  private equality(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): Type | undefined {
    const [left, right] = [this.value(e.left), this.value(e.right)];
    this.ctx.exprsState.once.add(e.left);
    this.ctx.exprsState.once.add(e.right);
    const deref = (t: Type) => this.typing.unfold(this.isRefType(t) ? this.typing.rec(t).to : t);
    const [l, r] = [deref(left), deref(right)];
    if (!objectsMeet(this.typing, l, r)) return undefined;
    this.ctx.exprsState.once.delete(e.left);
    this.ctx.exprsState.once.delete(e.right);
    for (const t of [l, r]) {
      const part = this.typing.unequal(t, (c) => this.comparesAsValue(c));
      if (part) throw new CompileError("E0112", `values of type '${this.typing.show(part)}' can't be compared with '${e.op}': ${this.uncomparable(part)}`, e.start, e.end);
    }
    // A comparison over type parameters is checked again in each instance, once they're concrete.
    if (openParam(this.typing, l, true) || openParam(this.typing, r, true)) return "boolean";
    // A type parameter is compared as the type it stands for in this instance, and a union
    // holding one as the union that flattens into.
    const concrete = (t: Type): Type => {
      const r = this.recOf(t);
      if (r?.kind === "param" && r.concrete) return concrete(r.concrete);
      return r?.kind === "union" && holdsArgument(this.typing, t as UnionType) ? this.typing.lower(t) : t;
    };
    const [cl, cr] = [concrete(l), concrete(r)];
    const common = this.typing.fits(cl, cr) ? cr : this.typing.fits(cr, cl) ? cl : undefined;
    // Two unions that share a member compare as unions do, member by member.
    const members = (t: Type) => {
      const r = this.recOf(t);
      return r?.kind === "union" ? r.members : [t];
    };
    const overlap = members(cl).some((x) => members(cr).some((y) => this.typing.fits(x, y) || this.typing.fits(y, x)));
    if (!common && !overlap) throw new CompileError("E0112", `this comparison appears to be unintentional because the types '${this.typing.show(l)}' and '${this.typing.show(r)}' have no overlap`, e.start, e.end);
    // A reference is compared through, reading the value it borrows.
    const [a, b] = [this.loaded(e.left, left), this.loaded(e.right, right)];
    if (common && a !== common) this.coerce(e.left, a, common, "");
    if (common && b !== common) this.coerce(e.right, b, common, "");
    return "boolean";
  }

  // Why values of a type can't be compared.
  private uncomparable(t: Type): string {
    const rust = rustClassOf(this.typing, t);
    if (rust) return `a Rust '${rust.name}' isn't compared from Fish; compare what its methods give`;
    const r = this.recOf(t);
    if (r?.kind === "class") return `a class compares through 'equals(other: Ref<this>): boolean', which '${r.name}' doesn't have; add one, or '@derive(Eq)'`;
    if (r?.kind === "variant") return "an enum holding values compares when it has '@derive(Eq)'";
    if (r?.kind === "map") return `a ${r.set ? "Set" : r.dict ? "dictionary" : "Map"} isn't compared by value; compare its entries`;
    if (r?.kind === "shared" && r.which === "Rc") return "it has no value equality; 'Rc.ptrEq(a, b)' tells whether two Rcs share one value";
    return "it has no value equality";
  }

  // Whether a class or a data enum's values compare: a class through its `equals`, an enum
  // when it derives Eq.
  /** @throws {CompileError} */
  private comparesAsValue(this: Mut<this>, t: ClassType | VariantType): boolean {
    if (rustClassOf(this.typing, t)) return false;
    const r = this.typing.rec(t);
    if (r.kind === "variant") return [...this.enums.values()].some((e) => e.data?.name === r.enum && e.data.eq);
    const known = this.equalities.get(t as ClassType);
    if (known) return true;
    const method = inherited(this.arenas, this.ctx.classOf(t as ClassType), "methods", "equals");
    if (!method) return false;
    const instance = this.ctx.instanceOf(method);
    const [arg, ...more] = this.ctx.paramTypes(instance);
    const ar = this.recOf(arg);
    const to = ar?.kind === "ref" ? this.recOf(ar.to) : undefined;
    const shaped = !method.self?.mutable && !method.self?.owned && more.length === 0 && ar?.kind === "ref" && !ar.mutable && (this.typing.lower(ar.to) === this.typing.lower(t) || (to?.kind === "class" && this.typing.derives(t as ClassType, ar.to as ClassType))) && this.ctx.returnOf(instance, method) === "boolean";
    if (!shaped) throw new CompileError("E0702", `'${r.name}.equals' is what '===' compares instances with, so it takes 'other: Ref<this>' and returns a boolean`, method.start, method.end);
    this.equalities.set(t as ClassType, instance.id);
    return true;
  }

  // `+` with a string on either side joins the two into a new string.
  /** @throws {CompileError} */
  private join(this: Mut<this>, a: Expr, left: Type, b: Expr, right: Type): Type {
    this.joined(a, left, "'+'");
    this.joined(b, right, "'+'");
    return "string";
  }

  // Values printed, or formatted as util.format does: what isn't a scalar is shown as Node's
  // util.inspect shows it.
  /** @throws {CompileError} */
  private shown(this: Mut<this>, args: Expr[]) {
    for (const a of args) {
      const type = a.kind === "string" ? "void" : this.read(a);
      if (this.typing.holdsPart(type, (u) => rustClassOf(this.typing, u) !== undefined, true)) throw new CompileError("E1004", `printing a '${this.typing.show(type)}' isn't supported, since it holds a Rust value; print what its methods give`, a.start, a.end);
      if (this.printable(type)) continue;
      this.printed.add(a);
      const part = this.typing.uninspectable(type);
      if (!part) continue;
      throw new CompileError("E0510", typeof part !== "string" && (this.typing.rec(part).kind === "function" || this.typing.rec(part).kind === "closure" || this.typing.rec(part).kind === "dyn") ? "printing a function isn't supported yet" : `printing a '${this.typing.show(part)}' isn't supported yet`, a.start, a.end);
    }
  }

  // `%j`, JSON, in a literal format, where it would take an argument.
  /** @throws {CompileError} */
  private unformattable(args: Expr[]) {
    const [first] = args;
    if (first?.kind !== "string" || args.length < 2 || !formatPlan(first.value, args.length).specs.includes("j")) return;
    throw new CompileError("E0801", "'%j' in a format isn't supported yet; pass 'JSON.stringify(x)' to '%s' instead", first.start, first.end);
  }

  // A value written into a string: text, or a number or boolean written as JavaScript would.
  /** @throws {CompileError} */
  private joined(this: Mut<this>, e: Expr, type: Type, into: string): void {
    e = this.rewrites.current(e);
    if (this.typing.unbranded(type) !== type) return this.joined(e, this.typing.unbranded(type), into);
    if (stringLike(this.typing, type) || enumText(this.typing, type)) {
      if (type !== "string") this.coerce(e, type, "string", "");
      return;
    }
    // A value of no type is in code an instance never reaches.
    if (isNumeric(type) || type === "boolean" || type === "bigint" || type === "never") return;
    throw new CompileError("E0510", `${into} works with strings, numbers and booleans, not '${this.typing.show(type)}'`, e.start, e.end);
  }

  // Two operands of different number types meet as one when either is only literals. String
  // literals meet as strings, unless two different ones are compared for equality.
  /** @throws {CompileError} */
  private sameNumbers(this: Mut<this>, a: Expr, left: Type, b: Expr, right: Type, equality = false): [Type, Type] {
    if (isText(this.typing, left) && isText(this.typing, right) && (!equality || (left !== right && (left === "string" || right === "string")))) {
      if (left !== "string") this.coerce(a, left, "string", "");
      if (right !== "string") this.coerce(b, right, "string", "");
      return ["string", "string"];
    }
    if (left === right) return [left, right];
    // A literal meeting a brand takes its base, which is what operators on a brand work in.
    const [lb, rb] = [this.typing.unbranded(left), this.typing.unbranded(right)];
    if (this.adapt(b, lb)) return [left, lb];
    if (this.adapt(a, rb)) return [rb, right];
    return [left, right];
  }

  // A value meeting a declared type must fit it. A wider one is copied down to it, except
  // that a fresh object literal may not name extra properties, as in TypeScript.
  /** @throws {CompileError} */
  coerce(this: Mut<this>, e: Expr, type: Type, to: Type, message: string) {
    e = this.rewrites.current(e);
    const tr = this.recOf(to);
    // A tuple's length is a 'usize', and also the literal of its count where that is known, as
    // in 'const n: 2 = t.length'.
    if (tr?.kind === "literal" && this.tupleLength(e) === to) {
      this.types.set(e, to);
      return;
    }
    // A reference that changes its value's form points at a copy in a slot of the function,
    // which an async function loses each time it stops.
    if (this.ctx.async && tr?.kind === "ref" && !this.isRefType(type) && this.typing.lower(type) !== this.typing.lower(tr.to) && this.typing.fits(type, tr.to)) {
      throw unsupported("references that convert their value inside async functions", e);
    }
    // `unsafe { expr }` is `expr`, which meets the type itself.
    if (e.kind === "unsafe") {
      this.coerce(e.expr, type, to, message);
      if (type !== to) this.types.set(e, this.coercions.has(e.expr) ? this.coercions.get(e.expr)! : this.types.get(e.expr)!);
      return;
    }
    // A widening `as` or a `satisfies` around a `?:` lends the place either side chooses, as the
    // `?:` alone does; lent as a whole, it would lend a copy no borrow keeps track of.
    if ((tr?.kind === "ref" || this.typing.optionRef(to)) && this.handsOnChoice(e)) {
      const inner = this.rewrites.current((e as Extract<Expr, { kind: "as" | "satisfies" }>).expr);
      this.coercions.delete(e);
      this.coercions.delete(inner);
      // What is lent is the operand, so a message naming the wrapper's type names the operand's.
      const named = `type '${this.typing.show(type)}'`;
      const said = message.startsWith(named) ? `type '${this.typing.show(this.types.get(inner)!)}'${message.slice(named.length)}` : message;
      this.coerce(inner, this.types.get(inner)!, to, said);
      this.types.set(e, this.coercions.get(inner) ?? this.types.get(inner)!);
      return;
    }
    // A recursive type's value meeting another type is the type it stands for, read out of
    // its block.
    const held = this.recOf(type);
    if (held?.kind === "recursive" && type !== to && !(tr?.kind === "union" && tr.members.includes(type))) {
      this.coercions.delete(e);
      this.coerce(e, held.of, to, message);
      if (!this.coercions.has(e)) this.coercions.set(e, held.of);
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
      this.coercions.set(e, to);
      return;
    }
    // A derived `equals` lends its argument to the base's, which reads the embedded base.
    const from = held?.kind === "ref" ? this.recOf(held.to) : undefined;
    const into = tr?.kind === "ref" ? this.recOf(tr.to) : undefined;
    if (this.upcasts.has(`${e.start}:${e.end}`) && tr?.kind === "ref" && !tr.mutable && from?.kind === "class" && into?.kind === "class" && this.typing.derives(this.typing.rec(type as RefType).to as ClassType, tr.to as ClassType)) return;
    // A mutable reference lent on must be reachable only through mutable references.
    if (tr?.kind === "ref" && tr.mutable && held?.kind === "ref" && held.mutable && this.rooted(e) && this.place(e)) this.changeable(e, "mutably borrow");
    if (type === to || this.typing.sameLowered(type, to) || this.typing.sameCallable(type, to)) return;
    // An array literal takes the array of JS values it meets element by element, as any does.
    if (e.kind === "array" && tr?.kind === "array" && this.holdsJs(to) && this.literalArray(e, type, to)) return;
    // An Option or array of JS values takes what each of its members would.
    if (tr?.kind !== "block" && this.holdsJs(to) && !this.typing.fits(type, to) && this.passesJs(type, to)) {
      this.coercions.set(e, to);
      return;
    }
    // Any value that crosses to JS is a JsValue there, as TypeScript's 'any' takes anything, and
    // a Fish value of a shape's fields becomes a new JS object of that shape.
    if (tr?.kind === "block" && tr.which === "JsValue") {
      // A borrowed handle passes as the handle, counted again.
      if (from?.kind === "block" && from.which === "JsValue") type = this.typing.rec(type as RefType).to;
      const shape = this.typing.jsShape(to);
      if (shape ? this.takesShape(type, shape) : this.typing.uncrossable(type) === undefined) {
        this.coercions.set(e, to);
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
    if (e.kind === "conditional" && !this.typing.fits(type, to)) {
      for (const side of [e.then, e.else].filter((s) => this.types.has(s))) {
        this.coercions.delete(side);
        this.coerce(side, this.types.get(side)!, to, message);
      }
      this.types.set(e, to);
      return;
    }
    if (isNumeric(type) && isNumeric(to)) throw new CompileError("E0101", `${message}; convert it with 'as ${this.typing.show(to)}'`, e.start, e.end);
    // A brand is made from its base only by saying so.
    if (tr?.kind === "brand" && !tr.loose && message !== "" && (type === tr.base || (isNumeric(type) && isNumeric(tr.base)))) throw new CompileError("E0101", `${message}; make one with 'as ${this.typing.show(to)}'`, e.start, e.end);
    if (tr?.kind === "ref" && (typeof type === "string" || this.typing.rec(type).kind !== "ref")) {
      this.borrow(e, type, to as RefType, message);
      return;
    }
    // A place meeting a reference or nothing is lent, as one meeting the reference is.
    const lent = this.typing.optionRef(to);
    // A `?:` lends a place either side chooses into it, as it does into a reference.
    if (lent && e.kind === "conditional" && this.typing.optionRef(type) === undefined && [e.then, e.else].some((x) => this.types.has(x) && this.rooted(x))) {
      for (const side of [e.then, e.else].filter((s) => this.types.has(s))) {
        this.coercions.delete(side);
        this.coerce(side, this.types.get(side)!, to, message);
      }
      this.types.set(e, to);
      return;
    }
    if (lent && type !== "null" && !this.typing.optionRef(type) && (typeof type === "string" || this.typing.rec(type).kind !== "ref")) {
      this.borrow(e, type, lent, message);
      this.coercions.set(e, to);
      return;
    }
    // A reference gives its value where one is wanted only by copying it: nothing moves out of
    // a borrow.
    const ref = this.recOf(type);
    if (ref?.kind === "ref" && (tr === undefined || tr.kind !== "ref") && !lent) {
      if (!this.typing.isCopy(ref.to) && this.typing.fits(ref.to, to)) {
        throw new CompileError("E0202", `can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy`, e.start, e.end);
      }
      this.coercions.set(e, ref.to);
      this.coerce(e, ref.to, to, message);
      return;
    }
    // In an instance, a member of the union a type parameter stands for goes into that union, as
    // a value awaited from a promise of `T | null` does once narrowed.
    const argument = this.recOf(tr?.kind === "param" && tr.concrete && !this.typing.fits(type, to) ? this.typing.lower(to) : undefined);
    if (argument?.kind === "union") {
      intoUnion(e, type, this.typing.lower(to) as UnionType, message, this);
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
      if (boxable && dyns.length === 1 && this.typing.membersFor(type, to as UnionType).length === 0 && !this.typing.callableOf.has(this.typing.rec(dyns[0]!).of)) {
        this.boxing(e, type, dyns[0]!, message);
        this.boxedMembers.set(e, dyns[0]!);
        this.coercions.set(e, to);
        return;
      }
      const member = e.kind === "object" ? this.lentMember(e, to as UnionType) : undefined;
      if (member) type = this.lendFields(e as Extract<Expr, { kind: "object" }>, member, message);
      const lending = e.kind === "object" && !member && tr.members.some((m) => this.recOf(m)?.kind === "object" && this.typing.holdsRef(m));
      try {
        intoUnion(e, type, to as UnionType, message, this);
      } catch (err) {
        // A literal that could have lent to a member holding references fails for want of a tag.
        if (!lending || !(err instanceof CompileError) || err.code !== "E0101") throw err;
        throw new CompileError("E0101", `can't choose which member of '${this.typing.show(to)}' this object goes into: a member holding references is chosen by its literal fields, like 'of: "a"', so give each member one and write its value here as a literal`, e.start, e.end);
      }
      return;
    }
    // A literal type takes exactly its value, so only a literal expression of that value fits.
    if (tr?.kind === "literal") {
      if (literalValue(e) !== tr.value) throw new CompileError("E0101", message, e.start, e.end);
      this.coercions.set(e, to);
      return;
    }
    if (e.kind === "object" && tr?.kind === "object" && this.typing.holdsRef(to)) type = this.lendFields(e, to as ObjectType, message);
    const shape = !this.typing.fits(type, to) ? literalShape(this.typing, e, to, this.types) : undefined;
    if (shape) {
      applyShape(shape, this.coercions, this.types);
      type = shape.type;
    }
    if (tr?.kind === "function") {
      if (!this.typing.fits(type, to)) throw new CompileError("E0101", message, e.start, e.end);
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
      throw new CompileError("E0704", `'${sub.name}' extends '${this.typing.show(to)}' by embedding one, so it can't be used as '${this.typing.show(to)}'; take '${sub.name}' itself, or hold the collection in a field and pass that`, e.start, e.end);
    }
    if (sub?.kind === "class" && tr?.kind === "class" && this.typing.derives(type as ClassType, to as ClassType)) {
      throw new CompileError("E0704", `'${sub.name}' extends '${tr.name}' by embedding one, so it can't be used as '${tr.name}'; extract an interface both classes implement`, e.start, e.end);
    }
    if (sub?.kind === "ref" && tr?.kind === "ref" && !this.typing.fits(type, to)) {
      // A shared reference to something narrower lends a copy of what this one points to.
      if (!tr.mutable && this.typing.fits(sub.to, tr.to)) {
        this.coercions.set(e, to);
        return;
      }
      if (!tr.mutable) throw new CompileError("E0101", message, e.start, e.end);
      const reason = !sub.mutable ? "a shared reference can't lend itself as mutable" : `only a reference to exactly '${this.typing.show(tr.to)}' can be lent mutably`;
      throw new CompileError("E0101", `${message}: ${reason}`, e.start, e.end);
    }
    if (!this.typing.fits(type, to) && !this.builds(e, type, to)) throw new CompileError("E0101", message, e.start, e.end);
    // An instance's concrete class may give a field its bound declares with a getter, which
    // copying field by field can't read, so that copy is rejected in the instance.
    if (this.typing.lower(type) !== type && !this.typing.fits(this.typing.lower(type), this.typing.lower(to))) throw new CompileError("E0101", message, e.start, e.end);
    this.excess(e, to);
    this.coercions.set(e, to);
  }

  /** @throws {CompileError} */
  private compared(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): Type {
    const special = this.jsEmpty(e) ?? typeofComparison(e, this) ?? this.equality(e) ?? unionComparison(e, this);
    return special ?? binaryType(this.typing, e.op, ...this.sameNumbers(e.left, this.operand(e.left), e.right, this.operand(e.right), true), e);
  }

  // Marks a narrowed variable compared with `null` or a literal to be read as declared; false when
  // there is none.
  private asDeclared(this: Mut<this>, e: Extract<Expr, { kind: "binary" }>): boolean {
    let marked = false;
    for (const [side, other] of [[e.left, e.right], [e.right, e.left]] as const) {
      const local = side.kind === "ident" ? this.localAt(side) : undefined;
      const plain = isEmpty(other, this.locals as NodeMap<Expr, LocalId>) || literalValue(other) !== undefined;
      if (!local || !plain || this.types.get(side) === local.type || this.ctx.narrowed(local) === undefined) continue;
      this.ctx.exprsState.asDeclared.add(side);
      marked = true;
    }
    return marked;
  }

  // A value meeting a reference is lent rather than handed over. A place is lent where it
  // lives, so it must be exactly the type borrowed; a temporary is converted first. Lending
  // mutably needs a place that could be assigned.
  /** @throws {CompileError} */
  private borrow(this: Mut<this>, e: Expr, type: Type, to: RefType, message: string) {
    e = this.rewrites.current(e);
    // A `?:` choosing between places lends whichever it chooses, where it lives.
    if (e.kind === "conditional" && [e.then, e.else].some((s) => this.types.has(s) && this.rooted(s))) {
      // A side read as its value before is lent instead.
      for (const side of [e.then, e.else].filter((s) => this.types.has(s))) {
        this.coercions.delete(side);
        this.coerce(side, this.types.get(side)!, to, message);
      }
      this.types.set(e, to);
      return;
    }
    // A literal lent is a temporary: it meets the type referred to, as its own literals do.
    if ((e.kind === "object" || e.kind === "array") && !this.typing.fits(type, this.typing.rec(to).to)) {
      this.coerce(e, type, this.typing.rec(to).to, message);
      type = this.coercions.get(e) ?? this.types.get(e)!;
    }
    // A narrowed variable lent mutably is lent whole, as declared.
    const lent = e.kind === "ident" && this.typing.rec(to).mutable ? this.localAt(e) : undefined;
    // Lent as the member a check narrowed it to, it keeps that member, and the check holds.
    if (lent && !this.typing.holdsRef(lent.type) && this.typing.sameLowered(lent.type, this.typing.rec(to).to)) {
      this.ctx.lendsWhole(lent, e);
      this.types.set(e, lent.type);
      type = lent.type;
    }
    // So is a narrowed field.
    const whole = e.kind === "member" && this.typing.rec(to).mutable && this.isNarrowedField(e) ? this.typing.unfolded(this.stored(e)) : undefined;
    if (whole !== undefined && this.typing.sameLowered(whole, this.typing.rec(to).to)) {
      this.ctx.instance.narrowedFields!.delete(e);
      this.types.set(e, whole);
      type = whole;
    }
    const exact = this.typing.sameLowered(type, this.typing.rec(to).to);
    // A type that holds itself may lend a part of a parameter's value as the parameter's type,
    // which each instance checks against the type it is made for.
    const part = this.typing.partOfItself(type, this.typing.rec(to).to);
    if (!exact && !part && !this.typing.fits(type, this.typing.rec(to).to)) throw new CompileError("E0101", message, e.start, e.end);
    const unlocked = this.typing.rec(to).mutable ? this.typing.unlocks(type, this.typing.rec(to).to) : undefined;
    if (unlocked) throw new CompileError("E0206", `'${unlocked}' is read-only here, so it can't be lent mutably as '${this.typing.show(this.typing.rec(to).to)}', which could change it`, e.start, e.end);
    const through = this.typing.rec(to).mutable ? this.copied(e) : undefined;
    if (through) throw new CompileError("E0206", `can't lend this mutably through '${through}', which would lend a copy; check '!== null' first and lend the variable`, e.start, e.end);
    if (this.typing.rec(to).mutable && this.readCopy(e)) throw new CompileError("E0211", "this is part of a value read through a Dyn, which gives a copy, so lending it mutably would change only the copy; change it through a method", e.start, e.end);
    // A shared borrow of anything but such a place lends a copy, but a mutable one of anything
    // that isn't a temporary must reach the place.
    if (this.typing.rec(to).mutable && this.rooted(e)) {
      if (!this.place(e) || !this.inPlace(e, to)) {
        throw new CompileError("E0101", `${message}: only a place holding exactly '${this.typing.show(this.typing.rec(to).to)}' can be lent mutably`, e.start, e.end);
      }
      this.changeable(e, "mutably borrow");
    }
    this.coercions.set(e, to);
  }

  // Whether an argument lends references to what it is passed to: borrowed, a reference, or
  // a value holding references.
  private lends(a: Expr): boolean {
    return this.typing.holdsRef(this.coercions.get(a) ?? this.types.get(a)!);
  }

  // Whether an `as` that only widens, or a `satisfies`, hands on a `?:` its operand chooses, through
  // any further such wrappers or `unsafe { }`.
  private handsOnChoice(e: Expr): boolean {
    if (e.kind === "as" && (isConstAssertion(e) || !this.widening(e))) return false;
    if (e.kind !== "as" && e.kind !== "satisfies") return false;
    let inner = this.rewrites.current(e.expr);
    while (inner.kind === "unsafe" || inner.kind === "satisfies" || (inner.kind === "as" && !isConstAssertion(inner) && this.widening(inner))) inner = this.rewrites.current(inner.expr);
    return inner.kind === "conditional";
  }

  // Whether an `as` widens, rather than converting a number, a bigint or a pointer or checking
  // a union's tag.
  private widening(e: Extract<Expr, { kind: "as" | "satisfies" }>): boolean {
    const [from, to] = [this.coercions.get(e.expr) ?? this.types.get(e.expr), this.types.get(e)];
    if (from !== undefined && to !== undefined && this.recOf(from)?.kind === "union" && from !== to && !this.typing.fits(from, to)) return false;
    return to !== undefined && !isNumeric(to) && to !== "bigint" && this.recOf(to)?.kind !== "pointer";
  }

  // Whether an expression reaches into a variable or `this`, rather than being a temporary.
  private rooted(this: Mut<this>, e: Expr): boolean {
    e = this.rewrites.current(e);
    while ((e.kind === "member" && !this.calls.has(e)) || this.element(e)) e = e.object;
    return e.kind === "this" || (e.kind === "ident" && this.ctx.lookup(e.name) !== undefined);
  }

  // Whether a check narrowed a field read.
  private isNarrowedField(e: Expr): boolean {
    return this.ctx.instance.narrowedFields?.has(e) ?? false;
  }

  // Whether lending a place to `to` points to where it lives, rather than to a copy: it holds
  // exactly that type, and isn't a variable or field narrowed to part of a union.
  /** @throws {CompileError} */
  private inPlace(e: Expr, to: RefType): boolean {
    const type = this.types.get(e)!;
    const local = e.kind === "ident" ? this.localAt(e) : undefined;
    const ref = this.recOf(type);
    const held = ref?.kind === "ref" ? ref.to : type;
    if (local && local.type !== type && this.recOf(held)?.kind === "union") return false;
    // A field narrowed to one member lives inside its union, where it is stored as declared.
    const declared = this.ctx.instance.narrowedFields?.get(e);
    if (declared !== undefined && (this.recOf(type)?.kind === "union" || this.typing.lower(this.typing.unfolded(this.stored(e))) !== this.typing.lower(declared))) return false;
    // A field read through a type parameter may be stored as a different type by the concrete
    // type; at a definition, where nothing is concrete, each instance decides.
    if (e.kind === "member" && declared === undefined && this.typing.lower(this.stored(e)) !== this.typing.lower(type)) return false;
    return typeof type !== "string" && this.typing.rec(type).kind === "ref" ? this.typing.fits(type, to) : (this.typing.sameLowered(type, this.typing.rec(to).to) && this.typing.sameLowered(this.typing.rec(to).to, type)) || this.typing.partOfItself(type, this.typing.rec(to).to);
  }

  // Without lifetimes, a reference variable can only be pointed at something that lives as long
  // as it: a place lent where it lives, or another reference variable, declared in its own
  // scope or an enclosing one.
  /** @throws {CompileError} */
  private rebind(this: Mut<this>, target: Local, e: Expr) {
    const to = target.type as RefType;
    // A `?:`, or a call's result, lives as long as what it points into.
    if (e.kind === "conditional") {
      if (this.types.has(e.then)) this.rebind(target, e.then);
      if (this.types.has(e.else)) this.rebind(target, e.else);
      return;
    }
    const from = this.borrowsFrom.get(e);
    if (from) {
      from.forEach((s) => this.rebind(target, s));
      return;
    }
    let root: Expr = e;
    while (root.kind === "member" && !this.calls.has(root)) root = root.object;
    const local = root.kind === "ident" ? this.localAt(root) : undefined;
    const lives = root.kind === "this" || (local !== undefined && this.ctx.depthOf(local) <= this.ctx.depthOf(target));
    if (!lives || !this.place(e) || !this.inPlace(e, to)) {
      throw new CompileError("E0204", `'${target.name}' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as '${target.name}'`, e.start, e.end);
    }
  }

  // The member holding references an object literal meeting a union goes into: the one object
  // member whose literal fields its literal properties all match, as a tag picks it.
  private lentMember(e: Extract<Expr, { kind: "object" }>, to: UnionType): ObjectType | undefined {
    const found = this.typing.rec(to).members.filter((m): m is ObjectType => {
      if (this.recOf(m)?.kind !== "object" || !this.typing.holdsRef(m)) return false;
      return this.typing.rec(m as ObjectType).fields.every((f) => {
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
  private lendFields(this: Mut<this>, e: Extract<Expr, { kind: "object" }>, to: ObjectType, message: string): Type {
    const own = this.types.get(e) as ObjectType;
    const lent = this.typing.rec(own).fields.map((f) => {
      const want = this.typing.field(to, f.name)?.type;
      const p = this.winner(e, f.name);
      if (!want || !p || p.kind === "spread" || !this.typing.holdsRef(want) || this.typing.fits(f.type, want)) return f;
      if (p.kind === "property") this.coerce(p.value, this.types.get(p.value)!, want, message);
      else if (p.kind === "shorthand") {
        // A shorthand lends its variable where it lives, so only as exactly what it holds.
        const local = this.localAt(p)!;
        const wr = this.recOf(want);
        if (wr?.kind !== "ref" || wr.mutable || this.typing.lower(local.type) !== this.typing.lower(wr.to)) {
          throw new CompileError("E0101", `${message}: write '${p.name}: ${p.name}' to lend '${p.name}' here`, p.start, p.end);
        }
      }
      return { ...f, type: want };
    });
    const type = this.typing.objectType(lent);
    this.types.set(e, type);
    return type;
  }

  // An object literal builds a class it is declared as, without its constructor, when it
  // gives every field and the class has no field hidden from it. Nested literals may build
  // the classes of nested fields.
  /** @throws {CompileError} */
  private builds(this: Mut<this>, e: Expr, type: Type, to: Type): boolean {
    e = this.rewrites.current(e);
    const c = this.recOf(to);
    if (e.kind !== "object" || typeof type === "string" || c?.kind !== "class") return false;
    this.ctx.classOf(to as ClassType);
    for (const f of this.typing.allFields(to as ClassType)) {
      if ((f.access ?? "public") !== "public") {
        throw new CompileError("E0709", `an object literal can't build '${c.name}' because '${f.name}' is ${f.access}; use 'new'`, e.start, e.end);
      }
      const given = this.typing.field(type, f.name);
      if (!given) {
        throw new CompileError("E0101", `property '${f.name}' is missing in type '${this.typing.show(type)}' but required in type '${c.name}'`, e.start, e.end);
      }
      const prop = e.props.find((p) => p.kind === "property" && p.key === f.name);
      if (!this.typing.fits(given.type, f.type) && !(prop?.kind === "property" && this.builds(prop.value, given.type, f.type))) {
        throw new CompileError("E0101", `type '${this.typing.show(given.type)}' is not assignable to type '${this.typing.show(f.type)}'`, (prop ?? e).start, (prop ?? e).end);
      }
    }
    return true;
  }

  /** @throws {CompileError} */
  excess(e: Expr, to: Type) {
    e = this.rewrites.current(e);
    to = this.typing.unfold(to);
    if (e.kind !== "object" || typeof to === "string" || this.typing.isUnknown(to)) return;
    // Against a union, a name no member has is excess, and the literal is checked as the one
    // member that has all its names, when one does.
    const u = this.typing.rec(to);
    if (u.kind === "union") {
      const names = e.props.flatMap((p) => (p.kind === "spread" ? [] : [p.kind === "shorthand" ? p.name : (p as { key: string }).key]));
      const objects = u.members.map((t) => this.typing.unfold(t)).flatMap((t) => {
        const m = this.recOf(t);
        return m?.kind === "object" || m?.kind === "class" ? [t as ObjectType | ClassType] : [];
      });
      if (objects.length === 0) return;
      const missing = names.find((n) => !objects.some((m) => this.typing.field(m, n)));
      if (missing !== undefined) {
        const p = e.props.find((p) => p.kind !== "spread" && (p.kind === "shorthand" ? p.name : (p as { key: string }).key) === missing)!;
        throw new CompileError("E0101", `object literal may only specify known properties, and '${missing}' does not exist in type '${this.typing.show(to)}'`, p.start, p.end);
      }
      const whole = objects.filter((m) => names.every((n) => this.typing.field(m, n)));
      if (whole.length === 1) this.excess(e, whole[0]!);
      return;
    }
    for (const p of e.props) {
      // A spread's fields aren't checked as excess, as in TypeScript.
      if (p.kind === "spread") continue;
      const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
      const found = this.typing.field(to, name);
      if (!found) {
        throw new CompileError("E0101", `object literal may only specify known properties, and '${name}' does not exist in type '${this.typing.show(to)}'`, p.start, p.end);
      }
      if (p.kind === "property") this.excess(p.value, found.type);
    }
  }

  // Properties are checked in source order, which is the order they run in.
  // `{ ...a, x: 1, ...b }`: the fields of each part in order, a later one replacing an earlier one
  // of its name. A spread takes an object's fields, or an instance's public ones.
  /** @throws {CompileError} */
  private objectSpread(this: Mut<this>, e: Extract<Expr, { kind: "object" }>): Type {
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
      const low = this.typing.lowerKeepingBrands(this.isRefType(t) ? this.typing.rec(t).to : t);
      // An object-typed parameter stands for any type with its fields, which its bound names.
      const lr = this.recOf(low);
      const br = lr?.kind === "param" ? this.recOf(lr.bound) : undefined;
      const heldType = br?.kind === "object" ? (lr as ParamRecord).bound! : low;
      const held = this.recOf(heldType);
      if (held === undefined || (held.kind !== "object" && held.kind !== "class") || this.typing.isTuple(heldType)) {
        throw new CompileError("E0119", `'...' in an object literal spreads an object or an instance, not '${this.typing.show(t)}'`, p.start, p.end);
      }
      if (this.typing.holdsRef(heldType)) throw unsupported("spreads of values holding references", p);
      if (rustClassOf(this.typing, heldType)) throw new CompileError("E1004", `a Rust '${rustClassOf(this.typing, heldType)!.name}' has no fields Fish can read, so it can't be spread; call its methods for what it holds`, p.start, p.end);
      const parts = held.kind === "class" ? this.typing.allFields(heldType as ClassType).filter((f) => (f.access ?? "public") === "public") : held.fields;
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
    return this.typing.objectType([...merged.values()]);
  }

  // Whether a value may be a place's, which taking it copies: a place, or any branch of `!`,
  // `?:`, `??` or a `match` giving one, a match arm's block through its `return`s. A place here
  // is what codegen copies rather than takes over: any field read but a getter's, a shared
  // value's copy or one the runtime computes, through unions and optional chains too.
  private copiesPlace(e: Expr): boolean {
    // A reference, whatever gives it, is read where its value lives; an assignment gives its
    // target's value.
    const given = this.types.get(e);
    if ((given !== undefined && this.isRefType(given)) || e.kind === "assign") return true;
    if (e.kind === "nonNull" || (e.kind === "as" && this.recOf(this.coercions.get(e.expr) ?? this.types.get(e.expr))?.kind === "union" && !this.typing.fits(this.coercions.get(e.expr) ?? this.types.get(e.expr)!, given!))) return this.copiesPlace(e.expr);
    if (e.kind === "conditional") return (this.types.has(e.then) && this.copiesPlace(e.then)) || (this.types.has(e.else) && this.copiesPlace(e.else));
    if (e.kind === "binary" && e.op === "??") return this.copiesPlace(e.left) || this.copiesPlace(e.right);
    if (e.kind === "match") return e.arms.some((a) => (a.body.kind === "block" ? this.armReturns(a.body).some((x) => this.copiesPlace(x)) : this.copiesPlace(a.body)));
    if (e.kind === "member") return !this.calls.has(e) && !this.ctx.copiesOut.has(e) && !this.computed.has(e);
    if (e.kind === "index") return this.element(e);
    return e.kind === "ident" || e.kind === "this";
  }

  // The values a match arm's block gives, through its own `return`s, not those of functions in it.
  private armReturns(block: Stmt): Expr[] {
    const found: Expr[] = [];
    walkWhile({ of: "stmt", node: block }, (n) => {
      if ((n.of === "expr" && n.node.kind === "arrow") || (n.of === "stmt" && n.node.kind === "function")) return false;
      if (n.of === "stmt" && n.node.kind === "return" && n.node.value) found.push(n.node.value);
      return true;
    });
    return found;
  }

  /** @throws {CompileError} */
  private property(this: Mut<this>, p: ObjectProp): Field {
    const field = this.propertyField(p);
    // A generic function value is held as it is, captures nothing, and is called by name.
    const fr = this.recOf(field.type);
    if (fr?.kind === "closure" && fr.generic) return field;
    // A value for a field the object's type holds a Dyn in is boxed into it.
    const boxed = p.kind === "property" ? this.ctx.exprsState.wanted.get(p.value) : undefined;
    // `null`, or an Option, already is what an optional Dyn field holds.
    const plain = this.typing.lower(field.type);
    const already = plain === "null" || (typeof plain !== "string" && this.typing.rec(plain).kind === "union") || (boxed !== undefined && plain === this.typing.lower(boxed));
    if (p.kind === "property" && boxed !== undefined && typeof boxed !== "string" && this.recOf(boxed)?.kind === "dyn" && !already) {
      this.coerce(p.value, field.type, boxed, `type '${this.typing.show(field.type)}' is not assignable to type '${this.typing.show(boxed)}'`);
      return { ...field, type: boxed };
    }
    // An arrow written for a field the object's type stores a callable in is boxed into it.
    const want = p.kind === "property" ? this.ctx.exprsState.wanted.get(p.value) : undefined;
    if (typeof field.type !== "string" && this.typing.rec(field.type).kind === "closure" && want && this.isCallable(want)) {
      this.coerce((p as Extract<ObjectProp, { kind: "property" }>).value, field.type, want, `type '${this.typing.show(field.type)}' is not assignable to type '${this.typing.show(want)}'`);
      return { ...field, type: want };
    }
    // With no type to say which, a sync arrow is stored as a callable of its own signature.
    const fn = this.recOf(field.type);
    if (fn?.kind === "closure" && p.kind === "property" && this.recOf(fn.returns)?.kind !== "future") {
      const own = this.typing.callableFrom({ kind: "function", name: fn.name, names: fn.params.map((_, i) => `p${i}`), params: fn.params, returns: fn.returns, ...(fn.throws && { throws: fn.throws }), fields: [] });
      this.coerce(p.value, field.type, own, `type '${this.typing.show(field.type)}' is not assignable to type '${this.typing.show(own)}'`);
      return { ...field, type: own };
    }
    if (typeof field.type !== "string" && this.typing.rec(field.type).kind === "closure") throw unsupported("functions stored in objects", p);
    return field;
  }

  /** @throws {CompileError} */
  private propertyField(this: Mut<this>, p: ObjectProp): Field {
    if (p.kind === "property") {
      // An object stores its fields, so an arrow written in one owns what it captures.
      if (p.value.kind === "arrow") this.ctx.exprsState.owning.add(p.value);
      const type = this.value(p.value);
      // A value written `as const` keeps its literal type.
      if (isConstAssertion(this.rewrites.current(p.value))) return { name: p.key as string, type };
      const widened = this.typing.widenLet(type);
      if (widened !== type) this.coerce(p.value, type, widened, "");
      return { name: p.key as string, type: widened };
    }
    if (p.kind !== "shorthand") {
      throw unsupported(p.kind === "spread" ? "spread elements" : p.kind === "method" ? "methods in object literals" : "accessors in object literals", p);
    }
    if (p.default) throw new CompileError("E0004", "'=' in an object literal is only valid in a destructuring pattern", p.start, p.end);
    // A shorthand reads its variable like a name does: within its switch case, narrowed, and
    // widened from an enum member to the enum like any property.
    const local = this.ctx.lookup(p.name, p);
    if (!local) throw new CompileError("E0401", `cannot find name '${p.name}'${didYouMean(p.name, this.ctx.names(p.start))}`, p.start, p.end);
    if (!this.ctx.reachable(local)) {
      throw new CompileError("E0403", `'${p.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, p.start, p.end);
    }
    this.locals.set(p, local.localId);
    const js = this.typing.jsRead(local.type, this.ctx.narrowed(local));
    if (js === "one") throw new CompileError("E1005", `'${p.name}' is read out of JS as a '${this.typing.show(this.ctx.narrowed(local)!)}' here; write '${p.name}: ${p.name}'`, p.start, p.end);
    if (js === "several") return { name: p.name, type: this.stillJs(local.type) };
    return { name: p.name, type: this.typing.widenEnum(this.ctx.narrowed(local) ?? local.type) };
  }

  // What a variable holding a JsValue reads as where `typeof` left several kinds of JS value:
  // the JsValue, taken out of a union holding it, through a reference too.
  private stillJs(t: Type): Type {
    if (this.isRefType(t)) return this.typing.refType(this.stillJs(this.typing.rec(t).to), this.typing.rec(t).mutable);
    const u = this.recOf(t);
    return u?.kind === "union" ? u.members.find((t) => this.typing.isPlainJs(t))! : t;
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  /** @throws {CompileError} */
  private assignable(this: Mut<this>, target: Expr, reads: boolean): Type {
    const [outer, updating] = [this.ctx.exprsState.writing, this.ctx.exprsState.updating];
    const written = this.rewrites.current(target);
    const place = written.kind === "nonNull" ? this.rewrites.current(written.expr) : written;
    this.ctx.exprsState.writing = target;
    this.ctx.exprsState.updating = reads ? place : undefined;
    try {
      const type = this.assignableTo(target, reads);
      // A field narrowed to one member, read and written back as `+=` does, keeps that member in
      // its union's payload; any other write is of the place as declared.
      const declared = reads ? this.ctx.instance.narrowedFields?.get(place) : undefined;
      const kept = declared === undefined ? undefined : this.ctx.narrowedField(place);
      if (kept !== undefined && this.recOf(kept)?.kind !== "union" && this.typing.lower(this.typing.unfolded(this.stored(place))) === this.typing.lower(declared!)) {
        this.types.set(place, kept);
        return kept;
      }
      this.ctx.instance.narrowedFields?.delete(place);
      if (reads && this.jsMembers.has(target)) throw unsupported("compound assignments to a package's properties", target);
      return type;
    } finally {
      this.ctx.exprsState.writing = outer;
      this.ctx.exprsState.updating = updating;
    }
  }

  // Whether a `!` is on a value that can't be empty, decided where the `!` is first checked and
  // marked there. Only `null` itself is always empty.
  /** @throws {CompileError} */
  private redundant(this: Mut<this>, e: Extract<Expr, { kind: "nonNull" }>, given: Type): boolean {
    if ((this.rewrites.current(e) as Bang).redundant === undefined) this.ctx.asWritten();
    const bang = this.rewrites.current(e) as Bang;
    if (bang.redundant !== undefined) return bang.redundant;
    const held = this.isRefType(given) ? this.typing.rec(given).to : given;
    if (held === "null") throw new CompileError("E0108", "'!' takes the value out of an Option, and this is a 'null', which is always empty", e.start, e.end);
    const marked: Bang = { ...bang, redundant: !this.typing.isOption(held) };
    this.rewrites.replace(e, marked as Expr);
    return marked.redundant!;
  }

  /** @throws {CompileError} */
  private assignableTo(this: Mut<this>, target: Expr, reads: boolean): Type {
    // Only a `!` that can't fail is a place: the place it is written on.
    if (target.kind === "nonNull") {
      const type = this.assignableTo(target.expr, reads);
      if (!this.redundant(target, this.types.get(target.expr)!)) throw new CompileError("E0003", "can only assign to a variable or a field", target.start, target.end);
      this.types.set(target, this.types.get(target.expr)!);
      return type;
    }
    this.untuple(target);
    target = this.rewrites.current(target);
    if ((target.kind === "member" || target.kind === "index") && target.object.kind === "ident") this.ctx.exprsState.objects.add(target.object);
    const setter = target.kind === "member" ? this.accessor(target) : undefined;
    intoMember(this.typing, target, this.types);
    const indexed = target.kind === "index" ? this.read(target.object) : undefined;
    if (indexed !== undefined && stringLike(this.typing, indexed)) {
      throw new CompileError("E0802", "strings can't be changed; build a new one instead, joining parts with '+'", target.start, target.end);
    }
    if (indexed !== undefined && this.typing.isPlainJs(indexed)) throw new CompileError("E1005", "writing a JS value's elements isn't supported yet; a 'JsValue' is read with 'at'", target.start, target.end);
    const holder = target.kind === "member" ? this.types.get(target.object) : undefined;
    if (holder && this.isArray(this.isRefType(holder) ? this.typing.rec(holder).to : holder)) {
      const { name } = target as { name: string };
      const capacity = name === "capacity";
      if (TYPED_MEMBERS.has(name)) throw new CompileError("E0208", `a typed array's '${name}' can't be set`, target.start, target.end);
      throw new CompileError("E0208", capacity ? "an array's 'capacity' can't be set; use 'reserve(n)' to make room, or 'shrinkToFit()' to give it back" : "an array's 'length' can't be set; use 'pop()' to remove elements, or 'push' to add them", target.start, target.end);
    }
    const table = holder && (this.isRefType(holder) ? this.typing.rec(holder).to : holder);
    if (table && typeof table !== "string" && this.typing.rec(table).kind === "map") {
      throw new CompileError("E0208", "a Map's or a Set's 'size' can't be set; use 'delete' or 'clear' to remove entries", target.start, target.end);
    }
    if (holder && stringLike(this.typing, this.isRefType(holder) ? this.typing.rec(holder).to : holder)) {
      throw new CompileError("E0802", `a string's '${(target as { name: string }).name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    }
    // A top-level const, or a part of one, was computed while compiling and never changes.
    let root: Expr = target;
    while (root.kind === "member" || root.kind === "index" || root.kind === "nonNull") root = root.kind === "nonNull" ? root.expr : root.object;
    if (root.kind === "ident" && !this.ctx.lookup(root.name) && this.byName.has(`const ${root.name}`)) {
      throw new CompileError("E0207", `'${root.name}' is a top-level const, computed while compiling, so it never changes; a global that changes is a const holding an Atomic or a Lock`, target.start, target.end);
    }
    if (!this.place(target)) throw new CompileError("E0003", "can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      const read = this.value(target);
      // Below a read through a Dyn, the place is part of a copy.
      if (!this.computed.has(target) && this.readCopy(target)) throw new CompileError("E0211", "this is part of a value read through a Dyn, which gives a copy, so writing it would change only the copy; change it through a method", target.start, target.end);
      if (this.computed.has(target)) {
        const holder = this.types.get((target as Extract<Expr, { kind: "member" }>).object);
        // A JS handle's property is written in JS, whatever holds the handle.
        const handle = holder === undefined ? undefined : this.typing.jsShape(this.isRefType(holder) ? this.typing.rec(holder).to : holder);
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
      const initialises = target.kind === "member" && target.object.kind === "this" && this.self?.constructor && this.typing.rec(this.self.type).fields.some((f) => f.name === target.name);
      if ((target.kind === "ident" || target.kind === "member") && !initialises && this.isRefType(declared) && this.typing.rec(declared).mutable) {
        // What a type parameter stands for may be wider than any value written here.
        if (this.recOf(this.typing.rec(declared).to)?.kind === "param") {
          throw new CompileError("E0206", `can't assign a whole value through '${this.placeText(target)}', which may point to a wider value; assign its fields instead`, target.start, target.end);
        }
        if (target.kind === "member") this.changeable(target, "assign to");
        else if (this.ctx.captured(this.localAt(target)!)) this.ctx.changesCapture(this.localAt(target)!, "", "assign to", target, true);
        this.types.set(target, declared);
        this.coercions.set(target, this.typing.rec(declared).to);
        return this.typing.rec(declared).to;
      }
      // A whole value goes in a variable as declared, whatever a check narrowed it to.
      if (target.kind === "ident" && !reads && declared !== read && !this.isRefType(declared)) {
        this.types.set(target, declared);
        this.ctx.copiesOut.delete(target);
      }
      intoMember(this.typing, target, this.types);
      this.changeable(target, "assign to");
      const type = this.stored(target);
      this.types.set(target, type);
      return type;
    }
    const type = this.ctx.paramTypes(this.ctx.instanceOf(setter))[0]!;
    if (reads && this.value(target) !== type) {
      throw new CompileError("E0705", `the getter and setter of '${target.name}' must have the same type`, target.start, target.end);
    }
    this.changeable(target, "assign to", true);
    this.setters.set(target, this.ctx.instanceOf(setter).id);
    this.types.set(target, type);
    return type;
  }

  // The type a write stores. Read through a type parameter, a field has its bound's type, but
  // in an instance it is stored as the concrete type's field, which may be narrower.
  /** @throws {CompileError} */
  private stored(target: Expr): Type {
    if (target.kind !== "member") return this.types.get(target)!;
    // Through a reference, what it points to stores the field; a field a check narrowed holds
    // its member inside the union.
    const holder = this.typing.lower(this.isNarrowedField(target.object) ? this.types.get(target.object)! : this.stored(target.object));
    const hr = this.recOf(holder);
    const object = hr?.kind === "ref" ? this.typing.lower(hr.to) : holder;
    if (stringLike(this.typing, object)) throw new CompileError("E0802", `a string's '${target.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    if (typeof object !== "string" && this.typing.rec(object).kind === "union") {
      throw new CompileError("E0109", `can't assign to '${target.name}' through '${this.typing.show(object)}'; narrow it to one member first`, target.start, target.end);
    }
    const found = typeof object !== "string" && this.typing.field(object, target.name)?.type;
    // A pattern or brand the field was declared with is what a write must match, though lowering
    // made it a string or the brand's base.
    const declared = this.types.get(target)!;
    if (found && (this.typing.holdsPattern(declared) || this.typing.holdsBrand(declared)) && this.typing.lower(declared) === this.typing.lower(found)) return declared;
    return found || declared;
  }

  // The setter an assignment to a class member runs, if it is an accessor. A getter alone
  // makes the property read-only.
  /** @throws {CompileError} */
  private accessor(this: Mut<this>, target: Extract<Expr, { kind: "member" }>): Body | undefined {
    const object = this.typing.lower(this.value(target.object));
    const or = this.recOf(object);
    if (or?.kind !== "class" || this.typing.field(object as ClassType, target.name)) return undefined;
    const c = this.ctx.classOf(object as ClassType);
    const setter = inherited(this.arenas, c, "setters", target.name);
    if (!setter && inherited(this.arenas, c, "getters", target.name)) {
      throw new CompileError("E0208", `cannot assign to '${target.name}' because it is a read-only property`, target.start, target.end);
    }
    if (setter) this.visible(setter.access, setter.declared ?? setter.owner!, target.name, target);
    return setter;
  }

  // A variable, `this`, or a field inside one: somewhere a value lives, rather than a
  // temporary.
  // A getter's result is a temporary, so a path through one isn't a place.
  private place(this: Mut<this>, e: Expr): boolean {
    e = this.rewrites.current(e);
    for (e = this.bare(e); (e.kind === "member" && !e.optional && !this.calls.has(e)) || this.element(e); e = this.bare(e.object)) {
      // An enum's member, and a field every member of a union shares, are values, not places.
      const object = this.types.get(e.object);
      const held = typeof object !== "string" && this.recOf(object)?.kind === "ref" ? this.typing.rec(object as RefType).to : object;
      if (!held || (typeof held !== "string" && this.typing.rec(held).kind === "union")) return false;
    }
    return e.kind === "this" || (e.kind === "ident" && this.ctx.lookup(e.name) !== undefined);
  }

  // Checks that a place, already typed, may change. `const` is deeply immutable, so no field
  // of a constant can change, and `this` changes only in a constructor or a method declared
  // `this: Mut<this>`.
  // A setter changes its whole object, whatever field it is named for: `setter` says one runs.
  /** @throws {CompileError} */
  private changeable(this: Mut<this>, target: Expr, action: string, setter = false) {
    target = this.rewrites.current(target);
    // Below a read through a Dyn, the place is part of a copy.
    if (this.readCopy(target) && !this.computed.has(target)) throw new CompileError("E0211", `cannot ${action} this: it is part of a value read through a Dyn, which gives a copy, so the change would be lost; change it through a method`, target.start, target.end);
    let root = this.bare(target);
    let path = "";
    // The part of the path naming the field the setter is for.
    let named: string | undefined;
    // Through a mutable reference anything below it may change, whatever variable holds the
    // reference, as long as nothing above it is shared.
    let throughMut = false;
    while (root.kind === "member" || this.element(root)) {
      if (root.kind === "member") this.readonly(root, target, action);
      const holder = this.types.get(root.object);
      const referred = typeof holder !== "string" && this.recOf(holder)?.kind === "ref" ? this.typing.rec(holder as RefType).to : holder;
      if (typeof referred !== "string" && this.recOf(referred)?.kind === "shared") {
        const why = (this.typing.rec(referred as SharedType)).which === "shared" ? "is shared between threads" : "is an 'Rc', whose value every clone of it reads";
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(this.bare(root.object))}' ${why}; change it inside '${this.placeText(this.bare(root.object))}.update(...)'`, target.start, target.end);
      }
      if (this.ctx.sharing && this.typing.interiorMutable(this.types.get(root)!) && this.isParamPath(root)) {
        const why = this.ctx.counting ? `'${this.placeText(root)}' is borrowed where it lives, outside 'update'` : `other tasks borrow '${this.placeText(root)}' without the lock`;
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' inside 'update': ${why}, so it changes only through its own methods`, target.start, target.end);
      }
      if (typeof holder !== "string" && this.recOf(holder)?.kind === "ref" && this.typing.rec(holder as RefType).mutable) throughMut = true;
      else if (typeof holder !== "string" && this.recOf(holder)?.kind === "ref") {
        throw new CompileError("E0206", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(this.bare(root.object))}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
      }
      // A rest tuple's element is named by its place in the tuple, its array left unsaid.
      if (root.kind === "index" && root.index.kind === "int" && this.restStarts.has(root.object)) path = `[${BigInt(this.restStarts.get(root.object)!) + root.index.value}]${path}`;
      else if (!(root.kind === "member" && this.restStarts.has(root))) path = `${root.kind === "member" ? (/^\d+$/.test(root.name) ? `[${root.name}]` : `.${shownName(root.name)}`) : "[...]"}${path}`;
      // The last part, the field the setter is named for.
      named ??= path;
      root = this.bare(root.object);
    }
    if (this.ctx.sharing && path === "" && this.isParamPath(root)) {
      const whole = this.types.get(root)!;
      const wr = this.recOf(whole);
      if (this.typing.interiorMutable(wr?.kind === "ref" ? wr.to : whole)) {
        const why = this.ctx.counting ? "its interior-mutable fields are borrowed where they live, outside 'update'" : "other tasks borrow its interior-mutable fields without the lock";
        throw new CompileError("E0304", `cannot ${action} '${this.placeText(target)}' as a whole inside 'update': ${why}; change its other fields one by one`, target.start, target.end);
      }
    }
    // A setter may change any field of its object, as a method taking `Mut<this>` may.
    if (setter && target.kind === "member") this.ctx.changesPath(root.kind === "ident" ? this.localAt(root)! : "this", path.slice(0, path.length - named!.length), `call the setter of '${target.name}' on`, target.object);
    if (root.kind === "this" || root.kind === "super") return this.changesThis(path, action, target);
    this.changesLocal(this.localAt(root)!, path, action, target, throughMut);
  }

  // A value moved into a new `Dyn`: its type implements the interface, and owns everything and
  // changes only under locks, since a Dyn hides what it holds from every later check and may
  // cross to another thread.
  /** @throws {CompileError} */
  private boxing(this: Mut<this>, e: Expr, type: Type, to: DynType, message: string) {
    e = this.rewrites.current(e);
    if (this.typing.promiseElement(this.typing.rec(to).of) !== undefined) return this.boxingFuture(e, this.typing.lower(type), to, message);
    if (this.relaying(this.typing.lower(type), to)) {
      if (this.isRefType(this.types.get(e)!)) throw new CompileError("E0202", "can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
      this.dynMembers.set(`${this.typing.keyOf(this.typing.lower(type))} ${this.typing.keyOf(this.typing.lower(to))}`, { methods: [], fields: [], clone: "copy" });
      return void this.coercions.set(e, to);
    }
    if (this.typing.callableOf.has(this.typing.rec(to).of)) this.storing(e, this.typing.lower(type), to, message);
    else if (this.isRefType(this.types.get(e)!)) throw new CompileError("E0202", "can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
    const held = this.typing.lower(type);
    if (typeof held !== "string" && this.typing.rec(held).kind === "dyn") throw new CompileError("E0801", `a '${this.typing.show(held)}' can't become a '${this.typing.show(to)}' yet; box the value it was made from`, e.start, e.end);
    let rust: RustClass | undefined;
    if (this.typing.holdsPart(held, (u) => (rust ??= rustClassOf(this.typing, u)) !== undefined)) throw new CompileError("E1004", `a Rust '${rust!.name}' can't become a '${this.typing.show(to)}' yet; call its methods on it, or take it as a generic parameter`, e.start, e.end);
    const reason = this.typing.callableOf.has(this.typing.rec(to).of) ? undefined : unsatisfied(type, this.typing.rec(to).of, this.ctx.members(), e);
    if (reason) throw new CompileError("E0101", `${message}: ${reason}`, e.start, e.end);
    const blocker = this.unsent(held);
    if (blocker) {
      const why = typeof blocker !== "string" && this.typing.rec(blocker).kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && this.typing.rec(blocker).kind === "pointer" ? "is a raw pointer no thread can vouch for" : typeof blocker !== "string" && this.typing.rec(blocker).kind === "shared" ? COUNTED_UNLOCKED : "borrows from where it was made";
      throw new CompileError("E0303", `a '${this.typing.show(to)}' may cross to another thread, so it can't hold a '${this.typing.show(blocker)}', which ${why}`, e.start, e.end);
    }
    // A Dyn of a generic interface made in a generic body is keyed as codegen finds it, lowered.
    if (typeof held === "string" || this.typing.rec(held).kind !== "param") {
      const table = this.dynTable(e, held, this.typing.lower(to) as DynType);
      this.dynMembers.set(`${this.typing.keyOf(held)} ${this.typing.keyOf(this.typing.lower(to))}`, table);
      this.ctx.dynOf(e, table);
    }
    this.coercions.set(e, to);
  }

  // A stored callable held in one taking and giving the same, that throws what it throws or
  // more: its calls are passed on through a slot of their own.
  private relaying(from: Type, to: DynType): boolean {
    const d = this.recOf(from);
    const [f, g] = [this.recOf(d?.kind === "dyn" ? this.typing.callableOf.get(d.of) : undefined), this.recOf(this.typing.callableOf.get(this.typing.rec(to).of))];
    if (!f || !g || !g.throws || f.params.length !== g.params.length || this.typing.lower(f.returns) !== this.typing.lower(g.returns)) return false;
    return f.params.every((p, i) => this.typing.lower(p) === this.typing.lower(g.params[i]!)) && (!f.throws || this.typing.fits(f.throws, g.throws));
  }

  // A future stored as a `Promise<T>`: one an async function's call made, giving T, throwing
  // nothing, and owning what it holds, since it may be awaited on any thread.
  /** @throws {CompileError} */
  private boxingFuture(this: Mut<this>, e: Expr, type: Type, to: DynType, message: string) {
    const r = this.recOf(type);
    if (r?.kind === "param") return this.coercions.set(e, to), undefined;
    if (r?.kind !== "future" || type === YIELD_NOW || type === SLEEP || this.typing.leafOf.has(type as FutureType)) {
      const what = r?.kind === "future" ? "; store the async function's call instead" : "";
      throw new CompileError("E0101", `${message}${what}`, e.start, e.end);
    }
    if (this.typing.lower(r.gives) !== this.typing.lower(this.typing.promiseElement(this.typing.rec(to).of)!)) throw new CompileError("E0101", message, e.start, e.end);
    if (r.throws) throw new CompileError("E0602", `a stored '${this.typing.show(to)}' can't throw yet, and this one can throw '${this.typing.show(r.throws)}'; await it where it is made, or catch inside the async function`, e.start, e.end);
    const blocker = this.unsent(type);
    if (blocker) throw new CompileError("E0303", `a stored '${this.typing.show(to)}' may be awaited on any thread, so its future can't hold a '${this.typing.show(blocker)}'`, e.start, e.end);
    this.dynMembers.set(`${this.typing.keyOf(type)} ${this.typing.keyOf(to)}`, { methods: [], fields: [], clone: undefined });
    this.coercions.set(e, to);
  }

  // A closure stored as a callable: it fits the function type, owns what it captures, changes
  // none of it, and can run any number of times.
  /** @throws {CompileError} */
  private storing(this: Mut<this>, e: Expr, type: Type, to: DynType, message: string) {
    e = this.rewrites.current(e);
    const fn = this.typing.callableOf.get(this.typing.rec(to).of)!;
    const c = this.recOf(type);
    if (c?.kind !== "closure") {
      // A function-typed parameter is checked when its instance knows the closure.
      if (c?.kind === "function" || c?.kind === "param") return;
      throw new CompileError("E0101", message, e.start, e.end);
    }
    if (!this.typing.fits(type, fn)) throw new CompileError("E0101", message, e.start, e.end);
    const body = this.ctx.closureBody(type as ClosureType);
    // A call through a stored callable passes every argument, with no default to fall back on.
    if (bodyOf(this.arenas, body).params.some((p) => this.defaulted.has(p))) throw new CompileError("E0801", "a closure with default parameter values can't be stored as a value yet, since calls through it pass every argument; give the parameters no defaults", e.start, e.end);
    const capture = (name: string) => `'${name}'`;
    const borrowed = c.fields.find((f) => this.isRefType(f.type));
    if (borrowed) throw new CompileError("E0210", `this closure borrows ${capture(borrowed.name)}, but a stored callable owns what it captures; write the closure where it is stored, so it captures by move, or as 'move (...) => ...'`, e.start, e.end);
    if (c.once) throw new CompileError("E0210", `this closure moves ${capture(c.once)} out of what it captures, so it can run only once, but a stored callable may run any number of times; clone ${capture(c.once)} inside it instead`, e.start, e.end);
    const changed = this.arenas.localOf([...(body.changed ?? [])][0]);
    if (changed) throw new CompileError("E0210", `this closure changes ${capture(changed.name)}, which it captures, but a stored callable can't change what it captures; keep that state in an 'Atomic' or a 'Lock'`, e.start, e.end);
    // Each call of an async callable runs on its own copy of what it captures, which would split
    // an Atomic's or a Lock's state in two.
    const pinned = (u: Type) => {
      const r = this.recOf(u);
      return (r?.kind === "interior" && r.which !== "Cell") || (r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r?.kind === "handle";
    };
    const held = bodyOf(this.arenas, body).async ? c.fields.find((f) => this.typing.holdsPart(f.type, pinned)) : undefined;
    if (held) throw new CompileError("E0303", `this async function captures ${capture(held.name)}, which holds an Atomic, a Lock, a Semaphore or a JoinHandle; each call works on its own copy of what it captures, which would split that state, so capture a shared value holding it instead, like 'shared({ count: new Atomic(0) })'`, e.start, e.end);
  }

  // What a Dyn of this type runs for each interface member. A method may not need more of its
  // object than the interface declares, since a call through a Dyn only knows the interface,
  // and one taking an interface or function has a version per argument type, so no one slot.
  /** @throws {CompileError} */
  private dynTable(this: Mut<this>, e: Expr, type: Type, to: DynType): DynTable {
    const r = this.recOf(type);
    const c = r?.kind === "class" ? this.ctx.classOf(type as ClassType) : undefined;
    const fixed = this.typing.holdsPart(type, (u) => {
      const p = this.recOf(u);
      return (p?.kind === "interior" && p.which !== "Cell") || (p?.kind === "block" && (p.which === "Semaphore" || p.which === "Permit")) || p?.kind === "handle" || p?.kind === "dyn";
    });
    // A boxed async generator's one slot is its `next()`, whose future borrows the generator in
    // the Dyn's block and is boxed in turn. A generator runs once, so it is never copied.
    if (r?.kind === "generator") {
      this.dynMembers.set(`${this.typing.keyOf(this.typing.leafFuture("next", type as GeneratorType))} ${this.typing.keyOf(this.typing.lentPromise(this.typing.nextResult(r.yields)))}`, { methods: [], fields: [], clone: undefined });
      return { methods: [undefined], fields: [], clone: undefined };
    }
    if (r?.kind === "closure") {
      const body = this.ctx.closureBody(type as ClosureType);
      this.futureTable(body, this.typing.rec(this.typing.rec(to).of).methods[0]!.returns, false, e);
      return { methods: [body.id], fields: [], clone: fixed ? undefined : "copy" };
    }
    const methods = this.typing.rec(this.typing.rec(to).of).methods.map((m) => {
      const body = c && inherited(this.arenas, c, "methods", m.name);
      // An optional method the type leaves out has an empty slot.
      if (!body) return undefined;
      // A generic method has no one function for the table; calls of it through a Dyn are refused.
      if (m.generic) return undefined;
      if (body.params.some((p) => p.comptime)) throw new CompileError("E1102", `'${this.typing.show(type)}' can't be a '${this.typing.show(to)}': its method '${m.name}' takes a comptime parameter, so it has a version per value and no one method a Dyn could call`, e.start, e.end);
      const refuse = (does: string, declare: string) => new CompileError("E0702", `'${this.typing.show(type)}' can't be a '${this.typing.show(to)}': its method '${m.name}' ${does}, which '${this.typing.rec(this.typing.rec(to).of).name}' doesn't declare; declare '${declare}' on it in the interface`, e.start, e.end);
      if (body.self?.owned && !m.owned) throw refuse("takes its object over", "this: Own<this>");
      if (body.self?.mutable && !body.self.owned && !m.mutable && !m.owned) throw refuse("changes its object", "this: Mut<this>");
      // An object-typed parameter takes exactly its own type through a Dyn; an interface or a
      // function has a version per argument type, and no one to call.
      const implicit = this.ctx.implicitOf(body);
      if ([...implicit.values()].some((b) => this.typing.rec(b).kind !== "object")) throw new CompileError("E0211", `'${this.typing.show(type)}' can't be a '${this.typing.show(to)}': its method '${m.name}' takes an interface or a function, so it has a version per argument type and no one to call through a Dyn`, e.start, e.end);
      const instance = this.ctx.instanceOf(body, new Map([...(body.scope ?? []), ...[...implicit].map(([i, b]): [string, Type] => [`#${i}`, b])]));
      this.futureTable(instance, m.returns, true, e);
      return instance.id;
    });
    const fields = this.typing.rec(this.typing.rec(to).of).fields.map((f) => (typeof type !== "string" && this.typing.field(type, f.name) ? undefined : c && this.ctx.instanceOf(inherited(this.arenas, c, "getters", f.name)!).id));
    const own = this.arenas.bodyOf(c?.methods.get("clone"));
    return { methods, fields, clone: own ? this.ctx.instanceOf(own).id : fixed ? undefined : "copy" };
  }

  // A slot giving a `Promise<T>` boxes the future its method or closure makes: borrowing the
  // Dyn's value for a method, owning its captures for a closure. Its vtable is made here.
  /** @throws {CompileError} */
  private futureTable(this: Mut<this>, target: Instance, returns: Type, lent: boolean, at: Expr) {
    const gives = this.typing.promiseElement(returns);
    if (gives === undefined) return;
    const made = this.typing.lower(target.future ?? this.ctx.returnOf(target, at));
    const fr = this.recOf(made);
    if (fr?.kind !== "future") throw unsupported("Dyn methods giving a Promise that isn't an async function's future", at);
    if (fr.throws) throw new CompileError("E0602", `'${bodyOf(this.arenas, target).name}' can throw '${this.typing.show(fr.throws)}', and a Promise given through a Dyn or a stored function can't throw yet`, at.start, at.end);
    const boxed = lent ? this.typing.lentPromise(gives) : this.typing.stored(returns);
    this.dynMembers.set(`${this.typing.keyOf(made)} ${this.typing.keyOf(boxed)}`, { methods: [], fields: [], clone: undefined });
  }

  // A method call through a Dyn: the interface's method, run through its slot.
  /** @throws {CompileError} */
  private dynCall(this: Mut<this>, e: Call, callee: Extract<Expr, { kind: "member" }>, t: DynType): { type: Type; what: string } {
    if (this.typing.callableOf.has(this.typing.rec(t).of)) throw new CompileError("E0503", `a stored function is called directly, as '${this.placeText(callee.object)}(...)'`, callee.start, callee.end);
    const index = this.typing.rec(this.typing.rec(t).of).methods.findIndex((m) => m.name === callee.name);
    const m = this.typing.rec(this.typing.rec(t).of).methods[index];
    if (!m) {
      const hint = this.typing.rec(this.typing.rec(t).of).fields.some((f) => f.name === callee.name) ? "; it is a field, read without calling" : didYouMean(callee.name, this.memberNames(t));
      throw new CompileError("E0502", `property '${shownName(callee.name)}' does not exist on type '${this.typing.show(t)}'${hint}`, callee.start, callee.end);
    }
    if (this.linked(callee)) throw unsupported("optional chains calling methods through a Dyn", callee);
    this.omittableCall(e, callee, m, this.typing.rec(this.typing.rec(t).of).name);
    if (m.generic) throw new CompileError("E0211", `'${m.name}' is generic, a family of methods made one per call, and a Dyn's table holds one function per method, so it can't be called through a Dyn; take a type parameter bounded by '${this.typing.rec(this.typing.rec(t).of).name}' instead`, callee.start, callee.end);
    const async = this.typing.promiseElement(m.returns);
    if (async !== undefined && m.owned) throw unsupported("async methods taking their object over through a Dyn", callee);
    const mr = this.recOf(m.returns);
    if (mr?.kind === "interface" && async === undefined) {
      throw new CompileError("E0115", `'${m.name}' returns the interface type '${mr.name}', which each type implementing '${this.typing.rec(this.typing.rec(t).of).name}' gives its own way, so a Dyn can't call it; have it return 'Dyn<${mr.name}>'`, callee.start, callee.end);
    }
    if (e.typeArgs.length > 0) throw new CompileError("E0106", `'${m.name}' takes no type arguments`, e.start, e.end);
    if (e.args.length !== m.params.length) throw new CompileError("E0501", `expected ${m.params.length} argument${m.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    // A reference it gives borrows the Dyn, unless the call frees the Dyn's block.
    if (this.typing.holdsRef(m.returns)) {
      if (m.owned) throw new CompileError("E0209", `'${m.name}' takes its object over and frees it, so the reference it gives would point at nothing`, callee.start, callee.end);
      this.borrowsFrom.set(e, [callee.object]);
    }
    // A boxed async generator's `next()` runs it on, changing it.
    const mutable = m.mutable === true || this.typing.generatorElement(this.typing.rec(t).of, true) !== undefined;
    if (m.owned) this.takesOver(callee.object, m.name);
    else if (mutable) this.mutates(callee.object, m.name);
    e.args.forEach((a, i) => {
      const want = m.params[i]!;
      this.expect(a, want);
      const given = this.value(a);
      this.coerce(a, given, want, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(want)}'`);
    });
    this.dynCalls.set(e, { index, mutable, owned: m.owned === true });
    // An async method's future, boxed, borrows the Dyn until it is done.
    if (async !== undefined) {
      this.borrowsFrom.set(e, [callee.object, ...e.args.filter((a) => this.lends(a))]);
      return { type: this.typing.lentPromise(async), what: `'${m.name}'` };
    }
    if (m.throws) this.ctx.raise(e, m.throws, `'${m.name}'`);
    return { type: m.returns, what: `'${m.name}'` };
  }

  // A call of a stored callable: whatever expression gives it, run through its one slot.
  /** @throws {CompileError} */
  private callableCall(this: Mut<this>, e: Call, callee: Expr, t: DynType): { type: Type; what: string } {
    const fn = this.typing.callableOf.get(this.typing.rec(t).of)!;
    // A field holding it is read as any field is.
    if (!this.types.has(callee)) this.value(callee);
    if (e.typeArgs.length > 0) throw new CompileError("E0106", "a stored function takes no type arguments", e.start, e.end);
    if (e.args.length !== this.typing.rec(fn).params.length) throw new CompileError("E0501", `expected ${this.typing.rec(fn).params.length} argument${this.typing.rec(fn).params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const want = this.typing.rec(fn).params[i]!;
      this.expect(a, want);
      const given = this.value(a);
      this.coerce(a, given, want, `argument of type '${this.typing.show(given)}' is not assignable to parameter of type '${this.typing.show(want)}'`);
    });
    if (this.typing.holdsRef(this.typing.rec(fn).returns)) this.borrowsFrom.set(e, [callee]);
    this.dynCalls.set(e, { index: 0, mutable: false, owned: false, callable: callee });
    const thrown = this.typing.rec(fn).throws;
    if (thrown) this.ctx.raise(e, thrown, callee.kind === "ident" || callee.kind === "member" ? `'${callee.name}'` : "this function");
    // One returning a Promise gives its future boxed, owning what it holds.
    return { type: this.typing.stored(this.typing.rec(fn).returns), what: "this function" };
  }

  // A field read through a Dyn, through its slot: a copy of the value.
  /** @throws {CompileError} */
  private dynField(this: Mut<this>, e: Extract<Expr, { kind: "member" }>, t: DynType): Type {
    if (this.linked(e)) throw unsupported("optional chains through a Dyn", e);
    const f = this.typing.rec(this.typing.rec(t).of).fields.find((x) => x.name === e.name);
    if (!f) {
      const hint = this.typing.rec(this.typing.rec(t).of).methods.some((m) => m.name === e.name) ? "; it is a method, so call it" : didYouMean(e.name, this.memberNames(t));
      throw new CompileError("E0502", `property '${shownName(e.name)}' does not exist on type '${this.typing.show(t)}'${hint}`, e.start, e.end);
    }
    // A copy of an Atomic, a Lock or a Dyn would change apart from the original.
    if (this.typing.interiorMutable(f.type) || this.typing.holdsHandle(f.type)) throw new CompileError("E0211", `'${e.name}' can't be read through a Dyn, which gives a copy of it, and a copy of a '${this.typing.show(f.type)}' would change apart from the one the Dyn holds; read it through a method`, e.start, e.end);
    this.computed.add(e);
    return f.type;
  }

  // Whether a place is inside the value a callback is passed: its parameter, or a field of it.
  private isParamPath(e: Expr): boolean {
    while (e.kind === "member" || e.kind === "index") e = e.object;
    return e.kind === "ident" && this.localAt(e)?.param === true;
  }

  // Whether `this` may change here. A closure changing it changes it where it was made.
  /** @throws {CompileError} */
  changesThis(this: Mut<this>, path: string, action: string, target: Expr) {
    this.ctx.changesPath("this", path, action, target);
    if (this.closing) return this.ctx.changesCapture(undefined, path, action, target, false);
    if (this.self?.mutable) return;
    throw new CompileError("E0206", `cannot ${action} 'this${shownPath(path)}' because 'this' is read-only here; declare 'this: Mut<this>'`, target.start, target.end);
  }

  // Whether a variable may change here, at `path` inside it, possibly through a mutable
  // reference. A closure changing what it captures changes the variable where it was made.
  /** @throws {CompileError} */
  changesLocal(this: Mut<this>, local: Local, path: string, action: string, target: Expr, throughMut: boolean) {
    this.ctx.changesPath(local, path, action, target);
    if (this.ctx.captured(local)) return this.ctx.changesCapture(local, path, action, target, throughMut);
    if (throughMut) return;
    // A shared reference never changes what it points to; a mutable one may, whatever holds
    // it, and a method may change through it.
    const lr = this.recOf(local.type);
    if ((path || action !== "assign to") && lr?.kind === "ref") {
      if (lr.mutable) return;
      throw new CompileError("E0206", `cannot ${action} '${local.name}${shownPath(path)}' because '${local.name}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
    }
    if (local.param && local.mutable) this.ctx.changedParams.add(local.localId);
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
  private tupleLength(this: Mut<this>, e: Expr): Type | undefined {
    if (e.kind !== "member" || e.name !== "length" || e.optional) return undefined;
    const t = this.types.get(e.object);
    const held = t !== undefined && this.isRefType(t) ? this.typing.rec(t).to : t;
    return held !== undefined && this.typing.isTuple(held) ? this.typing.tupleLength(held as ObjectType) : undefined;
  }

  // A readonly field can't change once constructed, nor can anything inside it. Only its own
  // class's constructor may assign it, through `this`.
  /** @throws {CompileError} */
  private readonly(e: Extract<Expr, { kind: "member" }>, target: Expr, action: string) {
    const found = this.types.get(e.object);
    const object = typeof found !== "string" && this.recOf(found)?.kind === "ref" ? this.typing.rec(found as RefType).to : found;
    if (object && stringLike(this.typing, object)) throw new CompileError("E0802", `a string's '${e.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    // Through a mutable reference, the value written is someone else's: in an instance, its
    // field is as read-only as the field of the type it really is. A copy is the body's own.
    const locked = this.typing.field(object as Exclude<Type, string>, e.name)?.readonly || (this.throughMutable(e.object) && this.concreteField(e)?.readonly);
    if (typeof object === "string" || !object || !locked) return;
    if (e === target && e.object.kind === "this" && this.self?.constructor && this.typing.rec(this.self.type).fields.some((f) => f.name === e.name)) return;
    if (this.typing.isTuple(object)) throw new CompileError("E0208", `cannot ${action} '${this.placeText(target)}' because '${this.placeText(e.object)}' is a '${this.typing.show(object)}', whose elements are read-only`, target.start, target.end);
    const what = e === target ? `'${e.name}' because it is` : `'${this.placeText(target)}' because '${e.name}' is`;
    throw new CompileError("E0208", `cannot ${action} ${what} a read-only property`, target.start, target.end);
  }

  // Whether a place is reached through a mutable reference anywhere along its path; `this`
  // is one, to the object the method was called on.
  private throughMutable(e: Expr): boolean {
    for (let x = e; ; x = x.object) {
      const t = this.types.get(x);
      if (typeof t !== "string" && this.recOf(t)?.kind === "ref" && this.typing.rec(t as RefType).mutable) return true;
      if (x.kind !== "member") return x.kind === "this" || x.kind === "super";
    }
  }

  // A field as the concrete types along its path declare it, type parameters taken as what
  // they stand for in this instance.
  private concreteField(e: Extract<Expr, { kind: "member" }>): Field | undefined {
    const holder = this.concreteType(e.object);
    return holder && typeof holder !== "string" ? this.typing.field(holder, e.name) : undefined;
  }

  private concreteType(e: Expr): Type | undefined {
    const deref = (t: Type | undefined) => {
      const low = t && this.typing.lower(t);
      return typeof low !== "string" && this.recOf(low)?.kind === "ref" ? this.typing.lower(this.typing.rec(low as RefType).to) : low;
    };
    if (e.kind !== "member") return deref(this.types.get(e));
    const holder = this.concreteType(e.object);
    return holder && typeof holder !== "string" ? deref(this.typing.field(holder, e.name)?.type) : undefined;
  }

  // How a place reads in a message, like `p.inner.x`.
  private placeText(e: Expr): string {
    const base = restBase(this.restStarts, e);
    if (base !== undefined) return `${this.placeText(base)}${restSuffix(this.restStarts, e)}`;
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
  private converted(this: Mut<this>, e: Extract<Expr, { kind: "as" | "satisfies" }>, written: Type): Type {
    // A function type or a `Promise<T>` makes the value a stored one, as a declared variable's does.
    const to = this.typing.stored(written);
    if (to !== written) this.expect(e.expr, to);
    const from = this.operand(e.expr);
    // A raw pointer converts to another, or to and from an address, only inside `unsafe`.
    const pointer = (t: Type) => typeof t !== "string" && this.typing.rec(t).kind === "pointer";
    if (pointer(to) || pointer(from)) {
      this.needsUnsafe("'as' with a raw pointer", e);
      if (!((pointer(to) && (pointer(from) || isInteger(from))) || (to === "usize" && pointer(from)))) {
        throw new CompileError("E1006", `a raw pointer converts only to another raw pointer or a 'usize', not '${this.typing.show(pointer(to) ? from : to)}'`, e.start, e.end);
      }
      return to;
    }
    // A reference widened or narrowed to what it points to would be a copy nobody wrote.
    const read = this.types.get(e.expr) ?? from;
    if ((this.isRefType(from) || this.isRefType(read)) && !this.typing.isCopy(this.typing.lower(from)) && !this.isRefType(to) && !this.typing.optionRef(to)) throw new CompileError("E0202", `'as' can't take the value out of '${this.typing.show(read)}', which only borrows it; use '.clone()' for a copy`, e.start, e.end);
    const narrowsFromUnion = () => {
      const fr = this.recOf(from);
      if (fr?.kind !== "union") return false;
      const tr = this.recOf(to);
      const targets = tr?.kind === "union" ? tr.members : [to];
      return targets.length > 0 && targets.every((t) => fr.members.some((m) => m === t || this.typing.unfold(m) === t || this.typing.sameLowered(m, t) || this.typing.sameLowered(this.typing.unfold(m), t)));
    };
    // A brand is made and taken apart with 'as', between its base and what converts to it.
    const [fb, tb] = [this.typing.unbranded(from), this.typing.unbranded(to)];
    if (fb !== from || tb !== to) {
      if (tb !== to && this.adapt(e.expr, tb)) return to;
      if (isNumeric(fb) && isNumeric(tb)) return to;
      if (fb === tb || this.typing.fits(fb, tb)) {
        if (from !== tb) this.coerce(e.expr, from, tb, "");
        return to;
      }
      if (narrowsFromUnion()) return to;
      throw new CompileError("E0111", `'${this.typing.show(from)}' can't be converted to '${this.typing.show(to)}' with 'as'`, e.start, e.end);
    }
    // A bigint becomes a number with 'as', truncated to an integer type's bits as
    // 'BigInt.asIntN' does; a number becomes a bigint only through 'BigInt(x)'.
    if (to === "bigint" && from !== "bigint") throw new CompileError("E0111", `'${this.typing.show(from)}' converts to a bigint with 'BigInt(x)', not 'as'`, e.start, e.end);
    if (from === "bigint" && (isNumeric(to) || to === "bigint")) return to;
    // Between other types, 'as' widens, or narrows a union by checking its tag at run time.
    if (!isNumeric(to) || !isNumeric(from)) {
      if (!(from === "boolean" && isInteger(to)) && (this.typing.fits(from, to) || this.typing.fits(from, written))) {
        this.coerce(e.expr, from, to, "");
        return to;
      }
      if (narrowsFromUnion()) return to;
      if (this.typing.fits(to, from)) throw new CompileError("E0111", `'as' can't narrow '${this.typing.show(from)}' to '${this.typing.show(to)}', since nothing would check it while the program runs; narrow it with a check, like 'typeof', 'instanceof' or '!== null'`, e.start, e.end);
      if (!(from === "boolean" && isInteger(to))) throw new CompileError("E0111", `'${this.typing.show(from)}' can't be converted to '${this.typing.show(to)}' with 'as', since neither fits the other`, e.start, e.end);
    }
    return to;
  }

  // An operator works on a literal's base type, so `1` adds like any i64. A type parameter
  // bounded by a union or primitive is used as its bound at its definition, and in an instance as
  // its argument.
  /** @throws {CompileError} */
  private operand(this: Mut<this>, e: Expr): Type {
    return this.widen(e, this.plainOf(this.read(e)));
  }

  private plainOf(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "param" && r.concrete && this.valueParam(r) ? (r.within ? r.concrete : this.typing.lowerKeepingBrands(t)) : t;
  }

  /** @throws {CompileError} */
  declares(this: Mut<this>, c: ClassType, name: string): boolean {
    const info = this.ctx.classOf(c);
    return (["methods", "getters", "setters"] as const).some((table) => inherited(this.arenas, info, table, name) !== undefined);
  }

  // The class a name declares, unless a variable shadows it.
  classNamed(this: Mut<this>, name: string): ClassType | undefined {
    return this.ctx.lookup(name) ? undefined : this.arenas.classOf(this.classes.get(name))?.type;
  }

  // A value that is only read, seen through a reference to it.
  /** @throws {CompileError} */
  read(this: Mut<this>, e: Expr): Type {
    return this.loaded(e, this.value(e));
  }

  // A checked value of `type`, loaded from where it points when it is a reference.
  private loaded(this: Mut<this>, e: Expr, type: Type): Type {
    const r = this.recOf(type);
    if (r?.kind !== "ref") return type;
    this.coercions.set(e, r.to);
    return r.to;
  }

  // An operand of an enum, a union of integer literals, works as an i64 too.
  private widen(this: Mut<this>, e: Expr, type: Type): Type {
    // A pattern's value is a string, as is a union of patterns and string literals.
    if (this.typing.holdsPattern(type) && this.typing.lower(type) === "string") {
      this.coercions.set(e, "string");
      return "string";
    }
    const u = this.recOf(type);
    const literals = u?.kind === "union" ? u.members : [type];
    const bases = new Set(literals.map((t) => {
      const l = this.recOf(t);
      return l?.kind === "literal" ? this.typing.baseOf(t as LiteralType) : undefined;
    }));
    const base = bases.size === 1 ? [...bases][0] : undefined;
    // A string literal keeps its type, so comparing two different ones is caught.
    if (!base || base === "string") return type;
    this.coercions.set(e, base);
    return base;
  }

  // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
  /** @throws {CompileError} */
  condition(this: Mut<this>, e: Expr) {
    const type = this.operand(e);
    if (this.typing.isOption(type)) throw new CompileError("E0102", `condition must be a boolean, not the Option '${this.typing.show(type)}'; check it with '!== null'`, e.start, e.end);
    if (this.typing.unbranded(type) !== "boolean") {
      throw new CompileError("E0102", `condition must be a boolean, not '${this.typing.show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
    }
  }
}

// A string, or a string literal that isn't an enum's member.
const isText = (typing: Typing, t: Type) => {
  if (typeof t === "string") return t === "string";
  const r = typing.rec(t);
  return r.kind === "pattern" || (r.kind === "literal" && typeof r.value === "string" && !r.owner) || (r.kind === "brand" && r.base === "string");
};

// A string enum's member, or a union of them, which joins into a string as its value.
const enumText = (typing: Typing, t: Type): boolean => {
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  return r.kind === "union" ? r.members.every((m) => enumText(typing, m)) : r.kind === "literal" && typeof r.value === "string" && r.owner !== undefined;
};

// What a string's length, index and methods work on: text, or a union of string literals.
export const stringLike = (typing: Typing, t: Type) => {
  if (isText(typing, t)) return true;
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r?.kind === "union" && r.members.every((m) => isText(typing, m));
};

// The blocking file calls std's node:fs is written over: their parameters, what each gives, and
// whether it throws an IoError.
const syncFileSignatures = (typing: Typing): Record<string, [Type[], Type, boolean]> => ({
  fileReadSync: [["string"], typing.arrayType("u8"), true],
  fileWriteSync: [["string", typing.arrayType("u8")], "void", true],
  pathExists: [["string"], "boolean", false],
  // Size, mode, modification time in milliseconds, and kind: 1 a file, 2 a directory, 3 a link.
  pathStat: [["string", "boolean"], typing.tupleType(["i64", "i64", "f64", "i64"]), true],
  dirRead: [["string"], typing.arrayType("string"), true],
  pathReal: [["string"], "string", true],
  // realpath(3) itself, as fs/promises realpath calls it.
  pathRealNative: [["string"], "string", true],
  pathReadLink: [["string"], "string", true],
  dirTemp: [["string"], "string", true],
  pathRemove: [["string", "boolean", "boolean"], "void", true],
  // A path, recursive and mode, giving the first directory made, or null.
  dirMake: [["string", "boolean", "i64"], typing.unionType(["string", "null"]), true],
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
  processSpawn: [["string", typing.arrayType("string"), "string", typing.arrayType("u8"), "i64", typing.arrayType("string")], typing.tupleType(["i64", "i64", "i64", typing.arrayType("u8"), typing.arrayType("u8")]), true],
});

// Each string method: its parameters, what it returns, and how many arguments it needs.
const stringMethods = (typing: Typing): Record<string, [Type[], Type, usize]> => ({
  charCodeAt: [["usize"], "u16", 1],
  at: [["i64"], typing.unionType(["string", "null"]), 1],
  charAt: [["i64"], "string", 1],
  codePointAt: [["usize"], typing.unionType(["u32", "null"]), 1],
  lastIndexOf: [["string", "i64"], "i64", 1],
  indexOf: [["string", "i64"], "i64", 1],
  includes: [["string", "i64"], "boolean", 1],
  startsWith: [["string", "i64"], "boolean", 1],
  endsWith: [["string", "i64"], "boolean", 1],
  split: [["string", "usize"], typing.arrayType("string"), 0],
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
});


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
  return isFloat(from) && isInteger(to) ? `; from a float, 'as' saturates at the bounds of '${to}', where JavaScript wraps modulo 2^${INTEGERS[to].bits}${to === "u8" ? ", so 300.5 becomes 255 rather than 44" : ""}` : "";
}

// The array methods that change their array, which a subarray's copy can't take.
const SUBARRAY_WRITES = new Set(["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "set", "reserve", "shrinkToFit"]);
const TYPED_MEMBERS = new Set(["byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"]);
const ARRAY_METHODS = new Set(["push", "pop", "sort", "at", ...Object.keys(ITERATORS), ...Object.keys(BYTE_METHODS), ...CALLBACK_METHODS, ...READING_METHODS, ...COPYING_METHODS, ...CHANGING_METHODS]);

// Whether `name` is a member of the Map or Set a class embeds.
const collectionMember = (c: ClassInfo, name: string) => name === "size" || (c.embedded === "Set" ? SET_METHODS : MAP_METHODS).has(name);

// A path as a message shows it, the collection a class extending Map or Set embeds left unsaid.
const shownPath = (path: string) => path.replaceAll(`.${EMBEDDED}`, "");

// How an index reads in a message: a name or a number as written, anything else as `...`.
export function indexText(e: Ref<Expr>): string {
  return e.kind === "ident" ? e.name : e.kind === "int" ? String(e.value) : "...";
}
