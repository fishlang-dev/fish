import type { Tables } from "./compilation.ts";
import { fileAt, textAt } from "./modules.ts";
import { rustClassOf, type RustClass } from "./rust.ts";
import { abstractIn, copyFor, inherited, shownName, isLifetime, type Body, type ClassInfo, type FieldDecl } from "./classes.ts";
import { openParam } from "./typefns.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { Direct, Narrowing } from "./overloads.ts";
import { CompileError, indexText } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, Interface, ObjectProp, Param, Pattern, Span, Stmt, TypeMember, TypeNode } from "./parser.ts";
import { bindings, literalOf, made, missing, objectFields, uncovered, type PatternInfo, type PatternTest, type Shape } from "./match.ts";
import { channel, collection, fields, interior, shareable, tagStrings } from "./resolve.ts";
import { infer } from "./generics.ts";
import { allFields, unequal, uninspectable, unfold, elementsOf, isTuple, baseOf, SLEEP, YIELD_NOW, INTEGERS, isFloat, isInteger, isNumeric, isOption, range, derives, field, holdsHandle, holdsPart, type DynType, type HandleType, type BlockType, holdsInterior, interiorMutable, type SharedType, holdsMut, INTERIORS, type InteriorType, optionRef, isCopy, widenEnum, widenLet, isPlainJs, jsShape, type InterfaceType, type Method, type Typing } from "./typing.ts";
import type { Access, ArrayType, FixedType, MapType, GeneratorType, LiteralType, PointerType, VariantType, Bound, Integer, Numeric, UnionType, ClassType, ClosureType, Field, FunctionType, ObjectType, RefType, RegexType, Type } from "./typing.ts";
import type { EnumInfo, EnumInstance } from "./enums.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import { compile as compileRegex, parsePattern, RegexSyntaxError } from "./regex.ts";
import { JSON_VALUE_NAME, STD_BASE } from "./std.ts";
import { parseArgsArgs } from "./parseargs.ts";
import { holesOf, quoted, type Category } from "./quote.ts";
import { holdsNull } from "./defaults.ts";
import type { Instance, Local } from "./check.ts";
import { isEmpty, literalValue, type Facts, type Guard } from "./narrow.ts";
import { bothSides, comparable, objectsMeet, instanceofCheck, intoMember, intoUnion, literalShape, typeofComparison, unionComparison, unionField, type Union } from "./unions.ts";
import { nextId, NodeMap, NodeSet, WeakNodeMap, WeakNodeSet, renumber } from "./nodes.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

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

const isRefType = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

// Whether a value of the type can hold a float anywhere inside it.
function holdsFloat(t: Type, seen: Set<Type> = new Set<Type>()): boolean {
  if (typeof t === "string") return isFloat(t);
  if (seen.has(t)) return false;
  seen.add(t);
  const x = t as unknown as Record<string, unknown>;
  const parts = ["to", "of", "concrete", "element", "key", "value", "base"].flatMap((k) => ((typeof x[k] === "object" && x[k] !== null) || typeof x[k] === "string" ? [x[k] as Type] : []));
  if (Array.isArray(x.members)) parts.push(...(x.members as Type[]));
  if (Array.isArray(x.fields)) parts.push(...(x.fields as Field[]).map((f) => f.type));
  return parts.some((p) => holdsFloat(p, seen));
}

const printable = (t: Type): boolean =>
  typeof t === "string" || t.kind === "literal" || t.kind === "pattern" || (t.kind === "union" && t.members.every(printable));

// What expression checking needs from the program and the function it is in.
export type Context = {
  tables: Tables;
  types: NodeMap<Expr, Type>;
  locals: NodeMap<Expr | Stmt | Param | ObjectProp, Local>;
  coercions: NodeMap<Expr, Type>;
  calls: NodeMap<Expr, Instance>;
  setters: NodeMap<Expr, Instance>;
  byName: Map<string, Body>;
  classes: Map<string, ClassInfo>;
  enums: Map<string, EnumInfo>;
  // A data-carrying enum made with these type arguments.
  enumInstance(info: EnumInfo, args: Type[], at: Span): EnumInstance;
  construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined;
  // A generic class's constructor parameters as written.
  templateParams(name: string): Param[] | undefined;
  // A generic class as its definition is checked, whose statics every instance shares.
  definedClass(name: string): ClassInfo | undefined;
  members: Members;
  returnOf(instance: Instance, at: Span): Type;
  // What a call returns as the calling body sees it: in terms of the calling instance's own
  // type parameters, where it passed them.
  resultOf(instance: Instance, at: Span): Type;
  // What a call's returned reference borrows from, and the record of it for each call.
  sourcesOf(instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[];
  borrowsFrom: NodeMap<Expr, Expr[]>;
  classOf(t: ClassType): ClassInfo;
  instanceOf(f: Body, bindings?: Map<string, Type>): Instance;
  instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance;
  paramTypes(instance: Instance): Type[];
  // The binding a name refers to; `at`, the use, is where a closure first captures it.
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  // The binding a name refers to, without capturing it, and this body's binding for a variable
  // of a body around it, captured if need be.
  peek(name: string): Local | undefined;
  reach(l: Local, at?: Expr | ObjectProp): Local;
  // The names a use at `at` reaches, its bindings in scope then top-level values, for suggesting one.
  names(at: number): string[];
  // The names of the classes, generic ones included, a use at `at` reaches.
  classNames(at: number): string[];
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
  selfCall(e: Call): { type: Type; what: string } | undefined;
  // Whether this `this` may be used: a constructor's can't until every field is assigned.
  thisReady(e: Expr): boolean;
  // Narrowing: what a condition proves, checking under what was proven, and a variable's
  // type where something narrowed it.
  proves(e: Expr): Guard;
  assume<T>(proven: Facts, check: () => T): T;
  // Runs a match arm in a scope of its own, holding the names its pattern binds.
  arm<T>(check: () => T): T;
  // Checks a match arm's block, whose `return`s give the arm its value: each value and its type.
  block(arm: Extract<Stmt, { kind: "block" }>, wanted: boolean): [Expr, Type][];
  // What each match pattern tests, for codegen.
  patterns: NodeMap<Pattern, PatternInfo>;
  copiesOut: NodeSet<Expr>;
  // Declares a name a pattern binds, read-only, in the arm's scope.
  bind(name: string, type: Type, node: Expr): Local;
  narrowed(l: Local): Type | undefined;
  // False for a binding declared in another case of a switch, which entering this case skips.
  reachable(l: Local): boolean;
  // Records an error a call raises, and what the instance called may throw.
  raise(at: Expr, type: Type, what: string): void;
  // Checks comptime code, which may throw any error: one it doesn't catch is a compile error.
  comptime<T>(check: () => T): T;
  // Checks what a `throw` raises.
  thrown(at: Expr, value: Expr): void;
  errorOf(instance: Instance): Type | undefined;
  // What the body's function declares it throws.
  throwsDeclared(): Type | undefined;
  // Whether the body is a sync `main` run as an async one, as a program setting timers does.
  syncMain: boolean;
  // Whether a binding stands for a variable a closure captures, and whether this is a closure;
  // and a change to a capture, `this` when undefined, which makes it mutable.
  captured(l: Local): boolean;
  closing: boolean;
  // Whether the body is a generator's.
  generator: boolean;
  // Whether the program runs on the async runtime: its `main` is async.
  runtime: boolean;
  // Whether the body is a callback a lock is held for, and whether that lock is a shared value's.
  locked: boolean;
  sharing: boolean;
  // Whether the body is an async function's, and the awaits written where it can stop at them.
  async: boolean;
  awaitable: NodeSet<Expr>;
  // Whether the body is a closure written inside `unsafe`.
  unsafe: boolean;
  changesCapture(l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean): void;
  // Records a whole write through a narrowed mutable reference that may change its member.
  rewritten(l: Local, at: Expr): void;
  // How deeply nested the scope declaring a binding is.
  depthOf(l: Local): number;
  // A written type, as this body sees it.
  resolveType(t: TypeNode): Type;
  // An arrow function's type, its body checked; and the instance a closure type runs.
  // A closure written inside `unsafe` is checked inside it too.
  closure(e: Extract<Expr, { kind: "arrow" }>, expected?: FunctionType, unsafe?: boolean, owning?: boolean): ClosureType;
  // Makes a generic arrow written as a value a generic function of its own, the arrow its name.
  liftArrow(e: Extract<Expr, { kind: "arrow" }>): void;
  // A type node resolved with type parameters bound, as a generic function type's for a call.
  resolveWith(t: TypeNode, scope: Map<string, Type>): Type;
  closureBody(t: ClosureType): Instance;
  // The bounds of a body's implicit type parameters, by parameter index.
  implicitOf(f: Body): Map<number, Bound>;
  // The type an arrow argument of a generic body is checked against, once the others are known.
  callbackType(f: Body, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: number, at: Span): FunctionType | undefined;
  // Rejects a constructor call lending a value mutably as a type parameter that would let its
  // read-only fields be written.
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
export function formatPlan(format: string, count: number): { specs: string[]; rest: number } {
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
export function regexStringType({ unionType, arrayType, matchType }: Typing, name: string, rx: RegexType, unknown: boolean): Type {
  if (name === "search") return "i64";
  if (name === "match") return rx.flags.includes("g") ? unionType([arrayType("string"), "null"]) : unionType([matchType(rx), "null"]);
  if (name === "matchAll") return arrayType(matchType(rx));
  if (name === "split") return arrayType(rx.captures.some((c) => c.optional) || unknown ? unionType(["string", "null"]) : "string");
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
export const MATH_FLOAT: Record<string, number> = {
  floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, cbrt: 1, exp: 1, expm1: 1, log: 1, log1p: 1, log2: 1, log10: 1,
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1, asinh: 1, acosh: 1, atanh: 1,
  pow: 2, atan2: 2, hypot: 2,
};
export const MATH_CONSTANTS: Record<string, number> = {
  PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
};


// How a rest tuple's element or its array reads in a message, as written: `t[2]` and `t[1...]`.
export function restText(restStarts: Tables["restStarts"], e: Expr, text: (e: Expr) => string): string | undefined {
  if (e.kind === "index" && e.index.kind === "int" && restStarts.has(e.object)) return `${text((e.object as Extract<Expr, { kind: "member" }>).object)}[${BigInt(restStarts.get(e.object)!) + e.index.value}]`;
  if (e.kind === "member" && restStarts.has(e)) return `${text(e.object)}[${restStarts.get(e)}...]`;
  return undefined;
}

// What a type's Dyn runs: each method's instance, each field's getter (none for a field), and
// what '.clone()' runs: the class's own `clone`, the compiler's copy, or nothing when the type
// can't be cloned.
export type DynTable = { methods: (Instance | undefined)[]; fields: (Instance | undefined)[]; clone: Instance | "copy" | undefined };

export function expressions(ctx: Context) {
  const {
    asserts, awaitedNow, clocks, combinedCalls, computed, declaredTypes, deepEqualities, defaulted, joinCalls, integerCalls,
    dynCalls, dynMembers, boxedMembers, madeArrows, equalities, fallbacks, fileCalls, filling, fills, fixedFills,
    fixedPrints, formatCalls, inspectCalls, jsAccessors, jsBodies, jsCalledAt, jsCalls, jsClasses,
    jsCrossings, jsEmptyTests, jsEvaluations, jsExports, jsGiven, jsMembers, jsMethods, jsNews,
    jsOptionalOf, jsStatics, jsUses, jsonCalls, kindTests, lengthChecks, maths, namedParams,
    ofElements, packed, pairs, parsedArgs, parses, presetParams, presetTypes, printCalls, printed,
    promiseVariants, quotes, regexCalls, regexNews, regexStringCalls, stringBuilds, substituted,
    syncFileCalls, tagCalls, timerCalls, timerNames, timerSets, timerWrappers, tupleLiterals,
    unusedDefaults, restStarts, upcasts, typing, ids, regex, files
  } = ctx.tables;
  const {
    show, unfolded, callableOf, leafOf, unionType, holdsRef, refType, borrowing, lower, blockType, jsView, yieldsOf, pointerType, handleType, leafFuture,
    arrayType, timerCallback, jsUncalled, fits, jsTakes, promiseElement, genericFunctionType, stored: storedType, matchType, functionType, tupleType, regexType,
    holdsPattern, unjson, sameLowered, heldArgument, jsUntyped, jsOptional, uncrossable, keptByJs, jsConverts, interiorType, lockCallbacks, sharedCallbacks,
    combinedFuture, nextResult, lentPromise, promiseInterface, generatorElement, membersFor, wrapped, jsRead, literalType, objectType, sameCallable, partOfItself, unlocks, keyOf, joinedType,
  } = typing;
  const isCallable = (t: Type) => typeof t !== "string" && t.kind === "dyn" && callableOf.has(t.of);
  // Whether a value holds a future, which an array element or a sort's order can't be.
  const holdsFuture = (t: Type): boolean => typeof t !== "string" && (t.kind === "future" || promiseElement(t) !== undefined);
  const { types, locals, coercions, calls, setters, byName, classes, enums, construct, members, returnOf, resultOf, sourcesOf, borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup } = ctx;
  const { self, owner, superCall, thisReady, proves, assume, narrowed, reachable, captured, closing, changesCapture, noteThis, raise, errorOf, thrown, rewritten, depthOf, closure, closureBody, implicitOf, resolveType, constructs } = ctx;
  // The function type each arrow is given to, which types the parameters it leaves unwritten.
  const expecting = new NodeMap<Expr, FunctionType>();
  // The type each generic enum's member is expected to have, by the member expression.
  const wanted = new NodeMap<Expr, Type>();
  // The T a `new Promise` or `Promise.resolve` is awaited where a T is wanted for.
  const awaitedAs = new NodeMap<Expr, Type>();
  // The pairs of JS shapes being compared, each taken to fit while it is.
  const comparing = new Map<object, Set<object>>();
  // Arrows checked to own what they capture, being stored.
  const owning = new WeakNodeSet<Expr>();
  // Array literals written where a tuple is expected, which are that tuple, and those passed where
  // a generic function takes a tuple, which are a tuple of their own elements' types.
  const tuples = new NodeMap<Expr, ObjectType>();
  const shaped = new WeakNodeSet<Expr>();
  // Those passed where the tuple has optional or rest elements take its shape, by its type node.
  const shapedBy = new WeakNodeMap<Expr, Extract<TypeNode, { kind: "tuple" }>>();
  const fixedLiterals = new NodeMap<Expr, FixedType>();
  // The place an assignment is checking as its target, while it does.
  let writing: Expr | undefined;
  // The assignment an expression statement is, whose value nothing uses.
  let statementAssign: Expr | undefined;
  // Objects of index expressions already checked, which their next read takes as checked.
  const once = new WeakNodeSet<Expr>();
  // Names used as the object of a field read, an index or a method call.
  const objects = new WeakNodeSet<Expr>();
  const oversized: Extract<Expr, { kind: "int" }>[] = [];
  // How many \`unsafe\` blocks enclose the code being checked.
  let unsafeDepth = ctx.unsafe ? 1 : 0;
  // Literals found to fit the type they were given, `-9223372036854775808` among them.
  const fitted = new NodeSet<Expr>();
  // Powers of literals whose exponent no u32 holds, unless they became floats.
  const powers: [Expr, Expr][] = [];
  const unions: Union = {
    kindTests, typing, types, coercions, value: (e) => read(e), excess: (e, to) => excess(e, to),
    classNamed: (name) => (lookup(name) ? undefined : classes.get(name)?.type),
    adapt: (e, to) => adapt(e, to),
  };
  return { value, read, condition, effect, coerce, result, expect, changesLocal, changesThis, adapt, finish, literalOnly, unsafely };

  // Runs a check inside \`unsafe\`, where raw pointers can be used.
  function unsafely<T>(check: () => T): T {
    unsafeDepth++;
    try {
      return check();
    } finally {
      unsafeDepth--;
    }
  }

  // Refuses an operation outside \`unsafe\`.
  function needsUnsafe(what: string, at: Span, why = "the compiler can't check what a raw pointer points to") {
    if (unsafeDepth === 0) throw new CompileError(`${what} can only happen inside 'unsafe { }': ${why}, so you vouch for it there`, at.start, at.end);
  }

  // Literals too large for an i64 that nothing gave a wider type.
  function finish() {
    const integral = powers.find(([power]) => isInteger(types.get(power)!));
    if (integral) {
      const [, exponent] = integral;
      throw new CompileError("the exponent of '**' on an integer is a 'u32', which can't hold this; write the power as a float, like '2.0 ** -1'", exponent.start, exponent.end);
    }
    const unfit = oversized.find((e) => types.get(e) === "i64" && !fitted.has(e));
    if (unfit) throw new CompileError("integer literal does not fit in i64", unfit.start, unfit.end);
  }

  // An expression of only number literals and operators takes the number type it meets where
  // it is written, as `1` does in `let a: u8 = 1` or `a + 1`.
  // A float literal only becomes a float type.
  function adapt(e: Expr, to: Type): boolean {
    if (!isNumeric(to)) return false;
    if (e.kind === "unsafe" || e.kind === "comptime") {
      if (!adapt(e.expr, to)) return false;
      types.set(e, to);
      return true;
    }
    // A `?:` or match whose every branch is a number literal gives the number type it meets.
    if (e.kind === "conditional" || e.kind === "match") {
      const branches = e.kind === "conditional" ? [e.then, e.else] : e.arms.map((a) => a.body);
      if (!branches.every((b) => b.kind !== "block" && literalOnly(b, isFloat(to)))) return false;
      for (const b of branches) retype(b as Expr, to, false);
      types.set(e, to);
      return true;
    }
    if (!literalOnly(e, isFloat(to))) return ctx.infer(e, to);
    retype(e, to, false);
    return true;
  }

  function literalOnly(e: Expr, floats: boolean): boolean {
    if (e.kind === "unsafe" || e.kind === "comptime") return literalOnly(e.expr, floats);
    if (e.kind === "int" || (e.kind === "float" && floats)) return true;
    if (e.kind === "unary") return (e.op === "-" || (e.op === "~" && !floats)) && literalOnly(e.operand, floats);
    return e.kind === "binary" && LITERAL_OPERATORS.has(e.op) && (!floats || !BITWISE_OPERATORS.has(e.op)) && literalOnly(e.left, floats) && literalOnly(e.right, floats);
  }

  function retype(e: Expr, to: Numeric, negated: boolean) {
    types.set(e, to);
    if (e.kind === "unary") {
      if (e.op === "-" && isInteger(to) && !INTEGERS[to].signed) {
        throw new CompileError(`'${show(to)}' is unsigned, so it can't be negative; use a signed type like 'i64'`, e.start, e.end);
      }
      return retype(e.operand, to, e.op === "-" && !negated);
    }
    if (e.kind === "binary") {
      retype(e.left, to, false);
      // An integer's exponent stays a `u32`.
      return retype(e.right, e.op === "**" && isInteger(to) ? "u32" : to, false);
    }
    if (e.kind !== "int" || !isInteger(to)) return;
    const [min, max] = range(to);
    const value = negated ? -e.value : e.value;
    if (value < min || value > max) {
      throw new CompileError(`'${negated ? "-" : ""}${e.value}' doesn't fit in '${show(to)}', which holds ${min} to ${max}`, e.start, e.end);
    }
    fitted.add(e);
  }

  // What a closure or a generic enum's member is expected to be, from where it goes, since
  // neither can always tell its own type: a closure its parameters', an enum its type arguments.
  function expect(e: Expr, t: Type) {
    // Callers pass what a parameter list has, which may run out.
    if (t !== undefined) t = unfolded(t);
    // A literal lent to a reference is a temporary of the type it refers to.
    if ((e.kind === "object" || e.kind === "array") && isRefType(t)) t = unfolded(t.to);
    // A generic function value meeting a function type that isn't generic is the one instance
    // that type gives it: an arrow calling it, its parameters typed from there.
    if (t !== undefined && typeof t !== "string" && ((t.kind === "function" && !t.generic) || (isCallable(t) && !callableOf.get((t as DynType).of)?.generic))) instanceArrow(e);
    if (e.kind === "arrow" && typeof t !== "string" && t.kind === "function") expecting.set(e, t);
    // An object literal meeting a JS shape, or an Option of one, takes the types of its fields.
    const shapes = t === undefined ? [] : (typeof t !== "string" && t.kind === "union" ? t.members : [t]).flatMap((m) => jsShape(m) ?? []);
    if (e.kind === "object" && shapes.length === 1) {
      for (const p of e.props) {
        const declared = p.kind === "property" ? shapes[0]!.fields.find((f) => f.name === p.key)?.type : undefined;
        if (declared && p.kind === "property") expect(p.value, declared);
      }
    }
    // A `new Promise`, `Promise.resolve` or `Promise.reject` meeting a `Promise<T>`, or awaited
    // where a T is wanted, takes its T from there.
    const makesPromise = (x: Expr) => (x.kind === "new" && x.callee.kind === "ident" && x.callee.name === "Promise") || (x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise");
    if (t !== undefined && makesPromise(e) && promiseMet(t) !== undefined) wanted.set(e, t);
    if (t !== undefined && e.kind === "unary" && e.op === "await" && makesPromise(e.operand)) awaitedAs.set(e.operand, t);
    // An arrow for a union holding one callable, like an optional callback, is stored as that
    // callable.
    const callables = e.kind === "arrow" && typeof t !== "string" && t?.kind === "union" ? t.members.filter(isCallable) : [];
    if (callables.length === 1) t = callables[0]!;
    // A value written where a Dyn is wanted, as an object literal's field, is boxed into it there.
    const box = t === undefined ? undefined : boxedIn(t);
    if (e.kind !== "arrow" && box) wanted.set(e, box);
    // An arrow written where a callable is stored captures by move: the callable owns it all.
    if (e.kind === "arrow" && typeof t !== "string" && t.kind === "dyn" && callableOf.has(t.of)) {
      expecting.set(e, callableOf.get(t.of)!);
      owning.add(e);
      wanted.set(e, t);
    }
    // An array literal where a union is expected is expected to be its one array, tuple or fixed
    // array member of a length the literal could have.
    if (e.kind === "array" && typeof t !== "string" && t.kind === "union") {
      const fitting = t.members.filter((m) => couldHold(m, e));
      if (fitting.length === 1) t = fitting[0]!;
    }
    // An array literal's elements are expected to be its element type, and an object literal's
    // properties their fields'.
    if (e.kind === "array" && isArray(t)) {
      wanted.set(e, t.element);
      for (const x of e.elements) if (x) expect(x.kind === "spread" ? x.value : x, x.kind === "spread" ? t : t.element);
    }
    // A literal where a fixed array is expected is that fixed array; an Option or union holding
    // one fixed array expects that one.
    if ((e.kind === "array" || e.kind === "call") && typeof t !== "string" && t.kind === "union" && t.members.filter(isFixed).length === 1) t = t.members.find(isFixed)!;
    if (e.kind === "array" && isFixed(t)) {
      fixedLiterals.set(e, t);
      for (const x of e.elements) if (x) expect(x, t.element);
    }
    if (e.kind === "call" && isFixed(t)) wanted.set(e, t);
    // A literal where a tuple is expected is that tuple, each element expected to be its own; an
    // Option or union holding one tuple expects that tuple.
    if ((e.kind === "array" || tupleLiterals.has(e)) && typeof t !== "string" && t.kind === "union" && t.members.filter(isTuple).length === 1) t = t.members.find(isTuple)!;
    if ((e.kind === "array" || tupleLiterals.has(e)) && isTuple(t)) {
      tuples.set(e, t as ObjectType);
      const elements = elementsOf(t as ObjectType);
      tupleParts(e).forEach((x, i) => x && elements[i] !== undefined && expect(x, elements[i]!));
    }
    if (e.kind === "conditional") {
      expect(e.then, t);
      expect(e.else, t);
    }
    if (e.kind === "unsafe") expect(e.expr, t);
    if (e.kind === "match") for (const arm of e.arms) for (const v of armValues(arm.body)) expect(v, t);
    if (e.kind === "pipe") expect(e.body, t);
    // An object literal where a union is expected is expected to be the member it names: the one
    // with all its names whose literal fields its literals match.
    if (e.kind === "object" && typeof t !== "string" && t.kind === "union") {
      const props = e.props.filter((p): p is Extract<typeof p, { kind: "property" }> => p.kind === "property" && typeof p.key === "string");
      const named = t.members.map(unfold).filter((m): m is ObjectType => typeof m !== "string" && m.kind === "object" && props.every((p) => field(m, p.key as string)));
      const matching = named.filter((m) => props.every((p) => {
        const f = field(m, p.key as string)!.type;
        return typeof f === "string" || f.kind !== "literal" || (p.value.kind === "string" && p.value.value === f.value);
      }));
      if (matching.length === 1) t = matching[0]!;
    }
    if (e.kind === "object" && typeof t !== "string" && (t.kind === "object" || t.kind === "class")) {
      for (const p of e.props) if (p.kind === "property" && typeof p.key === "string" && field(t, p.key)) expect(p.value, field(t, p.key)!.type);
    }
    if (e.kind === "new" && typeof t !== "string" && (t.kind === "interior" || t.kind === "block" || t.kind === "map")) wanted.set(e, t);
    if (e.kind === "call" && e.callee.kind === "ident" && e.callee.name === "shared" && typeof t !== "string" && t.kind === "shared") wanted.set(e, t);
    const built = e.kind === "call" ? e.callee : e;
    if (built.kind === "member" && built.object.kind === "ident" && !lookup(built.object.name) && enums.get(built.object.name)?.data) wanted.set(built, t);
  }

  // Whether an array literal's length suits `t`: any array's, or a tuple's or fixed array's count.
  function couldHold(t: Type, e: Extract<Expr, { kind: "array" }>): boolean {
    if (isArray(t)) return true;
    const n = e.elements.length;
    const spread = e.elements.some((x) => x?.kind === "spread");
    if (isFixed(t)) return spread || n === t.size;
    if (!isTuple(t)) return false;
    const tuple = t as ObjectType;
    const count = elementsOf(tuple).length;
    return spread || (n >= (tuple.required ?? count) && (tuple.rest !== undefined || n <= count));
  }

  // What a match arm gives: its expression, or each value its block's `return`s give, leaving
  // out those of closures and matches inside it, which are theirs.
  function armValues(body: Expr | Stmt): Expr[] {
    if (body.kind !== "block") return [body as Expr];
    const found: Expr[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as { kind?: string; value?: Expr };
      if (n.kind === "arrow" || n.kind === "function" || n.kind === "match") return;
      if (n.kind === "return" && n.value) found.push(n.value);
      Object.values(node).forEach(visit);
    };
    visit(body);
    return found;
  }

  // A call's type, `void` included, or any other expression's.
  function result(e: Expr): Type {
    if (e.kind === "tagged" && !isQuote(e)) untag(e);
    if (e.kind !== "call") return value(e);
    // A call returning a value records it, as reading any other value does.
    const { type } = call(e);
    if (type !== "void") types.set(e, type);
    return type;
  }

  // Only a statement may call a function that returns nothing.
  function effect(e: Expr) {
    if (e.kind === "tagged" && !isQuote(e)) untag(e);
    if (e.kind === "assign" || e.kind === "update") staticWrite(e);
    if (e.kind === "call") {
      const { type } = call(e);
      // A parse read only to check the text still makes its value, which is then dropped.
      if (jsonCalls.get(e) === "parse") types.set(e, type);
      if (typeof type !== "string" && type.kind === "future" && leafOf.has(type)) {
        throw new CompileError("this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'", e.start, e.end);
      }
    } else if (e.kind === "match") match(e, false);
    else if (e.kind === "pipe") pipe(e, false);
    else if (e.kind === "unary" && e.op === "await") {
      const gives = awaited(e);
      if (gives !== "void") types.set(e, gives);
    }
    else {
      if (e.kind === "assign") statementAssign = e;
      value(e);
    }
  }

  // `match`: the subject is read once, then each arm's pattern is tried in order, binding names
  // in the arm's own scope, then its guard. Every value of the subject's type must be covered.
  // Used as a statement, its arms may give nothing. Matching a value just made, the bindings own
  // its parts; matching a place, they borrow them. A block arm gives what its `return`s do.
  function match(e: Extract<Expr, { kind: "match" }>, wanted: boolean): Type {
    const subject = read(e.subject);
    const owning = made(e.subject);
    const given = e.arms.flatMap((arm) => ctx.arm((): [Expr, Type][] => {
      pattern(arm.pattern, subject, !owning);
      if (arm.guard) condition(arm.guard);
      if (arm.body.kind === "block") return ctx.block(arm.body, wanted);
      return [[arm.body, wanted ? value(arm.body) : result(arm.body)]];
    }));
    const example = uncovered(typing, ids, e.arms.filter((a) => !a.guard).map((a) => [a.pattern]), [subject], (p) => ctx.patterns.get(p));
    if (example) throw new CompileError(missing(typing, example[0]!, subject), e.start, e.subject.end + 1);
    if (!wanted) return "void";
    // Arms that only throw give nothing, so some other arm has to.
    if (given.length === 0) throw new CompileError("no arm of this match gives a value; 'return' one from an arm", e.start, e.subject.end + 1);
    // Number literals in an arm take the number type another arm gives, as a conditional's do.
    const types = given.map(([, t]) => t);
    const numeric = types.find((t) => isNumeric(t) && given.every(([v, u]) => u === t || literalOnly(v, isFloat(t))));
    if (numeric) given.forEach(([v, t], i) => t !== numeric && adapt(v, numeric) && (types[i] = numeric));
    for (let i = 0; i < given.length; i++) given[i]![1] = types[i]!;
    const type = types.every((t) => t === types[0]) ? types[0]! : unionType(types);
    if (type !== types[0] && types.some((t) => typeof t !== "string" && t.kind === "closure")) throw unsupported("unions holding functions", e);
    if (holdsRef(type)) throw new CompileError(`a match can't give a reference it binds yet; ${holdsHandle(type, true) ? "match on a value just made to move its parts out" : "give a copy with '.clone()', or a field of it"}`, e.start, e.subject.end + 1);
    for (const [v, t] of given) if (t !== type) coerce(v, t, type, `this arm's '${show(t)}' doesn't fit the match's '${show(type)}'`);
    return type;
  }

  // `x |> f(%)`. Over a place, the pipe means its right side with the place written for each
  // `%`, so it reads, borrows and moves as that would: the node becomes that expression, and
  // later stages never see a pipe. Over anything else, or a place the right side assigns, the
  // value is made once, as JavaScript reads it, and kept in a hidden read-only binding each `%`
  // names, dropped when the pipe ends unless moved out.
  function pipe(e: Extract<Expr, { kind: "pipe" }>, wanted: boolean): Type {
    const type = value(e.value);
    const hidden = steady(e.value) ? hides(e.body, e.value) : undefined;
    if (hidden?.kind === "ident") {
      throw new CompileError(`this '${hidden.name}' hides the '${hidden.name}' the pipe reads for '%'; rename it`, hidden.start, hidden.end);
    }
    if (!steady(e.value) || assigns(e.body, e.value)) {
      // A place the right side writes is read once, as JavaScript reads it: a copy, or else a
      // shared borrow, so the write must wait until the topic's last use.
      const borrowed = steady(e.value) && !isCopy(type);
      const topic = borrowed ? refType(type, false) : type;
      if (borrowed) coerce(e.value, type, topic, "");
      return ctx.arm(() => {
        ctx.bind("%", topic, e);
        e.body = topics(e.body, (at) => ({ id: nextId(ids), kind: "ident", name: "%", start: at.start, end: at.end }));
        if (!wanted) return effect(e.body), "void";
        const given = value(e.body);
        if (holdsRef(given)) throw new CompileError("a pipe over a value can't give a reference yet, since the value is dropped once the pipe ends; give a copy with '.clone()'", e.start, e.end);
        return given;
      });
    }
    const place = e.value;
    const body = topics(e.body, (at) => {
      const copy = spanned(renumber(structuredClone(place), () => nextId(ids)), at);
      for (let m: Expr = copy; m.kind === "member" || m.kind === "index"; m = m.object) if (m.kind === "member") substituted.add(m);
      return copy;
    });
    for (const key of Object.keys(e)) if (key !== "id") delete (e as Record<string, unknown>)[key];
    Object.assign(e, body, { id: e.id });
    if (wanted) return value(e);
    effect(e);
    return "void";
  }

  // A place as a path: its variable or `this`, then its fields, cut where an element is read,
  // since writing any element of an array may change any other.
  function path(e: Expr): string[] | undefined {
    const parts: string[] = [];
    for (; e.kind === "member" || e.kind === "index"; e = e.object) parts.unshift(e.kind === "member" ? e.name : "[]");
    const root = e.kind === "ident" ? e.name : e.kind === "this" ? "this" : undefined;
    if (root === undefined) return undefined;
    const all = [root, ...parts];
    return all.includes("[]") ? all.slice(0, all.indexOf("[]")) : all;
  }

  // The names an index in a place reads.
  function indexNames(place: Expr): Set<string> {
    const names = new Set<string>();
    for (let at = place; at.kind === "member" || at.kind === "index"; at = at.object) if (at.kind === "index" && at.index.kind === "ident") names.add(at.index.name);
    return names;
  }

  // Whether an expression assigns something the place is, holds or is held in, or an index name.
  function assigns(body: Expr, place: Expr): boolean {
    const own = path(place)!;
    const names = indexNames(place);
    const overlaps = (target: Expr) => {
      const p = path(target);
      if (!p) return false;
      if (p.length === 1 && names.has(p[0]!)) return true;
      return own.slice(0, Math.min(own.length, p.length)).every((s, i) => s === p[i]);
    };
    const visit = (node: unknown): boolean => {
      if (!node || typeof node !== "object") return false;
      const e = node as Expr;
      if ((e.kind === "assign" && overlaps(e.target)) || (e.kind === "update" && overlaps(e.operand))) return true;
      return Object.values(node).some(visit);
    };
    return visit(body);
  }

  // A binding the right side declares with a name the place reads, which would capture the
  // place written in for `%`.
  function hides(body: Expr, place: Expr): Expr | undefined {
    const root = path(place)![0]!;
    const names = new Set([...indexNames(place), ...(root === "this" ? [] : [root])]);
    let found: Expr | undefined;
    const topical = (node: unknown): boolean => !!node && typeof node === "object" && ((node as Expr).kind === "topic" || Object.values(node).some(topical));
    const declared = (node: unknown) => {
      if (found || !node || typeof node !== "object") return;
      const e = node as Expr;
      if (e.kind === "ident" && names.has(e.name)) found = e;
      Object.values(node).forEach(declared);
    };
    // A declaration's scope is the closest arrow, match arm, block, loop or `try` around it; it
    // captures the place only where a `%` is inside that scope.
    const visit = (node: unknown, scope: unknown) => {
      if (found || !node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      const opens = ["arrow", "block", "for", "forOf", "forIn", "try"].includes(n.kind as string) || ("guard" in n && "pattern" in n);
      const within = opens ? node : scope;
      for (const [key, child] of Object.entries(node)) {
        // Parameters, `let` declarators, match patterns and catch parameters declare names.
        const declares = key === "pattern" || key === "param" || (key === "target" && !("kind" in node));
        if (declares && topical(within)) declared(child);
        else if (!declares) visit(child, within);
      }
    };
    visit(body, body);
    return found;
  }

  // A place reading it again reads the same value: no part of it runs code.
  function steady(e: Expr): boolean {
    if (!place(e)) return false;
    for (let at = e; at.kind === "member" || at.kind === "index"; at = at.object) {
      if (at.kind === "index" && at.index.kind !== "int" && at.index.kind !== "ident") return false;
    }
    return true;
  }

  // Calls a pipe's every `%` what `replace` makes of it: in its right side, and in the left
  // side of a pipe inside it, whose own right side has a topic of its own. As in TC39, the
  // topic itself is never assigned.
  function topics(body: Expr, replace: (topic: Expr) => Expr): Expr {
    if (body.kind === "topic") return replace(body);
    if (body.kind === "pipe") {
      body.value = topics(body.value, replace);
      return body;
    }
    const visit = (node: Record<string, unknown>) => {
      for (const [key, child] of Object.entries(node)) {
        if (!child || typeof child !== "object") continue;
        const kind = (child as { kind?: unknown }).kind;
        const written = (key === "target" && (node.kind === "assign" || node.kind === "destructure")) || (key === "operand" && node.kind === "update");
        if (kind === "topic" && written) {
          const at = child as Expr;
          throw new CompileError("'%' can't be assigned; it stands for the pipe's value, so assign to what you piped instead", at.start, at.end);
        }
        if (kind === "topic") node[key] = replace(child as Expr);
        else if (kind === "pipe") {
          const inner = child as Extract<Expr, { kind: "pipe" }>;
          inner.value = topics(inner.value, replace);
        } else visit(child as Record<string, unknown>);
      }
    };
    visit(body as unknown as Record<string, unknown>);
    return body;
  }

  // A copy of an expression standing where `at` was, for messages and for keys by position.
  function spanned(e: Expr, at: Expr): Expr {
    const visit = (node: Record<string, unknown>) => {
      if ("start" in node && "end" in node) [node.start, node.end] = [at.start, at.end];
      for (const child of Object.values(node)) if (child && typeof child === "object") visit(child as Record<string, unknown>);
    };
    visit(e as unknown as Record<string, unknown>);
    return e;
  }

  // Checks a pattern against the type of the value it meets, declaring what it binds and
  // recording what it tests. A name is a unit member of the matched enum, or an Option's
  // `None`, before it is a binding. A borrowing binding of a part that isn't Copy is a shared
  // reference to it.
  function pattern(p: Pattern, type: Type, borrowing: boolean) {
    const record = (test: PatternTest) => ctx.patterns.set(p, { type, ...test });
    const members = typeof type !== "string" && type.kind === "union" ? type.members : [type];
    const optional = members.includes("null");
    const never = () => new CompileError(`this pattern can never match a '${show(type)}'`, p.start, p.end);
    switch (p.kind) {
      case "wildcard":
        return record({ kind: "any" });
      case "ident": {
        const unit = variantNamed(members, p.name);
        if (unit && unit.fields.length === 0) return record({ kind: "variant", variant: unit, args: [] });
        if (p.name === "None" && optional) return record({ kind: "none" });
        // A C-like enum's member may be named bare too, as a data enum's unit member may.
        const named = members.filter((m): m is LiteralType => typeof m !== "string" && m.kind === "literal" && m.owner?.member === p.name);
        if (named.length > 1) {
          throw new CompileError(`'${p.name}' is a member of ${named.map((m) => `'${m.owner!.enum}'`).join(" and ")}; name which, as '${named[0]!.owner!.enum}.${p.name}'`, p.start, p.end);
        }
        if (named[0]) return record({ kind: "literal", value: named[0].value, member: named[0] });
        ctx.bind(p.name, borrowing && !isCopy(type) ? refType(type, false) : type, p as Expr);
        return record({ kind: "any" });
      }
      case "literal": {
        if (p.value.kind === "null") {
          if (!optional) throw never();
          value(p.value);
          return record({ kind: "none" });
        }
        let t = value(p.value);
        // A number takes the matched type's number type, as a literal operand does.
        const numeric = members.find(isNumeric);
        if (isNumeric(t) && members.filter(isNumeric).length > 1) {
          throw new CompileError(`a number can't be matched against '${show(type)}', which holds several number types; convert the value with 'as' first`, p.start, p.end);
        }
        if (isNumeric(t) && numeric && t !== numeric) {
          coerce(p.value, t, numeric, `'${show(t)}' can't match a '${show(numeric)}'`);
          t = numeric;
        }
        if (!comparable(type, t)) throw never();
        return record({ kind: "literal", value: literalOf(p.value) });
      }
      case "variant": {
        if (p.name === "Some" && optional && p.args?.length === 1) {
          const inner = unionType(members.filter((m) => m !== "null"));
          pattern(p.args[0]!, inner, borrowing);
          return record({ kind: "some", inner, arg: p.args[0]! });
        }
        const member = enumMember(p);
        if (member) {
          if (!comparable(type, member)) throw never();
          return record({ kind: "literal", value: member.value, member });
        }
        const v = variantNamed(members, p.name);
        if (!v) throw never();
        const args = p.args ?? [];
        if (args.length !== v.fields.length) {
          throw new CompileError(`'${v.name}' holds ${v.fields.length} value${v.fields.length === 1 ? "" : "s"}, so its pattern takes ${v.fields.length}`, p.start, p.end);
        }
        args.forEach((a, i) => pattern(a, v.fields[i]!.type, borrowing));
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
          if (typeof m === "string" || !(m.kind === "object" || m.kind === "class" || (m.kind === "param" && (m.bound?.kind === "object" || m.bound?.kind === "interface")))) return false;
          return p.props.every((prop, i) => {
            const field = objectFields(m).find((f) => f.name === keys[i]);
            const known = field && typeof field.type !== "string" && field.type.kind === "literal" ? field.type : undefined;
            return field && !(known && prop.value.kind === "literal" && literalOf(prop.value.value) !== known.value);
          });
        });
        if (shapes.length === 0) throw never();
        const fields = p.props.map((prop, i): [string, Pattern, Type] => {
          const ft = unionType(shapes.map((m) => objectFields(m).find((f) => f.name === keys[i])!.type));
          pattern(prop.value, ft, borrowing);
          return [keys[i]!, prop.value, ft];
        });
        return record({ kind: "object", shapes, fields });
      }
      case "array": {
        if (p.rest) throw unsupported("rest patterns", p.rest);
        if (p.elements.some((x) => x === undefined)) throw unsupported("holes in array patterns", p);
        const array = members.find(isArray);
        if (members.some(isTuple)) throw new CompileError("array patterns over tuples in 'match' are not supported yet; take the tuple apart first, as in 'const [a, b] = t'", p.start, p.end);
        if (!array || members.length > 1) throw never();
        const items = p.elements as Pattern[];
        for (const item of items) pattern(item, array.element, borrowing);
        return record({ kind: "array", element: array.element, items });
      }
      case "or":
        for (const alt of p.patterns) pattern(alt, type, borrowing);
        if (p.patterns.some((alt) => bindings(alt).some((b) => locals.has(b as Expr)))) throw unsupported("alternatives binding names", p);
        return record({ kind: "or", alternatives: p.patterns });
      default:
        throw unsupported(`${p.kind} patterns`, p);
    }
  }

  // A C-like enum's member named by a pattern, `Color.Red`.
  function enumMember(p: Extract<Pattern, { kind: "variant" }>): LiteralType | undefined {
    const [owner, name] = p.name.split(".");
    return p.args === undefined && name !== undefined && !lookup(owner!) ? enums.get(owner!)?.members.get(name) : undefined;
  }

  // The variant among a type's members that a pattern names: `Circle`, or `Shape.Circle`.
  function variantNamed(members: Type[], name: string): VariantType | undefined {
    const parts = name.split(".");
    const member = parts.at(-1)!;
    const owner = parts.length > 1 ? parts.slice(0, -1).join(".") : undefined;
    return members.find((m): m is VariantType => typeof m !== "string" && m.kind === "variant" && m.member === member && (owner === undefined || m.enum === owner));
  }

  // Checks a call: what it returns, and how a message names what it calls. A method called in
  // an optional chain gives an Option.
  function call(e: Call): { type: Type; what: string } {
    const variant = promiseVariants.get(e);
    if (variant) {
      const nothing = lower(resolveType(variant.typeArgs[0]!)) === "void";
      (e.callee as Extract<Expr, { kind: "ident" }>).name = nothing ? `${variant.name} void` : variant.name;
      e.typeArgs = nothing ? variant.typeArgs.slice(1) : variant.typeArgs;
    }
    const result = callee(e);
    // A call checked as another form, as `isDeepStrictEqual` is, has its own type already.
    if ((e as Expr).kind !== "call") return result;
    return e.callee.kind === "member" && linked(e.callee) && result.type !== "void" ? { ...result, type: optional(result.type, e) } : result;
  }

  function callee(e: Call): { type: Type; what: string } {
    // `t[0](x)` calls a tuple's element, as a field holding a callable is called.
    untuple(e.callee);
    const { callee } = e;
    if (e.optional) throw unsupported("optional calls", e);
    if (callee.kind === "super") {
      if (e !== superCall) throw new CompileError("'super(...)' can only be the first statement of a derived class's constructor", e.start, e.end);
      const base = classOf(self!.type.base!);
      types.set(callee, base.type);
      if (base.constructor.params.at(-1)?.rest) packRest(e, e.args, base.constructor.params);
      else refuseSpread(e.args);
      expectFrom(base.constructor, e.args);
      const argTypes = e.args.map(value);
      const instance = instantiate(base.constructor, [], e.args, argTypes, e);
      args(e.args, argTypes, instance, e);
      calls.set(e, instance);
      const error = errorOf(instance);
      if (error) raise(e, error, "'super'");
      return { type: "void", what: "'super'" };
    }
    // A program's own `console` or `print` keeps its meaning.
    const printer = callee.kind === "ident" ? callee.name : callee.kind === "member" && callee.object.kind === "ident" ? callee.object.name : "";
    if (isPrint(callee) && !lookup(printer) && !classes.has(printer) && !byName.has(printer) && !byName.has(`const ${printer}`) && !enums.has(printer)) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError(`'${printer}' is always there, so it is called without '?.'`, e.start, e.end);
      printCalls.add(e);
      shown(e.args);
      unformattable(e.args);
      return { type: "void", what: "printing" };
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && COMBINERS.includes(callee.name) && !lookup("Promise") && !classes.has("Promise")) {
      return combined(e, callee.name as Combiner);
    }
    // A static method of a package's class.
    const jsClass = callee.kind === "member" && callee.object.kind === "ident" && !lookup(callee.object.name) ? jsClasses.get(callee.object.name) : undefined;
    if (jsClass && callee.kind === "member") {
      const m = jsStatic(jsClass, callee.name, e);
      if (m.kind !== "method") throw new CompileError(`'${callee.name}' is a property of '${jsClass.name}', not a method`, callee.start, callee.end);
      if (m.typeParams.length > 0) throw unsupported("generic methods of a package's types", callee);
      const params = jsParams(m.params);
      params.forEach((p) => crossing(p, `'${jsClass.name}.${callee.name}' takes a`, e));
      jsArgs(e, params, m.params.map((p) => p.optional));
      const returns = m.returns ? resolveType(m.returns) : blockType("JsValue");
      return { type: crossing(returns === "void" ? "void" : jsView(returns), `'${jsClass.name}.${callee.name}' gives a`, e), what: `'${callee.name}'` };
    }
    if (callee.kind === "ident" && TIMER_CALLS.has(callee.name) && !lookup(callee.name) && !byName.has(callee.name)) {
      timerCall(e, callee.name);
      return call(e);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && callee.name === "withResolvers" && !lookup("Promise") && !classes.has("Promise")) {
      promiseResolvers(e);
      return call(e);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Promise" && (callee.name === "resolve" || callee.name === "reject") && !lookup("Promise") && !classes.has("Promise")) {
      promiseSettled(e, callee.name);
      return call(e);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "AbortSignal" && !lookup("AbortSignal") && !classes.has("AbortSignal")) {
      return signalStatic(e, callee);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && (callee.object.name === "TcpListener" || callee.object.name === "TcpStream") && !lookup(callee.object.name) && !classes.has(callee.object.name)) {
      return tcpStatic(e, callee, callee.object.name);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "FixedArray" && !lookup("FixedArray") && !classes.has("FixedArray")) return filled(e, callee);
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Array" && !lookup("Array") && !classes.has("Array")) return arrayStatic(e, callee);
    // `u8.fromBase64(s, options?)` and `u8.fromHex(s)`, TC39's Uint8Array statics on the byte type.
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "u8" && !lookup("u8") && !byName.has("u8") && !byName.has("const u8")) {
      const helper = Object.hasOwn(BYTE_DECODERS, callee.name) ? BYTE_DECODERS[callee.name] : undefined;
      if (!helper) throw new CompileError(`'u8' has no static '${callee.name}'; decode text into a 'u8[]' with 'u8.fromBase64' or 'u8.fromHex'`, callee.start, callee.end);
      if (callee.optional || e.optional) throw new CompileError(`'u8.${callee.name}' is always there, so it is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError(`'u8.${callee.name}' takes no type arguments`, e.start, e.end);
      const most = callee.name === "fromBase64" ? 2 : 1;
      if (e.args.length < 1 || e.args.length > most) throw new CompileError(most === 1 ? "'u8.fromHex' takes one string of hex digits" : "'u8.fromBase64' takes a string and an optional options object, as in '{ alphabet: \"base64url\" }'", e.start, e.end);
      Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: helper, start: callee.start, end: callee.end } });
      return call(e);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "String" && !lookup("String") && !classes.has("String") && !byName.has("String") && !byName.has("const String") && !enums.has("String")) return stringStatic(e, callee);
    if (callee.kind === "member" && isMath(callee.object)) {
      if (callee.optional || e.optional) throw new CompileError("'Math' is always there, so its functions are called without '?.'", e.start, e.end);
      return mathCall(e, callee.name);
    }
    const clock = clockOf(callee);
    if (clock) {
      if (e.optional || (callee.kind === "member" && callee.optional)) throw new CompileError(`'${clock.split(".")[0]}' is always there, so '${clock}()' is called without '?.'`, e.start, e.end);
      if (e.typeArgs.length > 0) throw new CompileError(`'${clock}' takes no type arguments`, e.start, e.end);
      if (e.args.length > 0) throw new CompileError(`'${clock}' takes no arguments`, e.start, e.end);
      clocks.set(e, clock);
      return { type: clock === "Date.now" ? "i64" : "f64", what: `'${clock}'` };
    }
    const json = jsonOf(callee);
    if (json && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError("'JSON' is always there, so its functions are called without '?.'", e.start, e.end);
    if (json === "stringify") return stringify(e);
    if (json === "parse") return jsonParse(e);
    const parser = parserOf(callee);
    if (parser && (e.optional || (callee.kind === "member" && callee.optional))) throw new CompileError(`'${parser}' is always there, so it is called without '?.'`, e.start, e.end);
    if (parser) return parse(e, parser);
    if (callee.kind === "ident" && callee.name === "assert" && (e.start >= STD_BASE || (!lookup("assert") && !classes.has("assert") && !byName.has("assert") && !byName.has("const assert")))) return assertion(e);
    // `new Array(n).fill(x)`: n copies of x, the only form `new Array(n)` takes.
    if (callee.kind === "member" && callee.name === "fill" && callee.object.kind === "new" && callee.object.callee.kind === "ident" && callee.object.callee.name === "Array" && !lookup("Array") && !classes.has("Array")) {
      const made = callee.object;
      if (e.typeArgs.length > 0) throw new CompileError("'fill' takes no type argument; write the element type on the array, as in 'new Array<u8>(n).fill(0)'", e.start, e.end);
      if (made.args?.length !== 1 || e.args.length !== 1) throw new CompileError("'new Array(n).fill(x)' makes n copies of x; it takes one length and one value", e.start, e.end);
      const [n, x] = [made.args[0]!, e.args[0]!];
      Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: "array filled", start: callee.start, end: callee.end }, args: [arrayLength(n, true), x], typeArgs: made.typeArgs });
      fills.add(e);
      return call(e);
    }
    // The rewritten fill, checked again in each generic instance: what the prelude can't do with
    // the value is said at the value, not inside the prelude.
    if (fills.has(e) && !filling.has(e)) {
      const x = e.args[1]!;
      filling.add(e);
      let result;
      try {
        result = call(e);
      } catch (err) {
        if (err instanceof CompileError && err.start >= STD_BASE) throw new CompileError(`'new Array(n).fill(x)' can't be made from this value: ${err.message}`, x.start, x.end);
        throw err;
      } finally {
        filling.delete(e);
      }
      const t = lower(types.get(x)!);
      if (typeof t !== "string" && t.kind === "generator") throw new CompileError("'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once", x.start, x.end);
      clonable(t, x);
      return result;
    }
    // A length the user wrote, an `i64` or a `usize`; a fill's panics when negative, as JavaScript throws.
    if (callee.kind === "ident" && callee.name === "fill length") {
      const t = read(e.args[0]!);
      if (t !== "i64" && t !== "usize") throw new CompileError(`an array's length is an 'i64' or a 'usize', not '${show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      return { type: "i64", what: "an array length" };
    }
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? receiverType(callee) : undefined;
    if (callee.kind === "member" && callee.name === "clone" && receiver && copies(receiver)) return cloned(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && stringLike(receiver)) return stringCall(e, callee, receiver);
    // A bigint's digits, in base 10 or the radix given.
    if (callee.kind === "member" && receiver === "bigint") {
      if (callee.name !== "toString") throw new CompileError(`'bigint' has no method '${callee.name}'`, callee.start, callee.end);
      if (e.args.length > 1) throw new CompileError("'toString' takes at most a radix", e.start, e.end);
      if (e.args[0]) coerce(e.args[0], value(e.args[0]), "i64", "a radix is an 'i64' from 2 to 36");
      return { type: "string", what: "'toString'" };
    }
    if (callee.kind === "member" && receiver !== undefined && isArray(receiver)) return arrayCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "map" && callee.name !== "clone") return mapCall(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && yieldsOf(receiver) !== undefined) return generatorCall(e, callee, receiver, yieldsOf(receiver)!);
    if (callee.kind === "member" && receiver !== undefined && yieldsOf(receiver, true) !== undefined && (typeof receiver === "string" || receiver.kind !== "dyn")) return generatorCall(e, callee, receiver, yieldsOf(receiver, true)!, true);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "pointer") return pointerCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "interior") return interiorCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "shared") return sharedCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "block") return blockCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "handle" && callee.name !== "clone") return handleCall(e, callee, receiver);
    if (callee.kind === "member" && callee.name !== "clone" && typeof receiver !== "string" && receiver?.kind === "dyn") return dynCall(e, callee, receiver);
    if (callee.kind === "ident" && callee.name === "shared" && !lookup(callee.name) && !byName.has("shared")) return sharedNew(e);
    if (callee.kind === "member" && callee.name === "toFixed" && receiver !== undefined && isNumeric(lower(receiver))) {
      const n = lower(receiver);
      if (isInteger(n) && INTEGERS[n].bits === 128) throw new CompileError(`'toFixed' on a 128-bit integer isn't supported yet; convert it with 'as f64' first`, callee.start, callee.end);
      return toFixed(e);
    }
    if (callee.kind === "member" && receiver !== undefined && isInteger(lower(receiver)) && integerMethod(callee.name)) return integerCall(e, callee, lower(receiver) as Integer);
    const rx = receiver === undefined ? undefined : asRegex(receiver);
    if (callee.kind === "member" && rx) return regexCall(e, callee, rx, lower(receiver!) !== rx);
    if (callee.kind === "member" && receiver !== undefined && isFixed(receiver)) {
      throw new CompileError(`a FixedArray has no method '${callee.name}' yet; loop over it with 'for...of', or read 'length'`, callee.start, callee.end);
    }
    // A field holding a stored callable, through an object-typed parameter's bound too.
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "param" && receiver.bound?.kind === "object") {
      const stored = field(receiver.bound, callee.name);
      const held = stored && lower(isRefType(stored.type) ? stored.type.to : stored.type);
      if (held && isCallable(held)) return callableCall(e, callee, held as DynType);
    }
    if (callee.kind === "member" && typeof receiver !== "string" && (receiver?.kind === "param" || receiver?.kind === "interface")) {
      return traitCall(e, callee, receiver);
    }
    // A nested function's call of itself comes before any outer name it shares.
    const itself = callee.kind === "ident" ? ctx.selfCall(e) : undefined;
    if (itself) return itself;
    const nested = callee.kind === "ident" ? nestedFunction(callee.name) : undefined;
    if (nested) return nestedCall(e, callee as Extract<Expr, { kind: "ident" }>, nested);
    // A local generic function is called as the generic function it was lifted to, and a generic
    // function value read from a name or a field as the function it names.
    const lifted = (callee.kind === "ident" ? (lookup(callee.name)?.generic as Body | undefined) : undefined) ?? genericTarget(callee, receiver);
    if (callee.kind === "ident" && !lifted && lookup(callee.name)) return closureCall(e, callee);
    // A field holding a stored callable, `this.onClick(e)`, when no method has that name.
    if (callee.kind === "member" && receiver !== undefined && typeof receiver !== "string" && (receiver.kind === "class" || receiver.kind === "object")) {
      const stored = field(receiver, callee.name);
      const method = receiver.kind === "class" && inherited(classOf(receiver), "methods", callee.name);
      const held = stored && lower(isRefType(stored.type) ? stored.type.to : stored.type);
      if (held && !method && isCallable(held)) return callableCall(e, callee, held as DynType);
    }
    if (callee.kind !== "ident" && callee.kind !== "member") {
      const given = value(callee);
      const held = lower(isRefType(given) ? given.to : given);
      if (isCallable(held)) return callableCall(e, callee, held as DynType);
      if (typeof held !== "string" && held.kind === "closure") return closureCall(e, callee, given);
    }
    // `Shape.Circle(1.5)` builds a variant from its payload.
    const named = callee.kind === "member" && callee.object.kind === "ident" && !lookup(callee.object.name) ? enums.get(callee.object.name) : undefined;
    if (named?.data && callee.kind === "member") {
      const ahead = expectedVariant(callee, named);
      if (ahead) e.args.forEach((a, i) => ahead.fields[i] && expect(a, ahead.fields[i]!.type));
      const given = e.args.map(value);
      const v = variant(callee, named, false, given, e.typeArgs);
      if (e.args.length !== v.fields.length) {
        throw new CompileError(`'${v.name}' holds ${v.fields.length} value${v.fields.length === 1 ? "" : "s"}, but ${e.args.length} ${e.args.length === 1 ? "was" : "were"} given`, e.start, e.end);
      }
      e.args.forEach((a, i) => {
        const t = given[i]!;
        coerce(a, t, v.fields[i]!.type, `argument of type '${show(t)}' is not assignable to '${v.name}', which holds '${show(v.fields[i]!.type)}'`);
      });
      types.set(callee, v);
      return { type: v, what: `'${v.name}'` };
    }
    // `ptrOf(r)` and `mutPtrOf(m)`: a raw pointer to what a reference, or a place, holds. Making
    // one is safe; the borrow lasts only for the call.
    if (callee.kind === "ident" && (callee.name === "ptrOf" || callee.name === "mutPtrOf") && !byName.has(callee.name)) {
      const mutable = callee.name === "mutPtrOf";
      if (e.args.length !== 1) throw new CompileError(`'${callee.name}' takes 1 argument`, e.start, e.end);
      const a = e.args[0]!;
      const t = value(a);
      // A type parameter may stand for a reference in one instance and a value in another, and
      // the two point at different things.
      if (typeof t !== "string" && t.kind === "param") throw unsupported(`'${callee.name}' calls on values whose type is a type parameter`, a);
      if (isRefType(t)) {
        if (mutable && !t.mutable) throw new CompileError("'mutPtrOf' needs a 'Mut' reference, or a place that may change", a.start, a.end);
        return { type: pointerType(t.to, mutable), what: `'${callee.name}'` };
      }
      if (!place(a)) throw new CompileError(`'${callee.name}' needs a variable or a field to point at; a temporary is gone once its statement ends`, a.start, a.end);
      if (mutable) changeable(a, "point mutably at");
      coerce(a, t, refType(t, mutable), "");
      return { type: pointerType(t, mutable), what: `'${callee.name}'` };
    }
    // `spawn(p)`: the future runs as a task of its own, on any thread, and its handle awaits it.
    // The std library's code calls the built-ins, whatever a program names its own functions.
    const inStd = e.start >= STD_BASE;
    // std's `timer spawn` is `spawn` with the task's first poll run at once.
    if (callee.kind === "ident" && ((callee.name === "spawn" && (!byName.has("spawn") || inStd)) || (callee.name === "timer spawn" && inStd))) {
      if (!ctx.async) throw new CompileError("'spawn' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      if (e.args.length !== 1) throw new CompileError("'spawn' takes the Promise to run, like 'spawn(save(user))'", e.start, e.end);
      // `spawn(async () => ...)` runs the arrow's body as the task: its call is what is spawned.
      const given = e.args[0]!;
      if (given.kind === "arrow" && given.async && given.params.length === 0) {
        e.args[0] = { id: nextId(ids), kind: "call", callee: given, typeArgs: [], args: [], optional: false, start: given.start, end: given.end };
      }
      const t = value(e.args[0]!);
      if (typeof t === "string" || t.kind !== "future" || t === YIELD_NOW || t === SLEEP || leafOf.has(t)) throw new CompileError(`'spawn' needs a Promise from an async function's call, not '${show(t)}'`, e.args[0]!.start, e.args[0]!.end);
      const blocker = unsent(t);
      if (blocker) {
        throw new CompileError(`'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a '${show(blocker)}', which ${typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for; pass an owned value, or a clone" : typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead" : "borrows from this function; pass an owned value, or a clone"}`, e.args[0]!.start, e.args[0]!.end);
      }
      return { type: handleType(t.gives, t.throws), what: "'spawn'" };
    }
    // `sleep(ms)`: a future done once that many milliseconds have passed, holding no thread.
    if (callee.kind === "ident" && callee.name === "sleep" && (!byName.has("sleep") || inStd)) {
      if (e.args.length !== 1 && e.args.length !== 2) throw new CompileError("'sleep' takes how many milliseconds to wait, like 'sleep(250)', and may take an AbortSignal", e.start, e.end);
      expect(e.args[0]!, "i64");
      const t = value(e.args[0]!);
      coerce(e.args[0]!, t, "i64", `'sleep' takes milliseconds as an 'i64', not '${show(t)}'`);
      if (e.args.length === 1) return { type: SLEEP, what: "'sleep'" };
      signalArgument(e.args[1]!, "'sleep'");
      return { type: leafFuture("sleep", "void", abortError(), true), what: "'sleep'" };
    }
    // `fileRead(path)` and `fileWrite(path, bytes)`: the futures node:fs/promises is written over,
    // each a job on the runtime's blocking pool.
    if (callee.kind === "ident" && (callee.name === "fileRead" || callee.name === "fileWrite") && fileAt(files, e.start).startsWith("node:")) {
      const reading = callee.name === "fileRead";
      if (e.args.length !== (reading ? 1 : 2)) throw new CompileError(`'${callee.name}' takes ${reading ? "a path" : "a path and the bytes"}`, e.start, e.end);
      const path = value(e.args[0]!);
      coerce(e.args[0]!, path, "string", `a path is a 'string', not '${show(path)}'`);
      if (!reading) {
        const bytes = value(e.args[1]!);
        coerce(e.args[1]!, bytes, arrayType("u8"), `the bytes are a 'u8[]', not '${show(bytes)}'`);
      }
      fileCalls.add(e);
      return { type: leafFuture(reading ? "readFile" : "writeFile", "void", ioError()), what: `'${callee.name}'` };
    }
    // The blocking calls node:fs is written over, as `fileReadSync(path)`, run on the calling
    // thread.
    const sync = callee.kind === "ident" && fileAt(files, e.start).startsWith("node:") ? syncFileSignatures(typing)[callee.name] : undefined;
    if (sync) {
      const [params, returns, throws] = sync;
      const name = (callee as Extract<Expr, { kind: "ident" }>).name;
      if (e.args.length !== params.length) throw new CompileError(`'${name}' takes ${params.length} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
      e.args.forEach((a, i) => {
        const t = value(a);
        coerce(a, t, params[i]!, `argument of type '${show(t)}' is not assignable to parameter of type '${show(params[i]!)}'`);
      });
      if (throws) raise(e, ioError(), `'${name}'`);
      syncFileCalls.set(e, name);
      return { type: returns, what: `'${name}'` };
    }
    // The std's timers: `timerSet(callback, ms, repeat, loop)` hands a callable to the runtime,
    // starting the timer task `loop` once; `timerNext()` waits for the next one due, and
    // `timerClear(id)` drops one.
    if (callee.kind === "ident" && (inStd || timerSets.has(e)) && (callee.name === "timerSet" || callee.name === "timerNext" || callee.name === "timerClear")) {
      timerCalls.set(e, callee.name);
      if (callee.name === "timerNext") return { type: leafFuture("timerNext", timerCallback()), what: "'timerNext'" };
      if (callee.name === "timerClear") {
        coerce(e.args[0]!, value(e.args[0]!), "i64", "a timer's id is an 'i64'");
        return { type: "void", what: "'timerClear'" };
      }
      expect(e.args[0]!, timerCallback());
      coerce(e.args[0]!, value(e.args[0]!), timerCallback(), "a timer runs an async function");
      const delay = value(e.args[1]!);
      coerce(e.args[1]!, delay, "i64", `a delay is milliseconds as an 'i64', not '${show(delay)}'`);
      coerce(e.args[2]!, value(e.args[2]!), "boolean", "whether it repeats is a 'boolean'");
      value(e.args[3]!);
      return { type: "i64", what: "'timerSet'" };
    }
    if (callee.kind === "ident" && callee.name === "jsEvaluate" && fileAt(files, e.start) === "fish:engine") {
      coerce(e.args[0]!, value(e.args[0]!), "string", "a module's source is a 'string'");
      jsEvaluations.add(e);
      return { type: blockType("JsValue"), what: "'jsEvaluate'" };
    }
    // `yieldNow()`: a future that is pending once, letting other tasks run.
    if (callee.kind === "ident" && callee.name === "yieldNow" && (!byName.has("yieldNow") || inStd)) {
      if (e.args.length > 0) throw new CompileError("'yieldNow' takes no arguments", e.start, e.end);
      return { type: YIELD_NOW, what: "'yieldNow'" };
    }
    // `cString(s)`: a pointer to a NUL-terminated copy of `s` for C, which the enclosing block
    // owns and frees when it ends.
    if (callee.kind === "ident" && callee.name === "cString" && !byName.has("cString")) {
      if (e.args.length !== 1) throw new CompileError("'cString' takes 1 argument", e.start, e.end);
      if (ctx.generator) throw unsupported("'cString' inside generators", callee);
      if (ctx.async) throw unsupported("'cString' inside async functions", callee);
      const t = value(e.args[0]!);
      coerce(e.args[0]!, t, "string", `'cString' takes a string, not '${show(t)}'`);
      return { type: pointerType("u8", false), what: "'cString'" };
    }
    // `fromCString(p)`: a new string from a C string's bytes, read up to its NUL.
    if (callee.kind === "ident" && callee.name === "fromCString" && !byName.has("fromCString")) {
      needsUnsafe("'fromCString'", callee);
      if (e.args.length !== 1) throw new CompileError("'fromCString' takes 1 argument", e.start, e.end);
      const want = pointerType("u8", false);
      const t = value(e.args[0]!);
      coerce(e.args[0]!, t, want, `'fromCString' takes a 'Ptr<u8>', not '${show(t)}'`);
      return { type: "string", what: "'fromCString'" };
    }
    // The time as an HTTP Date header gives it, for the std HTTP server alone.
    if (callee.kind === "ident" && callee.name === "httpDate" && e.start >= STD_BASE && e.args.length === 0) return { type: "string", what: "'httpDate'" };
    // Milliseconds on a clock that only goes forward, for the std HTTP server's deadlines.
    if (callee.kind === "ident" && callee.name === "nowMs" && e.start >= STD_BASE && e.args.length === 0) return { type: "i64", what: "'nowMs'" };
    // The signal the first SIGINT or SIGTERM aborts, for node:process's 'shutdown' and the HTTP server.
    if (callee.kind === "ident" && callee.name === "shutdownSignal" && (e.start >= STD_BASE || fileAt(files, e.start).startsWith("node:")) && e.args.length === 0) return { type: blockType("AbortSignal"), what: "'shutdownSignal'" };
    // The UTF-8 conversions behind the prelude's TextEncoder and TextDecoder, which only they call.
    if (callee.kind === "ident" && (callee.name === "utf8Encode" || callee.name === "utf8Decode") && owner?.name === (callee.name === "utf8Encode" ? "TextEncoder" : "TextDecoder")) {
      value(e.args[0]!);
      return { type: callee.name === "utf8Encode" ? arrayType("u8") : "string", what: `'${callee.name}'` };
    }
    // `nullPtr<T>()`: a pointer to nothing, which may be used as either kind.
    if (callee.kind === "ident" && callee.name === "nullPtr" && !byName.has("nullPtr")) {
      needsUnsafe("'nullPtr'", callee);
      if (e.typeArgs.length !== 1 || e.args.length > 0) throw new CompileError("'nullPtr' takes the type it points to, like 'nullPtr<u8>()'", e.start, e.end);
      return { type: pointerType(resolveType(e.typeArgs[0]!), true), what: "'nullPtr'" };
    }
    // `BigInt(x)`: an integer of any size as a bigint. A float is refused rather than checked
    // for a fraction while the program runs.
    if (callee.kind === "ident" && callee.name === "BigInt" && !byName.has("BigInt")) {
      if (e.args.length !== 1) throw new CompileError("'BigInt' takes 1 argument", e.start, e.end);
      const t = operand(e.args[0]!);
      if (t !== "bigint" && !isInteger(t)) throw new CompileError(`'BigInt' takes an integer, not '${show(t)}'${isFloat(t) ? "; convert the float with 'as i64' first" : ""}`, e.args[0]!.start, e.args[0]!.end);
      return { type: "bigint", what: "'BigInt'" };
    }
    // `String(x)`: a string, number or boolean written as JavaScript writes it.
    if (callee.kind === "ident" && callee.name === "String" && (!byName.has("String") || inStd)) {
      if (e.args.length !== 1) throw new CompileError("'String' takes 1 argument", e.start, e.end);
      joined(e.args[0]!, operand(e.args[0]!), "'String'");
      return { type: "string", what: "'String'" };
    }
    const found = lifted ?? (callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee, receiver) : undefined);
    // A package's function declared with several signatures is checked against the first that
    // takes the arguments, as TypeScript picks one.
    const target = found?.js?.overloads ? jsOverload(e, found) : found?.overloads && !(e as Direct).implementation ? overload(e, found) : found;
    // A package's const is a value; one holding a function would be a function crossing from JS.
    if (target?.js?.const) {
      const held = resolveType(target.returnType!);
      const callable = typeof held !== "string" && (held.kind === "function" || held.kind === "closure" || (held.kind === "param" && held.bound?.kind === "function"));
      throw new CompileError(callable ? `'${target.js.name}' from '${target.js.module}' holds a function, and functions crossing between Fish and JS aren't supported yet` : `this expression is not callable: type '${show(jsView(held))}' has no call signatures`, e.start, e.end);
    }
    if (target?.name.replace(/-fsh\d+$/, "") === "ok" && fileAt(files, target.start) === "node:assert") return assertion(e);
    // node:util's functions that take any values, as Node's do, given their meaning here.
    const util = target && callee.kind === "ident" && fileAt(files, target.start) === "node:util" ? target.name.replace(/-fsh\d+$/, "") : undefined;
    if (util === "format") {
      if (e.optional) throw new CompileError("'format' is always there, so it is called without '?.'", e.start, e.end);
      refuseSpread(e.args);
      shown(e.args);
      unformattable(e.args);
      formatCalls.add(e);
      return { type: "string", what: "'format'" };
    }
    if (util === "inspect") {
      if (e.args.length !== 1 || e.args[0]!.kind === "spread") throw new CompileError(e.args.length > 1 ? "'inspect' takes the value alone; its options aren't supported yet" : "'inspect' takes 1 argument", e.start, e.end);
      shown(e.args);
      inspectCalls.add(e);
      return { type: "string", what: "'inspect'" };
    }
    // `parseArgs(config)` calls std's port with the arguments its literal says, once.
    if (util === "parseArgs" && !parsedArgs.has(e)) {
      if (e.optional) throw new CompileError("'parseArgs' is always there, so it is called without '?.'", e.start, e.end);
      refuseSpread(e.args);
      e.args = parseArgsArgs(ids, e);
      parsedArgs.add(e);
    }
    // Fish's value equality, which `===` already is.
    if (util === "isDeepStrictEqual") {
      if (e.args.length !== 2) throw new CompileError("'isDeepStrictEqual' takes 2 arguments", e.start, e.end);
      refuseSpread(e.args);
      const [left, right] = e.args as [Expr, Expr];
      const node = e as unknown as Record<string, unknown>;
      delete node.callee;
      delete node.args;
      Object.assign(node, { kind: "binary", op: "===", left, right });
      deepEqualities.add(e);
      return { type: value(e), what: "'isDeepStrictEqual'" };
    }
    if (target && (target as { macro?: boolean }).macro) throw new CompileError(`'${target.name}' is a macro, applied to a declaration as '@${target.name}'; it isn't called as a function`, e.start, e.end);
    if (!target) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}${callee.kind === "ident" ? didYouMean(callee.name, ctx.names(callee.start)) : ""}`, callee.start, callee.end);
    }
    if (target.foreign && !target.rust) needsUnsafe(`calling the C function '${target.name}'`, callee, "the compiler can't check what C code does");
    if (target.js) jsCalls.set(e, target.js);
    if (target.params.at(-1)?.rest && !tagCalls.has(e)) packRest(e, e.args, target.params);
    else refuseSpread(e.args);
    expectFrom(target, e.args);
    // An arrow given to a generic body is checked once the other arguments decide its types.
    const argTypes: Type[] = [];
    e.args.forEach((a, i) => a.kind !== "arrow" && (argTypes[i] = value(a)));
    const bounds = implicitOf(target);
    e.args.forEach((a, i) => {
      if (a.kind !== "arrow") return;
      // A generic function type's parameter takes the arrow as the family it is.
      const bound = bounds.get(i);
      const want = bound?.kind === "function" && bound.generic ? undefined : ctx.callbackType(target, e.typeArgs, argTypes, i, e);
      if (want) expect(a, want);
      argTypes[i] = value(a);
    });
    // The array iterators clone elements: a generic body's instance checks the real element.
    if ((target.name === "array entries" || target.name === "array values") && argTypes[0] !== undefined) {
      const array = lower(isRefType(argTypes[0]) ? argTypes[0].to : argTypes[0]);
      if (isArray(array)) clonable(array.element, e, target.name.slice("array ".length));
    }
    if (target.js) jsCrossings.add(e);
    if (target.js && !jsCalledAt.has(target)) jsCalledAt.set(target, e);
    // Its declaration was refused before a call reached it: this call is where that counts.
    const refused = target.js ? jsUncalled.get(target) : undefined;
    if (refused) {
      refused.note ??= { message: `'${target.js!.name}' is called here`, start: e.start, end: e.end };
      throw refused;
    }
    const instance = instantiate(target, e.typeArgs, e.args, argTypes, e);
    args(e.args, argTypes, instance, e);
    calls.set(e, instance);
    if (target.js) e.args.forEach((a) => givenToJs(a, types.get(a)!));
    // An async function's call only makes its future; its error comes at the `await`.
    // The error a call raises is the implementation's own, since that is what it gives, or what
    // an abstract declaration says it may.
    const declared = callee.kind === "member" ? abstractDeclaration(callee, "methods") : undefined;
    const error = errorOf(instance) ?? (declared && errorOf(instanceOf(declared)));
    if (error && !target.async) raise(e, error, `'${target.name}'`);
    const type = resultOf(declared ? instanceOf(declared) : instance, e);
    const object = callee.kind === "member" && instance.body.self ? callee.object : undefined;
    // A returned reference borrows what its lifetime says; a value holding references, what
    // was lent to the call, its receiver included.
    if (holdsRef(type)) borrowsFrom.set(e, sourcesOf(instance, e.args, object, e, lends));
    return { type, what: `'${target.name}'` };
  }

  // Whether a tagged template is a quote rather than a call of a tag the program declares.
  function isQuote(e: Extract<Expr, { kind: "tagged" }>): boolean {
    const tag = e.tag;
    return tag.kind === "ident" && (tag.name === "quote" || tag.name === "quoteType") && !lookup(tag.name) && !byName.has(tag.name);
  }

  // `` quote`a + ${x}` ``: the Ast value of the text, an expression's or a statement's, and of
  // `quoteType`, a type's; each splice takes a node of the category its place holds.
  function quote(e: Extract<Expr, { kind: "tagged" }>, asType: boolean): Type {
    if (e.typeArgs.length > 0) throw new CompileError("a quote takes no type arguments", e.start, e.end);
    const q = quoted(ctx.tables, e, asType);
    q.asExpressions.clear();
    q.names.clear();
    const at = { start: e.start, end: e.end };
    const types = Object.fromEntries((["AstExpr", "AstStmt", "AstType"] as const).map((n) => [n, resolveType({ id: nextId(ids), kind: "ref", name: n, args: [], ...at })])) as Record<Category, Type>;
    holesOf(typing, q, types, e).forEach((category, i) => {
      const hole = q.holes[i]!;
      const t = value(hole);
      // An expression where a statement goes is the statement `e;`.
      if (category === "AstStmt" && !fits(t, types.AstStmt) && fits(t, types.AstExpr)) {
        q.asExpressions.add(i);
        category = "AstExpr";
      }
      coerce(hole, t, types[category], `a splice where ${category === "AstExpr" ? "an expression" : category === "AstStmt" ? "a statement" : "a type"} goes takes an '${category}', not '${show(t)}'`);
    });
    quotes.set(e, types);
    return types[q.category];
  }

  // `` tag`a ${x} b` `` calls the tag with the template's text, known while compiling, then an
  // array of its values for the tag's rest parameter.
  function untag(e: Extract<Expr, { kind: "tagged" }>) {
    const { tag, template } = e;
    const target = tag.kind === "ident" && !lookup(tag.name) ? byName.get(tag.name) : undefined;
    if (tag.kind === "ident" && !target && !lookup(tag.name)) throw new CompileError(`unknown function '${tag.name}'${didYouMean(tag.name, ctx.names(tag.start))}`, tag.start, tag.end);
    if (!target || tag.kind !== "ident") throw new CompileError("a tag has to be the name of a top-level function; methods, closures and other values as tags aren't supported yet", tag.start, tag.end);
    const shape = `'comptime strings: TemplateStringsArray, ...values: T[]'`;
    if (!tagStrings(target.params[0])) {
      throw new CompileError(`'${tag.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, tag.start, tag.end);
    }
    if (target.params.length !== 2 || !target.params[1]!.rest) throw new CompileError(`'${tag.name}' can't be a tag: a tag takes ${shape}`, tag.start, tag.end);
    if (template.kind !== "template") throw new CompileError("a tag is followed by a template literal", template.start, template.end);
    const at = { start: template.start, end: template.end };
    const strings: Expr = { id: nextId(ids), kind: "array", elements: template.quasis.map((value): Expr => ({ id: nextId(ids), kind: "string", value, ...at })), ...at };
    const values: Expr = { id: nextId(ids), kind: "array", elements: template.exprs, ...at };
    Object.assign(e, { kind: "call", callee: tag, args: [strings, values], optional: false });
    tagCalls.add(e);
  }

  // An arrow passed where a function type is declared takes its parameter types from it.
  function expectFrom(target: Body, list: Expr[]) {
    const bounds = implicitOf(target);
    const generic = (target.typeParams?.length ?? 0) > 0 || (target.scope?.size ?? 0) > 0 || bounds.size > 0 || target.params.some((p) => p.comptime);
    const known = generic ? undefined : paramTypes(instanceOf(target));
    list.forEach((a, i) => {
      const t = bounds.get(i);
      if (t?.kind === "function") expect(a, target.js ? jsTakes(t) : t);
      // A `new Promise` given for a `Promise<T>` parameter takes its T from there.
      if (t?.kind === "interface" && promiseElement(t) !== undefined) expect(a, t);
      // An arrow in an object literal given for an object-typed parameter takes its field's type,
      // and a value for a Dyn field is boxed into it.
      if (t?.kind === "object" && a.kind === "object") {
        for (const p of a.props) {
          const declared = p.kind === "property" ? field(t, p.key as string)?.type : undefined;
          const boxes = declared !== undefined && boxedIn(declared) !== undefined;
          const want = p.kind === "property" && (p.value.kind === "arrow" || boxes) ? declared : undefined;
          if (want && p.kind === "property") expect(p.value, want);
        }
      }
      // A parameter of a function that isn't generic has its type before the call; an arrow
      // given to a package is a callback JS keeps, so it owns what it captures.
      if (a.kind !== "arrow" && known && known[i] !== undefined) expect(a, target.js ? jsTakes(known[i]!) : known[i]!);
      if (a.kind === "arrow" && known && target.js && known[i] !== undefined) expect(a, jsTakes(known[i]!));
      // A literal for a tuple parameter is a tuple of its parts, in the parameter's shape.
      const node = target.params[i]?.type;
      if (!known && (a.kind === "array" || tupleLiterals.has(a)) && node?.kind === "tuple") {
        shaped.add(a);
        if (node.elements.some((n) => n.optional || n.rest)) shapedBy.set(a, node);
      }
    });
  }

  // A call gives every parameter but the optional ones it leaves out, which come last.
  function arity(given: number, params: Param[], at: Span) {
    // A rest parameter's array is packed from what follows the others, when they are all given.
    if (params.at(-1)?.rest && given < params.length - 1) {
      const least = params.filter((p) => !p.optional && !p.rest).length;
      if (given < least) throw new CompileError(`expected at least ${least} argument${least === 1 ? "" : "s"}, but got ${given}`, at.start, at.end);
    }
    const required = params.filter((p) => !p.optional && !p.rest).length;
    if (given >= required && given <= params.length) return;
    const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
    throw new CompileError(`expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${given}`, at.start, at.end);
  }

  // A callback given as a declared function's name becomes the closure calling it. A local
  // function given by name isn't converted yet.
  function namedFunction(callback: Expr) {
    if (callback.kind !== "ident") return;
    const local = lookup(callback.name);
    const held = local && lower(local.type);
    if (held && typeof held !== "string" && (held.kind === "closure" || held.kind === "function" || isCallable(held) || (held.kind === "param" && held.bound?.kind === "function"))) {
      throw new CompileError(`a local function passed by name isn't supported yet; write an arrow calling it, as in '(x) => ${callback.name}(x)'`, callback.start, callback.end);
    }
    const declared = local ? undefined : byName.get(callback.name);
    if (declared && !declared.comptime) functionValue(callback, declared);
  }

  // A call through a generic function type, in a body checked before it knows the function: its
  // type parameters are inferred from the arguments, or written, and its signature resolved
  // with them.
  function familyCall(e: Call, type: FunctionType, name: string): { type: Type; what: string } {
    const { names, node, scope } = type.generic!;
    const written = node as Extract<TypeNode, { kind: "function" }>;
    if (e.args.length !== written.params.length) throw new CompileError(`expected ${written.params.length} argument${written.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    const argTypes = e.args.map((a) => value(a));
    const bindings = new Map<string, Type>();
    if (e.typeArgs.length > 0) {
      if (e.typeArgs.length !== names.length) throw new CompileError(`expected ${names.length} type argument${names.length === 1 ? "" : "s"}, but got ${e.typeArgs.length}`, e.start, e.end);
      names.forEach((n, i) => bindings.set(n, resolveType(e.typeArgs[i]!)));
    } else written.params.forEach((p, i) => p.type && infer(ctx.tables, p.type, argTypes[i]!, new Set(names), bindings, e.args[i]!));
    for (const [i, n] of names.entries()) {
      const bound = bindings.get(n);
      if (!bound) throw new CompileError(`can't infer a type for '${n}' in this call of ${name}; pass it, as in '${(e.callee as { name?: string }).name ?? "f"}<i64>(...)'`, e.start, e.end);
      const constraint = written.typeParams[i]!.constraint;
      if (constraint) {
        const limit = ctx.resolveWith(constraint, new Map([...scope, ...bindings]));
        const reason = typeof limit !== "string" && limit.kind === "interface" ? unsatisfied(bound, limit, members, e) : fits(bound, limit) ? undefined : `'${show(bound)}' is not a '${show(limit)}'`;
        if (reason) throw new CompileError(`type '${show(bound)}' does not satisfy the constraint '${show(limit)}' of '${n}' in ${name}: ${reason}`, e.start, e.end);
      }
    }
    e.args.forEach((a, i) => {
      const declared = ctx.resolveWith(written.params[i]!.type!, new Map([...scope, ...bindings]));
      // An optional parameter is an Option, as a call may leave it empty.
      const want = written.params[i]!.optional ? unionType([declared, "null"]) : declared;
      coerce(a, argTypes[i]!, want, `argument of type '${show(argTypes[i]!)}' is not assignable to parameter of type '${show(want)}'`);
    });
    return { type: ctx.resolveWith(written.returns, new Map([...scope, ...bindings])), what: name };
  }

  // A generic function value, or a generic arrow, rewritten as an arrow calling it with its
  // arguments: given a function type, its parameters take that type's, and the call inside
  // infers the generic function's types from them.
  function instanceArrow(e: Expr) {
    if (e.kind === "arrow" && e.typeParams.some((p) => !isLifetime(p))) ctx.liftArrow(e);
    if (e.kind !== "ident") return;
    const local = lookup(e.name);
    const held = local && lower(isRefType(local.type) ? local.type.to : local.type);
    const name = (local?.generic as Body | undefined)?.name ?? (typeof held !== "string" && held?.kind === "closure" ? held.generic : undefined) ?? (!local && byName.get(e.name)?.typeParams?.some((p) => !isLifetime(p)) ? e.name : undefined);
    const f = name === undefined ? undefined : byName.get(name);
    if (!f) return;
    const at = { start: e.start, end: e.end };
    const odd = f.params.find((p) => defaulted.has(p) || p.comptime || p.rest);
    if (odd) throw unsupported(odd.comptime ? "generic functions with comptime parameters used as values" : odd.rest ? "generic functions with rest parameters used as values" : "generic functions with defaulted parameters used as values", e);
    // Its parameters keep the names it declares, unless one would hide it.
    const names = f.params.map((p, i) => (p.pattern.kind === "ident" && p.pattern.name !== name ? p.pattern.name : `arg${i}`));
    const params: Param[] = names.map((n): Param => ({ ...at, id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: n, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false }));
    const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: name!, ...at }, typeArgs: [], args: names.map((n): Expr => ({ id: nextId(ids), kind: "ident", name: n, ...at })), optional: false, ...at };
    delete (e as { name?: string }).name;
    Object.assign(e, { kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call });
    madeArrows.add(e);
  }

  // The Dyn of an interface a value meeting `t` is boxed into: `t` itself, or the one in an
  // Option, as an optional field's.
  function boxedIn(t: Type): DynType | undefined {
    const dyn = (u: Type) => typeof u !== "string" && u.kind === "dyn" && !callableOf.has(u.of) && promiseElement(u.of) === undefined;
    if (dyn(t)) return t as DynType;
    if (typeof t !== "string" && t.kind === "union" && t.members.length === 2 && t.members.includes("null")) {
      const other = t.members.find((m) => m !== "null")!;
      return dyn(other) ? (other as DynType) : undefined;
    }
    return undefined;
  }

  // A generic function named as a value: its own type, each call of which instantiates it.
  function genericValue(f: Body, e: Expr): Type {
    if (f.foreign) throw unsupported(`${f.rust ? "Rust" : "C"} functions used as values`, e);
    return genericFunctionType(f.name, "a generic function");
  }

  // The generic function a generic function value names, when the callee is a local or a field
  // holding one; read for nothing else, it is called directly, in this instance.
  function genericTarget(callee: Expr, receiver: Type | undefined): Body | undefined {
    let held: Type | undefined;
    if (callee.kind === "ident") {
      const local = lookup(callee.name);
      if (!local) return undefined;
      held = local.type;
      locals.set(callee, local);
    } else if (callee.kind === "member" && pure(callee) && typeof receiver !== "string" && (receiver?.kind === "class" || receiver?.kind === "object")) {
      if (receiver.kind === "class" && inherited(classOf(receiver), "methods", callee.name)) return undefined;
      held = field(receiver, callee.name)?.type;
      // A getter on the way runs code the direct call would skip.
      const t = held && lower(isRefType(held) ? held.to : held);
      if (typeof t !== "string" && t?.kind === "closure" && t.generic && throughGetter(callee)) throw unsupported("calls of a generic function value read through a getter", callee);
    }
    if (held === undefined) return undefined;
    const t = lower(isRefType(held) ? held.to : held);
    return typeof t !== "string" && t.kind === "closure" && t.generic ? byName.get(t.generic) : undefined;
  }

  // A name or `this`, or fields read from one, which reading has no effect of its own unless a
  // getter is on the way.
  function pure(e: Expr): boolean {
    return e.kind === "ident" || e.kind === "this" || (e.kind === "member" && !e.optional && pure(e.object));
  }

  function throughGetter(e: Expr): boolean {
    if (e.kind !== "member") return false;
    const object = types.get(e.object);
    const held = object && lower(isRefType(object) ? object.to : object);
    const getter = typeof held !== "string" && held?.kind === "class" && inherited(classOf(held), "getters", e.name) !== undefined;
    return getter || throughGetter(e.object);
  }

  // `double` named where a value is wanted becomes `(x) => double(x)`, its parameters and their
  // types its declaration's, capturing nothing, so it passes, stores and boxes as any closure.
  function functionValue(e: Extract<Expr, { kind: "ident" }>, f: Body) {
    const written = e.name;
    const name = `'${written}'`;
    // A generic one given as a callback is the instance the callback's types make.
    if (f.typeParams?.some((p) => !isLifetime(p))) return instanceArrow(e);
    if (f.foreign) throw unsupported(`${f.rust ? "Rust" : "C"} functions used as values`, e);
    // A package's function Fish couldn't type is refused where it is used as a value too.
    const refused = f.js ? jsUncalled.get(f) : undefined;
    if (refused) {
      refused.note ??= { message: `'${f.js!.name}' is used here`, start: e.start, end: e.end };
      throw refused;
    }
    if (f.throws) throw unsupported("functions that throw used as values", e);
    const odd = f.params.find((p) => defaulted.has(p) || p.comptime || p.rest);
    if (odd) throw unsupported(odd.comptime ? "functions with comptime parameters used as values" : odd.rest ? "functions with rest parameters used as values" : "functions with defaulted parameters used as values", e);
    // Typed where it is declared, so a type name means what it means there.
    // A function it takes is a stored callable, as a function type's parameters are.
    const types = paramTypes(instanceOf(f)).map((t) => {
      const fn = typeof t !== "string" && t.kind === "param" && t.bound?.kind === "function" ? t.bound : t;
      return typeof fn !== "string" && fn.kind === "function" && !fn.generic ? storedType(fn) : t;
    });
    if (types.some((t) => typeof t !== "string" && (t.kind === "function" || t.kind === "closure" || (t.kind === "param" && t.bound?.kind === "function")))) throw unsupported("functions taking functions used as values", e);
    const at = { start: e.start, end: e.end };
    // A parameter keeps its name unless it would hide the function, or has none of its own.
    const names = f.params.map((p, i) => (p.pattern.kind === "ident" && p.pattern.name !== written && p.pattern.name !== f.name ? p.pattern.name : `${written}-arg${i}`));
    const clones = types.map((t) => !isCopy(t));
    const params: Param[] = f.params.map((p, i): Param => ({ ...at, id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: names[i]!, ...at }, type: undefined, optional: p.optional, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false }));
    params.forEach((p, i) => {
      presetParams.set(p, types[i]!);
      namedParams.set(p, { fn: written, names, clones });
    });
    const args: Expr[] = names.map((n): Expr => ({ id: nextId(ids), kind: "ident", name: n, ...at }));
    const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: written, ...at }, typeArgs: [], args, optional: false, ...at };
    delete (e as { name?: string }).name;
    Object.assign(e, { kind: "arrow", move: false, async: false, typeParams: [], params, returnType: undefined, body: call });
    madeArrows.add(e);
  }

  // The nested function a name calls, unless it is async, whose future holds what it uses. A
  // closure owning what it captures, async or `move`, takes the function as made where it is.
  function nestedFunction(name: string): Local | undefined {
    if (ctx.owning) return undefined;
    const local = ctx.peek(name);
    return local && ctx.nestedLocal(local) ? local : undefined;
  }

  // `name(...)` on a nested function builds its environment for the call from this body's
  // bindings for what it captures, so a closure calling it captures those, not the function,
  // and changes what the function changes.
  function nestedCall(e: Call, callee: Extract<Expr, { kind: "ident" }>, local: Local): { type: Type; what: string } {
    nestedEnv(e, local, callee);
    return closureCall(e, callee, local.type);
  }

  // Records this body's bindings for what a nested function captures, captured if need be,
  // each changing where the function changes it.
  function nestedEnv(e: Expr, local: Local, at: Extract<Expr, { kind: "ident" }>) {
    const called = closureBody(lower(local.type) as ClosureType);
    ctx.envOf(e, called, [...called.captures!.entries()].map(([alias, from]) => {
      // A closure captures it here, where the variable is named only through the function.
      const mine = ctx.reach(from as Local, { id: nextId(ids), kind: "ident", name: (from as Local).name, start: at.start, end: at.end });
      if (called.changed?.has(alias)) changesLocal(mine, "", "change", at, false);
      return mine;
    }));
  }

  // A call of a closure held by a variable runs the closure's body.
  function closureCall(e: Call, callee: Expr, known?: Type): { type: Type; what: string } {
    const held = known ?? value(callee);
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this function";
    const through = lower(isRefType(held) ? held.to : held);
    // A generic function value reached here isn't a name or a field, which `callee` calls.
    if (typeof through !== "string" && through.kind === "closure" && through.generic) throw unsupported("calls of a generic function value that isn't a name or a field", callee);
    if (isCallable(through)) return callableCall(e, callee, through as DynType);
    // A parameter of a function type calls it through its signature; its instance, the
    // closure it was given.
    const type = typeof held !== "string" && held.kind === "param" && held.bound?.kind === "function" ? held.bound : held;
    if (typeof type === "string" || (type.kind !== "closure" && type.kind !== "function")) {
      throw new CompileError(`this expression is not callable: type '${show(type)}' has no call signatures`, callee.start, callee.end);
    }
    if (type.kind === "function" && type.generic) return familyCall(e, type, name);
    if (e.typeArgs.length > 0) throw new CompileError(`${name} takes no type arguments`, e.start, e.end);
    const written = type.kind === "closure" ? closureBody(type).body.params : undefined;
    if (written) arity(e.args.length, written, e);
    else if (e.args.length !== type.params.length) {
      throw new CompileError(`expected ${type.params.length} argument${type.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      if (a.kind !== "arrow" || isCallable(type.params[i]!)) expect(a, type.params[i]!);
      const t = value(a);
      const shown = (written?.[i] && defaultedArg(a, t, written[i]!)) ?? type.params[i]!;
      coerce(a, t, type.params[i]!, `argument of type '${show(t)}' is not assignable to parameter of type '${show(shown)}'`);
    });
    const given = lower(held);
    if (typeof given !== "string" && given.kind === "closure") calls.set(e, closureBody(given));
    // The closure it runs throws what it throws, which its function type may only widen.
    const error = typeof given !== "string" && given.kind === "closure" ? given.throws : type.throws;
    if (error) raise(e, error, name);
    // Where the signature says `Promise<T>`, the call gives the future of the closure it was given.
    const returns = typeof given !== "string" && given.kind === "closure" && promiseElement(type.returns) !== undefined ? given.returns : type.returns;
    // An async arrow's future holds a copy of what it captured, references too.
    if (typeof returns !== "string" && returns.kind === "future" && holdsRef(returns)) borrowsFrom.set(e, [callee]);
    return { type: returns, what: name };
  }

  // `String.fromCharCode(...units)` and `String.fromCodePoint(...points)`: the arguments, spreads
  // of arrays among them, become one array of `u16` or `u32`.
  function stringStatic(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const kinds: Record<string, ["units" | "points", Type]> = { fromCharCode: ["units", "u16"], fromCodePoint: ["points", "u32"] };
    const kind = kinds[callee.name];
    if (!kind) throw new CompileError(`'String' has no '${callee.name}' yet; it has 'fromCharCode' and 'fromCodePoint'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError(`'String.${callee.name}' takes no type arguments`, e.start, e.end);
    const at = { start: e.args[0]?.start ?? e.end, end: e.args.at(-1)?.end ?? e.end };
    const gathered: Expr = e.args.length === 1 && stringBuilds.has(e) ? e.args[0]! : { id: nextId(ids), kind: "array", elements: e.args, ...at };
    const many = arrayType(kind[1]);
    expect(gathered, many);
    const t = value(gathered);
    coerce(gathered, t, many, `'String.${callee.name}' takes ${kind[1]} values, and these are '${show(t)}'`);
    e.args = [gathered];
    stringBuilds.set(e, kind[0]);
    return { type: "string", what: `'String.${callee.name}'` };
  }

  // A call of one of a string's methods, which takes its arguments as the method's parameters.
  function stringCall(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    text(callee.object, receiver, linked(callee));
    // A method that may take a regex looks at its first argument to see which it was given.
    const first = REGEX_METHODS.has(callee.name) && e.args[0] ? value(e.args[0]) : undefined;
    const rx = first === undefined ? undefined : asRegex(first);
    if (rx) return regexStringCall(e, callee, rx, lower(first!) !== rx);
    if (first !== undefined && !stringMethods(typing)[callee.name]) throw new CompileError(`'${callee.name}' takes a regex, like '${callee.name}(/x/${callee.name === "matchAll" ? "g" : ""})'; Fish doesn't turn a string into one`, e.args[0]!.start, e.args[0]!.end);
    // `concat` takes any number of strings, as `+` joins them.
    if (callee.name === "concat") {
      for (const a of e.args) {
        if (a.kind === "spread") throw new CompileError("a spread into 'concat' isn't supported yet; join the array instead, as in 's + parts.join(\"\")'", a.start, a.end);
        const t = value(a);
        if (!stringLike(lower(t))) throw new CompileError(`'concat' takes strings, and this is '${show(t)}'; convert it with 'String(x)'`, a.start, a.end);
        coerce(a, t, "string", "");
      }
      return { type: "string", what: "'concat'" };
    }
    const method = stringMethods(typing)[callee.name];
    if (!method) throw new CompileError(`strings have no method '${callee.name}' yet${didYouMean(callee.name, Object.keys(stringMethods(typing)))}`, callee.start, callee.end);
    const [params, returns, required] = method;
    if (e.args.length < required || e.args.length > params.length) {
      const count = required === params.length ? `${required}` : `${required} or ${params.length}`;
      throw new CompileError(`'${callee.name}' takes ${count} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const t = i === 0 && first !== undefined ? first : value(a);
      coerce(a, t, params[i]!, `argument of type '${show(t)}' is not assignable to parameter of type '${show(params[i]!)}'`);
    });
    return { type: returns, what: `'${callee.name}'` };
  }

  // A string method taking a regex: `g` decides whether \`replace\`, \`match\` and \`split\` use
  // every match or the first, and \`matchAll\` and \`replaceAll\` need it, as JavaScript requires.
  function regexStringCall(e: Call, callee: Extract<Expr, { kind: "member" }>, rx: RegexType, generic: boolean): { type: Type; what: string } {
    const name = callee.name;
    const what = `'${name}'`;
    const global = rx.flags.includes("g");
    const typed = !rx.any || generic;
    const unknown = () => new CompileError(`${what} types its matches from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    if (e.optional || callee.optional) throw new CompileError(`${what} with a regex is called without '?.'`, e.start, e.end);
    const most = name === "search" || name === "match" || name === "matchAll" ? 1 : 2;
    if (e.args.length > most || (name.startsWith("replace") && e.args.length < 2)) {
      throw new CompileError(name.startsWith("replace") ? `${what} takes a regex and what replaces each match: a string, or an arrow function` : name === "split" ? "'split' takes a regex and an optional limit" : `${what} takes one regex`, e.start, e.end);
    }
    // What these give, or whether they may run, depends on the flags, which a 'RegExp' kept here
    // doesn't show.
    if (!typed && (name === "match" || name === "matchAll" || name === "replaceAll")) throw unknown();
    if ((name === "matchAll" || name === "replaceAll") && !global) throw new CompileError(`${what} needs a regex with the 'g' flag, as JavaScript requires`, e.args[0]!.start, e.args[0]!.end);
    if (name === "matchAll" && !typed) throw unknown();
    if (name === "split" && e.args[1]) {
      const limit = e.args[1];
      const t = value(limit);
      if (t !== "i64" && t !== "usize" && !adapt(limit, "i64")) throw new CompileError(`a limit is an 'i64', not '${show(t)}'`, limit.start, limit.end);
    }
    if (name.startsWith("replace")) replacement(e, rx, typed, unknown);
    regexStringCalls.set(e, name);
    return { type: regexStringType(typing, name, rx, !typed), what };
  }

  // What replaces each match: a string with $ patterns, or an arrow function given the match,
  // each capture, the offset, the string and, when the pattern names them, the groups.
  function replacement(e: Call, rx: RegexType, typed: boolean, unknown: () => CompileError): Type {
    const given = e.args[1]!;
    if (given.kind !== "arrow") {
      const t = read(given);
      if (!stringLike(t)) throw new CompileError(`what replaces each match is a string or an arrow function, not '${show(t)}'`, given.start, given.end);
      // With named groups, $<name> must name one, as JavaScript's early check would if it had one.
      const names = new Set(rx.captures.flatMap((c) => (c.name === undefined ? [] : [c.name])));
      const missing = given.kind === "string" && names.size > 0 ? [...given.value.matchAll(/\$\$|\$<([^>]*)>/g)].find((m) => m[1] !== undefined && !names.has(m[1])) : undefined;
      if (missing) throw new CompileError(`the regex has no group named '${missing[1]}' for '${missing[0]}'`, given.start, given.end);
      if (t !== "string") coerce(given, t, "string", "");
      return "string";
    }
    if (!typed) throw unknown();
    const match = matchType(rx);
    const groups = field(match, "groups")?.type;
    const params: Type[] = ["string", ...elementsOf(match).slice(1), "i64", "string", ...(groups ? [refType(groups, false)] : [])];
    const names = ["match", ...rx.captures.map((_, i) => `p${i + 1}`), "offset", "string", ...(groups ? ["groups"] : [])];
    if (given.params.length > params.length) throw new CompileError(`the replacing function is given ${names.join(", ")}`, given.params[params.length]!.start, given.params[params.length]!.end);
    expect(given, functionType(names, params, "string"));
    const c = value(given);
    if (typeof c === "string" || c.kind !== "closure") throw new CompileError("what replaces each match is a string or an arrow function", given.start, given.end);
    runsOften(c, "replace", "its function once per match", given);
    c.params.forEach((p, i) => passedExactly("replace", params[i]!, p, given.params[i], given.params[i] ?? given));
    if (!fits(c.returns, "string")) throw new CompileError(`the replacing function gives the string each match becomes, not '${show(c.returns)}'`, given.start, given.end);
    return "string";
  }

  // An array's method: `push` moves a value in at the end; `pop` takes the last one out, or
  // gives an empty Option. Both change the array.
  function arrayCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    if (!ARRAY_METHODS.has(callee.name)) throw new CompileError(`arrays have no method '${callee.name}' yet${didYouMean(callee.name, ARRAY_METHODS)}`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling array methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError(`'${callee.name}' takes no type arguments`, e.start, e.end);
    // Methods giving clones of the elements refuse elements that can't be cloned.
    if (["at", "find", "filter", "slice", "concat", "fill", "entries", "values"].includes(callee.name) || (callee.name === "reduce" && e.args.length === 1)) clonable(array.element, callee, callee.name);
    if (callee.name === "flat" && isArray(lower(array.element))) clonable((lower(array.element) as ArrayType).element, callee, "flat");
    // `entries()`, `keys()` and `values()` call the prelude's generators, which borrow the array
    // while they live and give `[i, element]` pairs, indexes and elements, each element a clone.
    if (Object.hasOwn(ITERATORS, callee.name)) {
      if (e.args.length > 0) throw new CompileError(`'${callee.name}' takes no arguments`, e.start, e.end);
      Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: ITERATORS[callee.name], start: callee.start, end: callee.end }, args: [callee.object], typeArgs: [] });
      return call(e);
    }
    // `toBase64(options?)` and `toHex()` on bytes call the prelude's encoders, which borrow them.
    if (Object.hasOwn(BYTE_METHODS, callee.name)) {
      if (lower(array.element) !== "u8") throw new CompileError(`'${callee.name}' encodes bytes, a 'u8[]', not '${show(array)}'`, callee.start, callee.end);
      const most = callee.name === "toBase64" ? 1 : 0;
      if (e.args.length > most) throw new CompileError(most === 0 ? `'${callee.name}' takes no arguments` : "'toBase64' takes an optional options object, as in '{ alphabet: \"base64url\", omitPadding: true }'", e.start, e.end);
      Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: BYTE_METHODS[callee.name], start: callee.start, end: callee.end }, args: [callee.object, ...e.args], typeArgs: [] });
      return call(e);
    }
    if (readCopy(callee.object) && ["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "reserve", "shrinkToFit"].includes(callee.name)) {
      throw new CompileError(`'${callee.name}' changes its array, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
    }
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, array);
    if (CALLBACK_METHODS.has(callee.name)) return callbackCall(e, callee, array);
    if (READING_METHODS.has(callee.name)) return readingCall(e, callee, array);
    if (callee.name === "sort") return sortCall(e, callee, array);
    // `at(i)`: a clone of the element at a position counted from either end, or nothing.
    if (callee.name === "at") {
      if (e.args.length !== 1) throw new CompileError("'at' takes a position, like 'at(-1)' for the last element", e.start, e.end);
      const i = e.args[0]!;
      expect(i, "i64");
      const t = value(i);
      coerce(i, t, "i64", `argument of type '${show(t)}' is not assignable to parameter of type 'i64'`);
      return { type: unionType([array.element, "null"]), what: "'at'" };
    }
    if (CHANGING_METHODS.has(callee.name)) return changingCall(e, callee, array);
    const count = callee.name === "push" ? 1 : 0;
    if (e.args.length !== count) throw new CompileError(`'${callee.name}' takes ${count === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    if (!place(callee.object)) throw new CompileError(`'${callee.name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    changeable(callee.object, callee.name === "push" ? "push to" : "pop from");
    if (callee.name === "pop") return { type: unionType([array.element, "null"]), what: "'pop'" };
    expect(e.args[0]!, array.element);
    const t = value(e.args[0]!);
    coerce(e.args[0]!, t, array.element, `argument of type '${show(t)}' is not assignable to parameter of type '${show(array.element)}'`);
    return { type: "void", what: "'push'" };
  }

  // `map`, `filter`, `find`, `some`, `every` and `reduce` run the callback on each element in
  // turn, given it as a shared borrow, or a copy when it copies, and its index. `filter` and
  // `find` give clones of what they keep, and `reduce` without an initial value starts from a
  // clone of the first element.
  function callbackCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    const reducing = name === "reduce";
    if (reducing ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      throw new CompileError(`'${name}' takes ${reducing ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'"}`, e.start, e.end);
    }
    const [callback, init] = e.args as [Expr, Expr | undefined];
    namedFunction(callback);
    if (callback.kind !== "arrow") throw new CompileError(`'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const element = isCopy(array.element) ? array.element : refType(array.element, false);
    const acc = !reducing ? undefined : init ? widenLet(value(init)) : array.element;
    const params = acc ? [acc, element, "i64" as const] : [element, "i64" as const];
    if (callback.params.length > params.length) {
      throw new CompileError(`'${name}' passes its callback ${acc ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    const signature = functionType(acc ? ["accumulator", "value", "index"] : ["value", "index"], params, "void");
    expect(callback, signature);
    const c = value(callback);
    if (typeof c === "string" || c.kind !== "closure") throw new CompileError(`'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    if (c.params.length > params.length) {
      throw new CompileError(`'${name}' passes its callback ${acc ? "the accumulator, " : ""}the element and its index; JavaScript's last argument, the array, isn't passed, since the array is already borrowed`, callback.start, callback.end);
    }
    runsOften(c, name, "its callback once per element", callback);
    c.params.forEach((p, i) => {
      const at = callback.params[i] ?? callback;
      passedExactly(name, params[i]!, p, callback.params[i], at, i !== params.length - 1);
    });
    const gives = c.returns;
    if (holdsFuture(gives)) throw new CompileError(`'${name}' with a callback giving a Promise isn't supported yet; await each value in a 'for...of' loop instead`, callback.start, callback.end);
    if (PREDICATES.has(name) && gives !== "boolean") {
      throw new CompileError(`'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${show(gives)}'`, callback.start, callback.end);
    }
    if (acc && !fits(gives, acc)) throw new CompileError(`'reduce''s callback gives the next accumulator, a '${show(acc)}', but this one gives '${show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || holdsRef(gives))) throw new CompileError(`'map''s callback has to give a value to keep, not '${show(gives)}'`, callback.start, callback.end);
    const many = lower(gives);
    if (name === "flatMap" && (typeof many === "string" || many.kind !== "array")) {
      throw new CompileError(`'flatMap''s callback gives an array for each element, whose elements make up the result; this one gives '${show(gives)}'`, callback.start, callback.end);
    }
    const type = name === "map" ? arrayType(gives) : name === "flatMap" ? many : name === "filter" ? array : name === "find" ? unionType([array.element, "null"])
      : name === "findIndex" ? "i64" : name === "forEach" ? "void" : acc ?? "boolean";
    return { type, what: `'${name}'` };
  }

  // `sort()` orders numbers numerically and strings by UTF-16 code units; `sort(compare)` by
  // the sign of what the comparator gives for two elements. Stable, and in place, so it gives
  // nothing.
  function sortCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    if (e.args.length > 1) throw new CompileError("'sort' takes an optional comparator like '(a, b) => a - b'", e.start, e.end);
    if (!place(callee.object)) throw new CompileError("'sort' sorts its array in place, so call it on a variable or a field", callee.start, callee.end);
    changeable(callee.object, "sort");
    const what = "'sort', which sorts its array in place,";
    const compare = e.args[0];
    if (!compare) {
      const element = lower(array.element);
      if (!isNumeric(element) && element !== "string") {
        throw new CompileError(`'sort()' without a comparator orders numbers and strings, not '${show(array.element)}'; give a comparator like '(a, b) => a.n - b.n'`, callee.start, callee.end);
      }
      return { type: "void", what };
    }
    namedFunction(compare);
    if (compare.kind !== "arrow") throw new CompileError("'sort' takes a comparator written in place, like '(a, b) => a - b', or a function by name", compare.start, compare.end);
    if (compare.params.length > 2) throw new CompileError("'sort' passes its comparator two elements", compare.params[2]!.start, compare.params[2]!.end);
    const element = isCopy(array.element) ? array.element : refType(array.element, false);
    expect(compare, functionType(["a", "b"], [element, element], "void"));
    const c = value(compare);
    if (typeof c === "string" || c.kind !== "closure") throw new CompileError("'sort' takes a comparator like '(a, b) => a - b'", compare.start, compare.end);
    runsOften(c, "sort", "its comparator many times", compare);
    c.params.forEach((p, i) => {
      passedExactly("sort", element, p, compare.params[i], compare);
    });
    const order = lower(c.returns);
    if (isInteger(order) && !INTEGERS[order].signed) {
      throw new CompileError(`a comparator's number has to be able to be negative, and '${show(c.returns)}' can't; convert with 'as i64', or compare: 'a < b ? -1 : a > b ? 1 : 0'`, compare.start, compare.end);
    }
    if (!isNumeric(order)) {
      throw new CompileError(`a comparator gives a number: negative when 'a' comes first, positive when 'b' does, zero to keep their order; this one gives '${show(c.returns)}'`, compare.start, compare.end);
    }
    return { type: "void", what };
  }

  // `shift` moves the first element out; `unshift` moves values in at the front; `splice`
  // moves a run out and values in where it was; `reverse` and `fill` change the array in place.
  // What they give, JavaScript's new length for `unshift` and the array itself for `reverse`
  // and `fill`, they don't.
  function changingCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (!place(callee.object)) throw new CompileError(`'${name}' changes its array, so call it on a variable or a field`, callee.start, callee.end);
    changeable(callee.object, name);
    const element = (a: Expr) => {
      expect(a, array.element);
      const t = value(a);
      coerce(a, t, array.element, `argument of type '${show(t)}' is not assignable to parameter of type '${show(array.element)}'`);
    };
    const position = (a: Expr) => {
      expect(a, "i64");
      const t = value(a);
      coerce(a, t, "i64", `argument of type '${show(t)}' is not assignable to parameter of type 'i64'`);
    };
    const counts: Record<string, [number, number, string]> = {
      shift: [0, 0, "no arguments"], reverse: [0, 0, "no arguments"], unshift: [0, Infinity, "the values to put at the front"],
      splice: [1, Infinity, "a start, an optional count to remove and the values to put in their place"], fill: [1, 3, "a value and an optional start and end"],
      reserve: [1, 1, "a count of elements to make room for"], shrinkToFit: [0, 0, "no arguments"],
    };
    const [least, most, takes] = counts[name]!;
    if (e.args.length < least || e.args.length > most) throw new CompileError(`'${name}' takes ${takes}`, e.start, e.end);
    if (name === "unshift") e.args.forEach(element);
    if (name === "splice") e.args.forEach((a, i) => (i < 2 ? position(a) : element(a)));
    if (name === "fill") e.args.forEach((a, i) => (i === 0 ? element(a) : position(a)));
    if (name === "reserve") position(e.args[0]!);
    const what = `'${name}', which changes its array in place,`;
    if (name === "shift") return { type: unionType([array.element, "null"]), what: "'shift'" };
    if (name === "splice") return { type: array, what: "'splice'" };
    return { type: "void", what };
  }

  // `[a, b]` written where a tuple is expected: each element checked against its own type, then
  // the literal becomes the object of fields `0`, `1` and on that the tuple is laid out as.
  function tupleLiteral(e: Expr, tuple: ObjectType): Type {
    const elements = elementsOf(tuple);
    // Once a literal became an object, its rest elements are its field `...`, checked again.
    const parts = tupleParts(e) as Expr[];
    const given = tuple.rest !== undefined && e.kind === "object" ? parts.slice(0, -1) : [...parts];
    const least = tuple.required ?? elements.length;
    const fixed = given.slice(0, elements.length);
    const spread = fixed.find((x) => x.kind === "spread");
    if (spread) throw unsupported("spread elements in tuple literals", spread);
    if (given.length < least || (given.length > elements.length && tuple.rest === undefined)) {
      const count = tuple.rest !== undefined ? `at least ${least}` : least === elements.length ? `${least}` : `${least} to ${elements.length}`;
      throw new CompileError(`type '${show(tuple)}' has ${count} element${elements.length === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
    }
    // Optional elements left out are empty.
    for (let i = fixed.length; i < elements.length; i++) fixed.push({ id: nextId(ids), kind: "null", start: e.end, end: e.end } as Expr);
    fixed.forEach((x, i) => {
      const t = value(x);
      coerce(x, t, elements[i]!, `type '${show(t)}' is not assignable to type '${show(elements[i]!)}'`);
    });
    // A rest tuple's further elements are an array literal of its rest type, spreads allowed.
    const many: Expr[] = [];
    if (tuple.rest !== undefined) {
      const rest = arrayType(tuple.rest);
      const extra: Expr = e.kind === "object" ? parts.at(-1)! : { id: nextId(ids), kind: "array", elements: given.slice(elements.length), start: e.start, end: e.end };
      expect(extra, rest);
      const t = value(extra);
      coerce(extra, t, rest, `type '${show(t)}' is not assignable to type '${show(rest)}'`);
      many.push(extra);
    }
    if (e.kind === "array") {
      Object.assign(e, { kind: "object", props: [...fixed, ...many].map((value, i) => ({ id: nextId(ids), kind: "property", key: i < elements.length ? String(i) : "...", value, start: value.start, end: value.end })) });
      delete (e as { elements?: unknown }).elements;
      tupleLiterals.add(e);
    }
    return tuple;
  }

  // The tuple a literal of these parts' types is where a generic function takes one: its parts in
  // order, or in the shape its parameter writes, an optional element left out being empty and the
  // parts past the fixed ones its rest.
  function shapedTuple(e: Expr, parts: Type[]): ObjectType {
    const node = shapedBy.get(e);
    if (!node) return tupleType(parts);
    // Checked once already, the literal's last part is its rest's array.
    const again = e.kind === "object" && node.elements.some((n) => n.rest);
    const given = again ? parts.slice(0, -1) : parts;
    const fixed = node.elements.filter((n) => !n.rest);
    const required = fixed.findIndex((n) => n.optional);
    const elements = fixed.map((n, i): Type => (i >= given.length ? "null" : n.optional ? unionType([given[i]!, "null"]) : given[i]!));
    if (!node.elements.some((n) => n.rest)) return given.length > fixed.length ? tupleType(given) : tupleType(elements, required < 0 ? undefined : required);
    // No parts past the fixed ones say nothing about the rest, as an empty array literal doesn't.
    const extra = given.slice(fixed.length);
    const rest = again ? (parts.at(-1) as ArrayType).element : extra.length === 0 ? "never" : unionType(extra);
    return tupleType(elements, undefined, rest);
  }

  // `t[0]` on a tuple reads its field `0`: the index is a number written in place naming one of
  // its elements, and the expression becomes that field's read.
  function untuple(e: Expr): boolean {
    if (e.kind !== "index") return false;
    // Named as the object of an index, as the index's own check would name it.
    if (e.object.kind === "ident") objects.add(e.object);
    const through = value(e.object);
    // Whatever reads the object next, the index's check or the field's, takes this type, so a
    // chain of indexes is checked once, not once per level and again for each.
    once.add(e.object);
    const held = isRefType(through) ? through.to : through;
    const object = typeof held !== "string" && held.kind === "shared" ? lower(held.of) : held;
    if (!isTuple(object)) return false;
    const count = elementsOf(object as ObjectType).length;
    if (e.index.kind !== "int") throw new CompileError(`a tuple's element is named by a number written in place, like '[0]'; '${show(object)}' has no element for a computed index`, e.index.start, e.index.end);
    const n = e.index.value;
    // Past a rest tuple's fixed elements, an index reads its array, panicking past the end.
    if (n >= BigInt(count) && (object as ObjectType).rest !== undefined) {
      const at = { start: e.index.start, end: e.index.end };
      const array: Expr = { id: nextId(ids), kind: "member", object: e.object, name: "...", optional: false, start: e.object.start, end: e.object.end };
      restStarts.set(array, count);
      Object.assign(e, { object: array, index: { id: nextId(ids), kind: "int", value: n - BigInt(count), ...at } });
      return false;
    }
    if (n >= BigInt(count)) throw new CompileError(`tuple type '${show(object)}' of length ${count} has no element at index ${n}`, e.index.start, e.index.end);
    if (e.optional) throw unsupported("optional index expressions", e);
    Object.assign(e, { kind: "member", name: String(n), optional: false });
    delete (e as { index?: unknown }).index;
    return true;
  }

  // A tuple literal's elements, as written or once it became an object.
  function tupleParts(e: Expr): (Expr | undefined)[] {
    if (e.kind === "array") return e.elements;
    return e.kind === "object" ? e.props.map((p) => (p.kind === "property" ? p.value : undefined)) : [];
  }

  // `FixedArray.filled<T, N>(v)`: N copies of `v`, its type written or the one expected.
  function filled(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name !== "filled") throw new CompileError(`'FixedArray' has no '${callee.name}'; make one with 'FixedArray.filled<T, N>(value)' or a literal`, callee.start, callee.end);
    const written = e.typeArgs.length > 0 ? resolveType({ id: nextId(ids), kind: "ref", name: "FixedArray", args: e.typeArgs, start: e.start, end: e.end }) : wanted.get(e);
    if (!written || !isFixed(written)) throw new CompileError("say which fixed array to fill, as in 'FixedArray.filled<i64, 4>(0)'", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("'FixedArray.filled' takes the value to fill it with", e.start, e.end);
    clonable(written.element, e, "FixedArray.filled");
    const v = e.args[0]!;
    expect(v, written.element);
    const t = value(v);
    coerce(v, t, written.element, `argument of type '${show(t)}' is not assignable to parameter of type '${show(written.element)}'`);
    // Each instance's own type, as a generic body's differ, and a statement keeps it too.
    fixedFills.add(e);
    types.set(e, written);
    return { type: written, what: "'FixedArray.filled'" };
  }

  // `Array.of(a, b)` is the array literal `[a, b]`; `Array.from(x, f?)` is the array of what x
  // holds, clones of an array's elements, a string's code points or a generator's values, or of
  // `0` to `n - 1` from `{ length: n }`, mapped by f when there is one.
  // `x.toFixed(digits)` prints a number with that many digits after the point, as JavaScript does.
  function toFixed(e: Call): { type: Type; what: string } {
    if (e.args.length > 1) throw new CompileError("'toFixed' takes how many digits to print after the point, 0 when not given", e.start, e.end);
    const digits = e.args[0];
    const receiver = (e.callee as Extract<Expr, { kind: "member" }>).object;
    loaded(receiver, types.get(receiver)!);
    fixedPrints.add(e);
    if (!digits) return { type: "string", what: "'toFixed'" };
    const t = value(digits);
    if (t !== "i64" && !adapt(digits, "i64")) throw new CompileError(`'toFixed' takes its digits as an 'i64', not '${show(t)}'`, digits.start, digits.end);
    return { type: "string", what: "'toFixed'" };
  }

  // `x.checkedAdd(y)` and its kin: the other operand is x's type, or a `u32` for a shift or a
  // power; checked gives an Option, overflowing a tuple with whether it overflowed.
  function integerCall(e: Call, callee: Extract<Expr, { kind: "member" }>, type: Integer): { type: Type; what: string } {
    const [family, operation] = integerMethod(callee.name)!;
    const what = `'${callee.name}'`;
    if (callee.optional || linked(callee)) throw new CompileError(`${what} can't be called through an optional chain yet; check for null first`, callee.start, callee.end);
    if (operation === "Neg" && family === "saturating" && !INTEGERS[type].signed) throw new CompileError(`'${show(type)}' has no method ${what}: an unsigned number is never negated past its range; use 'checkedNeg' or 'wrappingNeg'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError(`${what} takes no type argument`, e.start, e.end);
    loaded(callee.object, types.get(callee.object)!);
    const other: Integer = ["Shl", "Shr", "Pow"].includes(operation) ? "u32" : type;
    const arity = operation === "Neg" ? 0 : 1;
    if (e.args.length !== arity) throw new CompileError(arity === 0 ? `${what} takes no argument` : `${what} takes one '${show(other)}'`, e.start, e.end);
    for (const a of e.args) {
      const t = read(a);
      if (t !== other && !adapt(a, other)) throw new CompileError(`${what} on '${show(type)}' takes a '${show(other)}', not '${show(t)}'; convert it with 'as', as in 'n as ${show(other)}'`, a.start, a.end);
    }
    integerCalls.add(e);
    const result = family === "checked" ? unionType([type, "null"]) : family === "overflowing" ? tupleType([type, "boolean"]) : type;
    return { type: result, what };
  }

  // The global `parseInt`, `parseFloat`, `Number` and `Number.parse...` a call makes, unless a
  // name of the program's hides it.
  function parserOf(callee: Expr): "parseInt" | "parseFloat" | "Number" | undefined {
    const global = (name: string) => !lookup(name) && !classes.has(name) && !byName.has(name) && !byName.has(`const ${name}`) && !enums.has(name);
    if (callee.kind === "ident" && (callee.name === "parseInt" || callee.name === "parseFloat" || callee.name === "Number") && global(callee.name)) return callee.name;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Number" && global("Number") && (callee.name === "parseInt" || callee.name === "parseFloat")) return callee.name;
    return undefined;
  }

  // Parsing a number gives an Option where JavaScript would give NaN.
  function parse(e: Call, name: "parseInt" | "parseFloat" | "Number"): { type: Type; what: string } {
    const what = `'${name}'`;
    const most = name === "parseInt" ? 2 : 1;
    if (e.typeArgs.length > 0) throw new CompileError(`${what} takes no type argument`, e.start, e.end);
    if (e.args.length < 1 || e.args.length > most) throw new CompileError(name === "parseInt" ? "'parseInt' takes a string and an optional radix" : `${what} takes one string`, e.start, e.end);
    const t = read(e.args[0]!);
    if (!stringLike(t)) {
      const hint = name === "Number" && isNumeric(t) ? "; to convert a number, write 'x as f64'" : "";
      throw new CompileError(`${what} parses a string, not '${show(t)}'${hint}`, e.args[0]!.start, e.args[0]!.end);
    }
    if (t !== "string") coerce(e.args[0]!, t, "string", "");
    const radix = e.args[1];
    if (radix) {
      const r = value(radix);
      if (r !== "i64" && !adapt(radix, "i64")) throw new CompileError(`a radix is an 'i64', not '${show(r)}'`, radix.start, radix.end);
    }
    parses.set(e, name);
    return { type: unionType([name === "parseInt" ? "i64" : "f64", "null"]), what };
  }

  // `assert(cond, message?)`, checked here so its panic can name the call's place.
  function assertion(e: Call): { type: Type; what: string } {
    if (e.typeArgs.length > 0 || e.args.length < 1 || e.args.length > 2) throw new CompileError("'assert' takes a condition and an optional message, as in 'assert(n > 0, \"n is positive\")'", e.start, e.end);
    condition(e.args[0]!);
    const message = e.args[1];
    if (message) {
      const t = read(message);
      if (!stringLike(t)) throw new CompileError(`an assertion's message is a string, not '${show(t)}'`, message.start, message.end);
      if (t !== "string") coerce(message, t, "string", "");
    }
    asserts.set(e, textAt(files, e.args[0]!));
    return { type: "void", what: "'assert'" };
  }

  // A regex's pattern, parsed and compiled here so its errors come while compiling.
  function regexLiteral(source: string, flags: string, at: Span, shown: string = source): RegexType {
    try {
      const pattern = parsePattern(source, flags, regex);
      compileRegex(pattern, regex);
      return regexType(source, flags, pattern.captures, shown);
    } catch (err) {
      if (err instanceof RegexSyntaxError) throw new CompileError(err.message, at.start, at.end);
      throw err;
    }
  }

  // `new RegExp(pattern, flags?)` with both known while compiling is a regex like a literal's.
  function regexNew(e: Extract<Expr, { kind: "new" }>, list: Expr[]): Type {
    if (list.length < 1 || list.length > 2) throw new CompileError("'new RegExp' takes a pattern and optional flags", e.start, e.end);
    const known = list.map((a) => (a.kind === "string" ? a.value : a.kind === "template" && a.exprs.length === 0 ? a.quasis[0]! : undefined));
    if (known.some((k) => k === undefined)) {
      throw new CompileError("a regex is compiled while compiling, so 'new RegExp' takes its pattern and flags as string literals; for a pattern known only when the program runs, Fish has no regex", e.start, e.end);
    }
    regexNews.add(e);
    return regexLiteral(known[0]!, known[1] ?? "", e, shownSource(known[0]!));
  }

  // `re.test(s)` and `re.exec(s)`. A regex keeps no `lastIndex`, so on a `g` or `y` regex they
  // would loop forever where JavaScript moves on; `matchAll` goes through every match instead.
  function regexCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: RegexType, generic: boolean): { type: Type; what: string } {
    const what = `'${callee.name}'`;
    if (callee.name !== "test" && callee.name !== "exec") throw new CompileError(`'RegExp' has no method '${callee.name}' in Fish; it has 'test' and 'exec', and strings take regexes in 'replace', 'split', 'match' and 'matchAll'`, callee.start, callee.end);
    if (callee.optional || e.optional) throw new CompileError(`a regex is always there, so ${what} is called without '?.'`, e.start, e.end);
    if (/[gy]/.test(t.flags)) {
      throw new CompileError(`a Fish regex keeps no 'lastIndex', so ${what} on a regex with the '${t.flags.includes("g") ? "g" : "y"}' flag would start at 0 every time; ${callee.name === "exec" ? "use 'matchAll' to go through every match, or" : ""} drop the flag`, e.start, e.end);
    }
    if (e.args.length !== 1) throw new CompileError(`${what} takes the string to match`, e.start, e.end);
    const s = read(e.args[0]!);
    if (!stringLike(s)) throw new CompileError(`${what} matches a string, not '${show(s)}'`, e.args[0]!.start, e.args[0]!.end);
    if (s !== "string") coerce(e.args[0]!, s, "string", "");
    loaded(callee.object, types.get(callee.object)!);
    if (callee.name === "exec" && t.any && !generic) {
      throw new CompileError("'exec' types its match from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter", e.start, e.end);
    }
    regexCalls.set(e, callee.name);
    return { type: callee.name === "test" ? "boolean" : unionType([matchType(t), "null"]), what };
  }

  // The regex a value is: its own type, or, for a `RegExp` parameter in a generic body's
  // definition, any regex.
  function asRegex(t: Type): RegexType | undefined {
    const held = lower(t);
    if (typeof held === "string") return undefined;
    if (held.kind === "regex") return held;
    return held.kind === "param" && held.bound?.kind === "regex" ? held.bound : undefined;
  }

  // How JavaScript shows a pattern given as a string: a '/' not already escaped, outside a class,
  // and line terminators escaped, and an empty one as '(?:)'.
  function shownSource(pattern: string): string {
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
  function regexMember(e: Extract<Expr, { kind: "member" }>, t: RegexType, generic: boolean): Type {
    if (t.any && !generic && (e.name === "source" || e.name === "flags" || e.name in REGEX_FLAGS)) {
      throw new CompileError(`'${e.name}' is known from a regex's pattern, which isn't known for a 'RegExp' kept here; read it where the regex is written, or pass the regex as a parameter`, e.start, e.end);
    }
    if (e.name === "source" || e.name === "flags") return "string";
    if (e.name in REGEX_FLAGS) return "boolean";
    if (e.name === "lastIndex") throw new CompileError("a Fish regex keeps no state, so it has no 'lastIndex'; use 'matchAll' to go through every match", e.start, e.end);
    throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(t)}'`, e.start, e.end);
  }

  // `Date.now()` and `performance.now()`, unless a name of the program's hides `Date` or
  // `performance`; their other members aren't there yet.
  function clockOf(callee: Expr): "Date.now" | "performance.now" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident") return undefined;
    const owner = callee.object.name;
    if ((owner !== "Date" && owner !== "performance") || lookup(owner) || classes.has(owner) || byName.has(owner) || byName.has(`const ${owner}`) || enums.has(owner)) return undefined;
    if (callee.name !== "now") throw new CompileError(`'${owner}.${callee.name}' isn't supported yet; '${owner}.now()' is`, callee.start, callee.end);
    return `${owner}.now` as "Date.now" | "performance.now";
  }

  // `JSON.stringify` and `JSON.parse`, unless a name of the program's hides `JSON`.
  function jsonOf(callee: Expr): "stringify" | "parse" | undefined {
    if (callee.kind !== "member" || callee.object.kind !== "ident" || callee.object.name !== "JSON") return undefined;
    if (lookup("JSON") || classes.has("JSON") || byName.has("JSON") || byName.has("const JSON") || enums.has("JSON")) return undefined;
    return callee.name === "stringify" || callee.name === "parse" ? callee.name : undefined;
  }

  // `JSON.stringify(x)`: x written as JSON text, which its type decides.
  function stringify(e: Call): { type: Type; what: string } {
    if (e.typeArgs.length > 0) throw new CompileError("'JSON.stringify' takes no type argument; the value's type decides how it is written", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.stringify' replacer and indent arguments", e.args[1]!);
    const x = e.args[0];
    if (!x) throw new CompileError("'JSON.stringify' takes the value to write", e.start, e.end);
    jsonable(read(x), x, "written as");
    jsonCalls.set(e, "stringify");
    return { type: "string", what: "'JSON.stringify'" };
  }

  // `JSON.parse<T>(s)`: s read as a T, throwing a JsonError when it isn't one.
  function jsonParse(e: Call): { type: Type; what: string } {
    // Without a type it reads the dynamic `Json` value, as TypeScript's gives `any`.
    const [written = { id: nextId(ids), kind: "ref", name: JSON_VALUE_NAME, args: [], start: e.start, end: e.end } as TypeNode, ...others] = e.typeArgs;
    if (others.length > 0) throw new CompileError("'JSON.parse' takes one type argument, the type to read", e.start, e.end);
    if (e.args.length > 1) throw unsupported("'JSON.parse' revivers", e.args[1]!);
    const text = e.args[0];
    if (!text) throw new CompileError("'JSON.parse' takes the text to read", e.start, e.end);
    const t = resolveType(written);
    jsonable(t, written, "read from");
    if (holdsRef(t)) throw new CompileError(`'JSON.parse' makes owned values, so '${show(t)}' can't hold references`, written.start, written.end);
    if (holdsPattern(t)) throw unsupported("template literal pattern types in 'JSON.parse'", written);
    if (holdsPart(t, (u) => typeof u !== "string" && u.kind === "fixed")) throw unsupported("fixed-size arrays in 'JSON.parse'", written);
    const hidden = holdsPart(t, (u) => typeof u !== "string" && u.kind === "class" && u.fields.some((f) => f.name.startsWith("#")));
    if (hidden) throw new CompileError("a class with '#private' fields can't be read from JSON, since JSON doesn't hold them", written.start, written.end);
    const s = read(text);
    if (!stringLike(s)) throw new CompileError(`'JSON.parse' reads a string, not '${show(s)}'`, text.start, text.end);
    if (s !== "string") coerce(text, s, "string", "");
    raise(e, classes.get("JsonError")!.type, "'JSON.parse'");
    jsonCalls.set(e, "parse");
    return { type: t, what: "'JSON.parse'" };
  }

  // Refuses a type with a part JSON can't hold, saying why.
  function jsonable(t: Type, at: Span, verb: string) {
    const part = unjson(t, derivesJson);
    if (!part) return;
    const why = typeof part === "string" ? "it has no JSON form"
      : part.kind === "class" ? `a class is ${verb} JSON when it has '@derive(Json)', which '${part.name}' doesn't`
      : part.kind === "variant" ? `an enum holding values is ${verb} JSON when it has '@derive(Json)', which '${part.enum}' doesn't`
      : part.kind === "map" ? (part.set ? "a Set has no JSON form; use an array of its members" : "only a Map with string keys has a JSON form, an object")
      : "it has no JSON form";
    throw new CompileError(`values of type '${show(part)}' can't be ${verb} JSON: ${why}`, at.start, at.end);
  }

  function derivesJson(t: ClassType | VariantType): boolean {
    if (t.kind === "variant") return [...enums.values()].some((e) => e.data?.name === t.enum && e.data.json);
    return classOf(t).node.derives?.includes("Json") ?? false;
  }

  // The global `Math`, unless a name of the program's hides it.
  function isMath(e: Expr): boolean {
    return e.kind === "ident" && e.name === "Math" && !lookup("Math") && !classes.has("Math") && !byName.has("Math") && !byName.has("const Math") && !enums.has("Math");
  }

  // `Math.abs`, `sign`, `min` and `max` keep the numeric type they are given, a literal taking
  // the type of the numbers beside it as with an operator; the rest take and give `f64`.
  function mathCall(e: Call, name: string): { type: Type; what: string } {
    const what = `'Math.${name}'`;
    if (e.typeArgs.length > 0) throw new CompileError(`${what} takes no type argument`, e.start, e.end);
    if (name === "random") {
      if (e.args.length > 0) throw new CompileError("'Math.random' takes no arguments", e.start, e.end);
      clocks.set(e, "Math.random");
      return { type: "f64", what };
    }
    const arity = MATH_FLOAT[name];
    if (arity !== undefined) {
      if (e.args.length !== arity) throw new CompileError(`${what} takes ${arity === 1 ? "one number" : "two numbers"}`, e.start, e.end);
      for (const a of e.args) {
        const t = read(a);
        if (t === "f64" || adapt(a, "f64")) continue;
        throw new CompileError(isNumeric(t) ? `${what} takes a '${show("f64")}', an f64, not '${show(t)}'; convert it with 'as', as in 'n as f64'` : `${what} takes a number, not '${show(t)}'`, a.start, a.end);
      }
      maths.add(e);
      return { type: "f64", what };
    }
    if (!["abs", "sign", "min", "max"].includes(name)) throw new CompileError(`'Math' has no '${name}' in Fish yet`, e.start, e.end);
    const many = name === "min" || name === "max";
    if (many ? e.args.length === 0 : e.args.length !== 1) throw new CompileError(many ? `${what} takes one or more numbers` : `${what} takes one number`, e.start, e.end);
    const given = e.args.map((a) => read(a));
    given.forEach((t, i) => {
      if (!isNumeric(t)) throw new CompileError(`${what} takes numbers, not '${show(t)}'`, e.args[i]!.start, e.args[i]!.end);
    });
    const fixed = e.args.findIndex((a) => !literalOnly(a, true));
    const to = fixed >= 0 ? given[fixed]! : given.some(isFloat) ? "f64" : "i64";
    e.args.forEach((a, i) => {
      if (given[i] !== to && !adapt(a, to)) throw new CompileError(`${what} takes numbers of one type, but got '${show(to)}' and '${show(given[i]!)}'; convert one with 'as'`, a.start, a.end);
    });
    maths.add(e);
    return { type: to, what };
  }

  function arrayStatic(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const at = { start: callee.start, end: callee.end };
    if (callee.name === "of") {
      if (e.typeArgs.length > 1) throw new CompileError("'Array.of' takes one type argument, its element type", e.start, e.end);
      if (e.typeArgs[0]) ofElements.set(e, e.typeArgs[0]);
      const literal = Object.assign(e, { kind: "array", elements: e.args }) as unknown as Expr;
      return { type: value(literal), what: "'Array.of'" };
    }
    // `Array.isArray(v)`: whether v holds an array, which narrows a union to its array members.
    if (callee.name === "isArray") {
      if (e.typeArgs.length > 0 || e.args.length !== 1) throw new CompileError("'Array.isArray' takes the value to test", e.start, e.end);
      read(e.args[0]!);
      kindTests.set(e, "Array");
      return { type: "boolean", what: "'Array.isArray'" };
    }
    if (callee.name !== "from") throw new CompileError(`'Array' has no '${callee.name}'; arrays are made with 'Array.of', 'Array.from' or 'new Array(n).fill(x)'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("'Array.from' takes no type argument; its element type is what the source holds, or what the map function gives", e.start, e.end);
    if (e.args.length < 1 || e.args.length > 2) throw new CompileError("'Array.from' takes what to make the array from, and an optional function mapping each value", e.start, e.end);
    const [source, f] = e.args as [Expr, Expr | undefined];
    const prelude = (name: string, args: Expr[]): Expr => ({ id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name, ...at }, args, typeArgs: [], optional: false, ...at });
    const prop = source.kind === "object" && source.props.length === 1 ? source.props[0]! : undefined;
    const written = prop?.kind === "property" && prop.key === "length" ? prop.value
      : prop?.kind === "shorthand" && prop.name === "length" && !prop.default ? { id: nextId(ids), kind: "ident", name: "length", start: prop.start, end: prop.end } as Expr : undefined;
    const length = written && arrayLength(written, false);
    let made: Expr;
    if (length) {
      if (!f) throw new CompileError("'Array.from({ length: n })' alone would hold n undefined values, which Fish has no way to make; give it a function, as in 'Array.from({ length: n }, (_, i) => i)'", e.start, e.end);
      made = prelude("array range", [length]);
    } else {
      const t = value(source);
      const held = isRefType(t) ? t.to : t;
      if (isArray(held)) made = f ? source : { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: source, name: "slice", optional: false, ...at }, args: [], typeArgs: [], optional: false, ...at };
      else if (stringLike(held)) made = prelude("array chars", [source]);
      else if (yieldsOf(held) !== undefined) made = prelude("array collect", [source]);
      else throw new CompileError(`'Array.from' makes an array from an array, a string, a generator or '{ length: n }', not '${show(t)}'`, source.start, source.end);
    }
    if (f) made = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: made, name: "map", optional: false, ...at }, args: [f], typeArgs: [], optional: false, ...at };
    Object.assign(e, made, { id: e.id, start: e.start, end: e.end });
    return call(e as Call);
  }

  // `n` as the `i64` an array's length is made from, checked to be an i64 or a usize, and with
  // `panics` a negative one ending the program at n.
  function arrayLength(n: Expr, panics: boolean): Expr {
    const checked: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: "fill length", start: n.start, end: n.end }, args: [n], typeArgs: [], optional: false, start: n.start, end: n.end };
    if (panics) lengthChecks.add(checked);
    return checked;
  }

  // A method calling a callback converts each value it passes to the parameter's type, so a
  // literal may widen, except a reference or, with `converted` false, an index, which it passes
  // as it is. The argument always comes, so the parameter can't be optional.
  function passedExactly(name: string, given: Type, written: Type, p: Param | undefined, at: Span, converted = true) {
    if (p && (p.optional || defaulted.has(p)) && !sameLowered(given, written)) throw new CompileError(`'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    if (sameLowered(given, written) || (converted && !isRefType(given) && fits(given, written))) return;
    if (p && (p.optional || defaulted.has(p))) throw new CompileError(`'${name}' always passes its callback this argument, so the parameter can't be optional or have a default`, at.start, at.end);
    // A declared function given by name takes its own value, which a lent element isn't.
    const named = p && namedParams.get(p);
    if (named && isRefType(given) && sameLowered(given.to, written)) {
      const { fn, names, clones } = named;
      const arrow = `(${names.join(", ")}) => ${fn}(${names.map((n, i) => (clones[i] ? `${n}.clone()` : n)).join(", ")})`;
      throw new CompileError(`'${name}' lends its callback ${article(show(given))}, and '${fn}' takes its own '${show(written)}'; write '${arrow}', or have '${fn}' take a '${show(given)}'`, at.start, at.end);
    }
    throw new CompileError(`'${name}' passes its callback ${article(show(given))} here, not ${article(show(written))}`, at.start, at.end);
  }

  // The element type of a spread, `...x`. An array spreads its elements, cloned unless it was made
  // for the spread; a string, a generator, a Map or a Set is first made into the array
  // `Array.from` would make of it.
  function spreadElements(x: Extract<Expr, { kind: "spread" }>): Type {
    const source = x.value;
    const t = value(source);
    const held = lower(isRefType(t) ? t.to : t);
    const at = { start: source.start, end: source.end };
    const made = (callee: Expr, args: Expr[] = []): Expr => ({ id: nextId(ids), kind: "call", callee, args, typeArgs: [], optional: false, ...at });
    let from: Expr | undefined;
    if (stringLike(held)) from = made({ id: nextId(ids), kind: "ident", name: "array chars", ...at }, [source]);
    else if (yieldsOf(held) !== undefined) from = made({ id: nextId(ids), kind: "ident", name: "array collect", ...at }, [source]);
    else if (typeof held !== "string" && held.kind === "map") from = made({ id: nextId(ids), kind: "member", object: source, name: held.set ? "values" : "entries", optional: false, ...at });
    else if (!isArray(held)) throw new CompileError(`'...' spreads an array, a string, a generator, a Map or a Set, not '${show(t)}'`, source.start, source.end);
    if (from) {
      once.add(source);
      x.value = from;
    }
    const array = from ? value(from) : t;
    const lowered = lower(isRefType(array) ? array.to : array) as ArrayType;
    if (isRefType(array)) coercions.set(x.value, lowered);
    clonable(lowered.element, x, "a spread");
    // Codegen converts each element from this type.
    types.set(x, lowered.element);
    return lowered.element;
  }

  // A call's arguments after the fixed parameters fill its rest parameter, as one array literal,
  // where a spread argument spreads as in any literal. Packed once, as a generic body is
  // checked again for each instance.
  function packRest(e: Expr, list: Expr[], params: Param[]) {
    if (packed.has(e)) return;
    const fixed = params.length - 1;
    refuseSpread(list.slice(0, fixed));
    if (list.length < fixed) return;
    const rest = list.splice(fixed);
    const at = rest.length > 0 ? { start: rest[0]!.start, end: rest.at(-1)!.end } : { start: e.end - 1, end: e.end - 1 };
    list.push({ id: nextId(ids), kind: "array", elements: rest, ...at });
    packed.add(e);
  }

  // A spread argument fills only a rest parameter, since an array's length isn't known while compiling.
  function refuseSpread(list: Expr[]) {
    const spread = list.find((a) => a.kind === "spread");
    if (spread) throw new CompileError("a spread argument fills only a rest parameter, as in 'function f(...xs: T[])', since an array's length isn't known while compiling", spread.start, spread.end);
  }

  // A closure that moves a capture out of itself can run only once, which a method calling it
  // again and again can't allow.
  function runsOften(c: ClosureType, name: string, calls: string, at: Span) {
    if (c.once) throw new CompileError(`'${name}' calls ${calls}, but this closure moves '${c.once}' out, so it can run only once; clone it inside instead`, at.start, at.end);
  }

  // `includes` and `indexOf` compare elements by value, as `===` does; `join` writes each as
  // `String(x)` would; `slice` gives clones of a range, its positions as JavaScript reads them.
  function readingCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    const name = callee.name;
    if (name === "concat") {
      // Each array given is read, as this one is, and its elements cloned.
      for (const a of e.args) {
        expect(a, array);
        const t = value(a);
        const given = isRefType(t) ? t.to : t;
        // A literal, `[]` and `[2]` among them, takes the element type as an annotated one does.
        if (!(a.kind === "array" && literalArray(a, t, array)) && !fits(given, array)) throw new CompileError(`'concat' joins arrays of the same element type, '${show(array)}', not '${show(t)}'; to add single values, push them`, a.start, a.end);
        coercions.set(a, refType(array, false));
      }
      return { type: array, what: "'concat'" };
    }
    if (name === "flat") {
      if (e.args.length > 0) throw new CompileError("'flat' flattens one level so far, so it takes no depth", e.args[0]!.start, e.args[0]!.end);
      const inner = lower(array.element);
      if (typeof inner === "string" || inner.kind !== "array") throw new CompileError(`'flat' flattens an array of arrays, not '${show(array)}'`, callee.start, callee.end);
      return { type: inner, what: "'flat'" };
    }
    const [most, takes] = name === "includes" || name === "indexOf" || name === "lastIndexOf" ? [2, "a value to look for and an optional position to start from"] : name === "join" ? [1, "an optional separator"] : [2, "an optional start and end"];
    const least = name === "includes" || name === "indexOf" || name === "lastIndexOf" ? 1 : 0;
    if (e.args.length < least || e.args.length > most) throw new CompileError(`'${name}' takes ${takes}`, e.start, e.end);
    const argument = (a: Expr, want: Type) => {
      expect(a, want);
      const t = value(a);
      coerce(a, t, want, `argument of type '${show(t)}' is not assignable to parameter of type '${show(want)}'`);
    };
    if (name === "join") {
      // Literals, and unions of them, are written as their values.
      const writable = (t: Type): boolean => isNumeric(t) || t === "boolean" || t === "string" || (typeof t !== "string" && (t.kind === "literal" || (t.kind === "union" && t.members.every(writable))));
      if (!writable(lower(array.element))) {
        throw new CompileError(`'join' writes each element as 'String(x)' does, which works for numbers, booleans and strings, not '${show(array.element)}'`, callee.start, callee.end);
      }
      if (e.args[0]) argument(e.args[0], "string");
      return { type: "string", what: "'join'" };
    }
    if (name === "slice") {
      for (const a of e.args) argument(a, "i64");
      return { type: array, what: "'slice'" };
    }
    const [sought, from] = e.args as [Expr, Expr | undefined];
    expect(sought, array.element);
    const t = value(sought);
    if (objectsMeet(array.element, t)) throw new CompileError(`'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    // A value that fits the element type, a literal of a sized number too, is one.
    if (fits(t, array.element) || (isNumeric(widenLet(t)) && isNumeric(array.element) && isFloat(widenLet(t)) === isFloat(array.element))) {
      if (from) argument(from, "i64");
      coerce(sought, t, array.element, `argument of type '${show(t)}' is not assignable to parameter of type '${show(array.element)}'`);
      return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
    }
    if (objectsMeet(array.element, t)) throw new CompileError(`'${name}' compares elements by value, which objects and instances can't do until they derive 'Eq'; use 'some' with a callback comparing a field`, callee.start, callee.end);
    if (!comparable(array.element, t)) throw new CompileError(`'${name}' can never find a '${show(widenLet(t))}' among elements of type '${show(array.element)}'`, sought.start, sought.end);
    if (from) argument(from, "i64");
    return { type: name === "includes" ? "boolean" : "i64", what: `'${name}'` };
  }

  // A raw pointer's methods, all inside `unsafe`: reading and writing what it points at, which
  // must be a plain value a raw write can't leave dangling, moving along by elements, and
  // telling whether it points anywhere.
  function pointerCall(e: Call, callee: Extract<Expr, { kind: "member" }>, p: PointerType): { type: Type; what: string } {
    const counts: Record<string, number> = { read: 0, write: 1, offset: 1, isNull: 0 };
    if (!(callee.name in counts)) throw new CompileError(`raw pointers have no method '${callee.name}'; they have 'read', 'write', 'offset' and 'isNull'`, callee.start, callee.end);
    needsUnsafe(`'${callee.name}' on a raw pointer`, callee);
    if (linked(callee)) throw unsupported("optional chains calling raw pointer methods", callee);
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, p);
    if (e.args.length !== counts[callee.name]) throw new CompileError(`'${callee.name}' takes ${counts[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const plain = isNumeric(p.to) || p.to === "boolean" || (typeof p.to !== "string" && p.to.kind === "pointer");
    if ((callee.name === "read" || callee.name === "write") && !plain) throw unsupported(`raw reads and writes of '${show(p.to)}'`, callee);
    if (callee.name === "read") return { type: p.to, what: "'read'" };
    if (callee.name === "isNull") return { type: "boolean", what: "'isNull'" };
    const a = e.args[0]!;
    const want = callee.name === "write" ? p.to : "i64";
    if (callee.name === "write" && !p.mutable) throw new CompileError("'write' needs a 'MutPtr'; a 'Ptr' only reads what it points at", callee.start, callee.end);
    expect(a, want);
    const t = value(a);
    coerce(a, t, want, `argument of type '${show(t)}' is not assignable to parameter of type '${show(want)}'`);
    return { type: callee.name === "write" ? "void" : p, what: `'${callee.name}'` };
  }

  // `new Atomic(v)`, `new Lock(v)`, `new Cell(v)`: one holding v, of its type argument, the type
  // expected of it, or else v's own type.
  function interiorNew(e: Extract<Expr, { kind: "new" }>, which: InteriorType["which"], list: Expr[]): Type {
    if (list.length !== 1 || e.typeArgs.length > 1) throw new CompileError(`'${which}' takes the value it starts with, as in 'new ${which}(0)'`, e.start, e.end);
    const expected = wanted.get(e);
    const given = e.typeArgs[0] ? heldArgument(resolveType(e.typeArgs[0])) : typeof expected !== "string" && expected?.kind === "interior" && expected.which === which ? expected.of : undefined;
    if (given) expect(list[0]!, given);
    const t = value(list[0]!);
    const of = given ?? heldArgument(widenLet(t));
    coerce(list[0]!, t, of, `argument of type '${show(t)}' is not assignable to parameter of type '${show(of)}'`);
    return interior(typing, which, of, e);
  }

  // An Atomic's methods, JavaScript's `Atomics` on one value: each changes it in one step, seen
  // the same by every thread, and gives what it held before, except `store`.
  function interiorCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType): { type: Type; what: string } {
    where(callee, t);
    if (t.which === "Cell") return cellCall(e, callee, t);
    if (t.which === "Lock") return lockCall(e, callee, t);
    if (t.which !== "Atomic") throw new CompileError(`'${t.which}' has no method '${callee.name}'`, callee.start, callee.end);
    const takes: Record<string, number> = { load: 0, store: 1, add: 1, sub: 1, exchange: 1, compareExchange: 2 };
    if (!(callee.name in takes)) throw new CompileError(`'Atomic' has no method '${callee.name}'; it has 'load', 'store', 'add', 'sub', 'exchange' and 'compareExchange'`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling 'Atomic' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError(`'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : `${takes[callee.name]} arguments`}`, e.start, e.end);
    const of = lower(t.of);
    if ((callee.name === "add" || callee.name === "sub") && !isInteger(of)) throw new CompileError(`'${callee.name}' needs an integer 'Atomic', not '${show(t)}'`, callee.start, callee.end);
    for (const a of e.args) {
      expect(a, of);
      const given = value(a);
      coerce(a, given, of, `argument of type '${show(given)}' is not assignable to parameter of type '${show(of)}'`);
    }
    return { type: callee.name === "store" ? "void" : of, what: `'${callee.name}'` };
  }

  // An Atomic's, Cell's or Lock's method changes it where it lives, so it is called on a place,
  // a reference, or a value just made; anything else would change a copy.
  function where(callee: Extract<Expr, { kind: "member" }>, t: InteriorType) {
    const inPlace = (e: Expr): boolean => {
      const type = types.get(e);
      if (typeof type !== "string" && type?.kind === "ref") return true;
      if (e.kind === "ident" || e.kind === "this" || e.kind === "call" || e.kind === "new") return true;
      if (e.kind === "member") {
        // A field shared by a union's members is read from a copy of the union.
        const holder = types.get(e.object);
        const held = typeof holder !== "string" && holder?.kind === "ref" ? holder.to : holder;
        const inside = typeof held !== "string" && (held?.kind === "object" || held?.kind === "class" || held?.kind === "shared");
        return inside && !calls.has(e) && !ctx.copiesOut.has(e) && inPlace(e.object);
      }
      return element(e) && inPlace(e.object);
    };
    if (inPlace(callee.object)) return;
    const hint = callee.object.kind === "nonNull" ? "; narrow the Option with a check like 'if (x !== null)' instead of '!'" : "; narrow a union to one member first";
    throw new CompileError(`'${callee.name}' works on the '${t.which}' where it lives, so call it on a variable or a field${hint}`, callee.start, callee.end);
  }

  // A Cell's methods, Rust's: `get` copies out what it holds, `set` puts a value in, dropping
  // the old one, and `replace` puts one in and gives the old one back.
  function cellCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType): { type: Type; what: string } {
    const takes: Record<string, number> = { get: 0, set: 1, replace: 1 };
    if (!(callee.name in takes)) throw new CompileError(`'Cell' has no method '${callee.name}'; it has 'get', 'set' and 'replace'`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling 'Cell' methods", callee);
    if (e.args.length !== takes[callee.name]) throw new CompileError(`'${callee.name}' takes ${takes[callee.name] === 1 ? "1 argument" : "no arguments"}`, e.start, e.end);
    const of = lower(t.of);
    if (callee.name === "get" && !isCopy(of)) throw new CompileError(`'get' copies what a Cell holds, which a '${show(of)}' can't be; use 'replace' to take it out and put another in`, callee.start, callee.end);
    for (const a of e.args) {
      expect(a, of);
      const given = value(a);
      coerce(a, given, of, `argument of type '${show(given)}' is not assignable to parameter of type '${show(of)}'`);
    }
    return { type: callee.name === "set" ? "void" : of, what: `'${callee.name}'` };
  }

  // `new Semaphore(n)` with n slots, and `new Channel<T>(capacity)`, of its type argument or the
  // type expected of it.
  function blockNew(e: Extract<Expr, { kind: "new" }>, which: "Semaphore" | "Channel", list: Expr[]): Type {
    const what = which === "Semaphore" ? "the number of slots it hands out, as in 'new Semaphore(4)'" : "how many values it holds before 'send' waits, as in 'new Channel<string>(8)'";
    if (list.length !== 1 || e.typeArgs.length > (which === "Channel" ? 1 : 0)) throw new CompileError(`'${which}' takes ${what}`, e.start, e.end);
    expect(list[0]!, "i64");
    const t = value(list[0]!);
    coerce(list[0]!, t, "i64", `argument of type '${show(t)}' is not assignable to parameter of type 'i64'`);
    if (which === "Semaphore") return blockType("Semaphore");
    const expected = wanted.get(e);
    const of = e.typeArgs[0] ? resolveType(e.typeArgs[0]) : typeof expected !== "string" && expected?.kind === "block" && expected.which === "Channel" ? expected.of : undefined;
    if (!of) throw new CompileError("'Channel' needs the type it carries, as in 'new Channel<string>(8)'", e.start, e.end);
    return channel(typing, of, e);
  }

  // Whether a place is read through a Dyn, or a runtime-computed property, anywhere along its
  // path: such a read gives a copy, which a change would be lost in.
  function readCopy(e: Expr): boolean {
    for (let at = e; ; ) {
      if (computed.has(at)) return true;
      if (at.kind === "member" || at.kind === "index") at = at.object;
      else if (at.kind === "nonNull") at = at.expr;
      else return false;
    }
  }

  // A Map's and a Set's methods. Those changing it need it in a place that may change, or a
  // `Mut` borrow of it, which `set` and `add` give for chaining. What they give out are clones.
  function mapCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: MapType): { type: Type; what: string } {
    const name = callee.name;
    const kind = t.set ? "Set" : "Map";
    if (!(t.set ? SET_METHODS : MAP_METHODS).has(name)) throw new CompileError(`'${kind}' has no method '${name}' yet${didYouMean(name, t.set ? SET_METHODS : MAP_METHODS)}`, callee.start, callee.end);
    if (linked(callee)) throw unsupported(`optional chains calling '${kind}' methods`, callee);
    if (e.typeArgs.length > 0) throw new CompileError(`'${name}' takes no type arguments`, e.start, e.end);
    const count = MAP_ARGUMENTS[name]!;
    if (e.args.length !== count) throw new CompileError(`'${name}' takes ${count === 0 ? "no arguments" : count === 1 ? "1 argument" : `${count} arguments`}`, e.start, e.end);
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, t);
    if (MAP_CHANGES.has(name)) {
      if (readCopy(callee.object)) throw new CompileError(`'${name}' changes its ${kind}, and this one is read through a Dyn, which gives a copy; change it through a method`, callee.start, callee.end);
      const lent = isRefType(held) && held.mutable;
      if (!place(callee.object) && !lent) throw new CompileError(`'${name}' changes its ${kind}, so call it on a variable or a field`, callee.start, callee.end);
      if (!lent) changeable(callee.object, name === "clear" ? "clear" : name === "delete" ? "delete from" : name === "update" ? "update" : "add to");
    }
    const argument = (x: Expr, to: Type) => {
      expect(x, to);
      const got = value(x);
      coerce(x, got, to, `argument of type '${show(got)}' is not assignable to parameter of type '${show(to)}'`);
    };
    if (count > 0 && name !== "forEach") argument(e.args[0]!, t.key);
    switch (name) {
      case "set":
      case "add":
        if (name === "set") argument(e.args[1]!, t.value);
        borrowsFrom.set(e, [callee.object]);
        return { type: refType(t, true), what: `'${name}'` };
      case "get":
        clonable(t.value, callee);
        return { type: unionType([t.value, "null"]), what: "'get'" };
      case "has":
      case "delete":
        return { type: "boolean", what: `'${name}'` };
      case "clear":
        return { type: "void", what: "'clear'" };
      case "keys":
        return { type: arrayType(t.key), what: "'keys'" };
      case "values":
        if (t.set) return { type: arrayType(t.key), what: "'values'" };
        clonable(t.value, callee);
        return { type: arrayType(t.value), what: "'values'" };
      case "entries":
        clonable(t.value, callee);
        return { type: arrayType(tupleType(t.set ? [t.key, t.key] : [t.key, t.value])), what: "'entries'" };
    }
    // `update(k, f)` and `forEach(f)` call an arrow written in place: `update`'s gets the value
    // to change, once, and `forEach`'s each value and its key in turn, borrowed or copied.
    const callback = e.args[name === "update" ? 1 : 0]!;
    namedFunction(callback);
    if (callback.kind !== "arrow") throw new CompileError(`'${name}' takes an arrow function written in place, or a function by name`, callback.start, callback.end);
    const lend = (u: Type) => (isCopy(u) ? u : refType(u, false));
    // A Set's forEach passes each member twice, as JavaScript's does.
    const params = name === "update" ? [refType(t.value, true)] : t.set ? [lend(t.key), lend(t.key)] : [lend(t.value), lend(t.key)];
    const passes = name === "update" ? "the value to change" : t.set ? "each member" : "each value and its key";
    expect(callback, functionType(params.map((_, i) => (i === 0 ? "value" : "key")), params, "void"));
    const c = value(callback);
    if (typeof c === "string" || c.kind !== "closure" || c.params.length > params.length) {
      throw new CompileError(`'${name}' passes its callback ${passes}${name === "forEach" ? "; JavaScript's last argument, the collection, isn't passed, since it is already borrowed" : ""}`, callback.start, callback.end);
    }
    if (name === "forEach") runsOften(c, name, "its callback once per entry", callback);
    c.params.forEach((p, i) => {
      const at = callback.params[i] ?? callback;
      passedExactly(name, params[i]!, p, callback.params[i], at);
    });
    if (holdsFuture(c.returns)) throw new CompileError(`'${name}' with a callback giving a Promise isn't supported yet`, callback.start, callback.end);
    return { type: name === "update" ? "boolean" : "void", what: `'${name}'` };
  }

  // `new Map<K, V>()` and `new Set<T>()`, their types written or taken from where they're expected.
  function mapNew(e: Extract<Expr, { kind: "new" }>, set: boolean, list: Expr[]): Type {
    const name = set ? "Set" : "Map";
    const shape = set ? "an array of members, as in 'new Set([\"a\", \"b\"])'" : "an array of key and value pairs, as in 'new Map([[\"a\", 1]])'";
    if (list.length > 1) throw new CompileError(`'new ${name}' takes ${shape}, or nothing`, e.start, e.end);
    if (e.typeArgs.length > 0 && e.typeArgs.length !== (set ? 1 : 2)) throw new CompileError(set ? "'Set' takes the type of its members, like 'new Set<string>()'" : "'Map' takes its key and value types, like 'new Map<string, i64>()'", e.start, e.end);
    const expected = wanted.get(e);
    const made = e.typeArgs.length > 0 ? collection(typing, resolveType(e.typeArgs[0]!), set ? "void" : resolveType(e.typeArgs[1]!), set, e)
      : typeof expected !== "string" && expected?.kind === "map" && expected.set === set ? expected : undefined;
    // The entries or members are moved in from an array, which gives the types when nothing else does.
    const from = list[0];
    if (from) {
      if (made) expect(from, arrayType(set ? made.key : tupleType([made.key, made.value])));
      else if (!set && from.kind === "array") for (const x of from.elements) if (x?.kind === "array" && x.elements.length === 2) pairs.add(x);
      const t = value(from);
      if (made) {
        const wants = arrayType(set ? made.key : tupleType([made.key, made.value]));
        coerce(from, t, wants, `'new ${name}' takes ${shape}, not '${show(t)}'`);
        return made;
      }
      const element = isArray(t) ? lower(t.element) : undefined;
      const pair = element !== undefined && isTuple(element) && (element as ObjectType).fields.length === 2 && (element as ObjectType).rest === undefined && (element as ObjectType).required === undefined ? elementsOf(element as ObjectType) : undefined;
      if (element === undefined || (!set && !pair)) throw new CompileError(`'new ${name}' takes ${shape}, not '${show(t)}'`, from.start, from.end);
      // Each closure is its own type, so which callable type the values share must be written.
      const v = set ? undefined : lower(pair![1]!);
      if (typeof v !== "string" && v?.kind === "closure") throw new CompileError(`a 'Map' of functions needs its types written, as in 'new Map<${show(widenLet(pair![0]!))}, ${v.name}>(...)'`, e.start, e.end);
      const result = collection(typing, widenLet(set ? element : pair![0]!), set ? "void" : widenLet(pair![1]!), set, e);
      const wants = arrayType(set ? result.key : tupleType([result.key, result.value]));
      coerce(from, t, wants, `argument of type '${show(t)}' is not assignable to parameter of type '${show(wants)}'`);
      return result;
    }
    if (made) return made;
    throw new CompileError(set ? "'new Set()' needs the type of its members, as in 'new Set<string>()'" : "'new Map()' needs its key and value types, as in 'new Map<string, i64>()'", e.start, e.end);
  }

  // `handle.join()`: the task's handle, awaited as giving its value or throwing a TaskPanic.
  function handleCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: HandleType): { type: Type; what: string } {
    if (callee.name !== "join") throw new CompileError(`'${show(t)}' has no method '${callee.name}'; ${t.joined ? "await it" : "it has 'join', and awaiting it gives what the task gave"}`, callee.start, callee.end);
    if (t.joined) throw new CompileError("this is already the task's 'join()'; await it", callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling 'join'", callee);
    if (e.args.length !== 0) throw new CompileError("'join' takes no arguments", e.start, e.end);
    if (isRefType(types.get(callee.object)!)) throw new CompileError("'join' takes the handle over, so it needs the handle itself, not a borrow of it", callee.object.start, callee.object.end);
    joinCalls.add(e);
    return { type: joinedType(t, classes.get("TaskPanic")!.type), what: "'join'" };
  }

  // A Semaphore's `acquire()` and `available()`, and a Channel's `send(v)`, `receive()` and
  // `close()`. A Permit has no methods: dropping it gives its slot back.
  function blockCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: BlockType): { type: Type; what: string } {
    if (t.which === "JsValue") return jsMethodCall(e, callee, t);
    // A wait may also take an AbortSignal, as its last argument.
    const sockets = ["accept", "read", "write"].includes(callee.name);
    const waits = callee.name === "acquire" || callee.name === "send" || callee.name === "receive" || sockets;
    const methods: Record<string, number> = t.which === "Semaphore" ? { acquire: 0, available: 0 } : t.which === "Channel" ? { send: 1, receive: 0, close: 0, ...(e.start >= STD_BASE ? { settle: 1 } : {}) }
      : t.which === "AbortController" ? { abort: 0 } : t.which === "AbortSignal" ? { throwIfAborted: 0 } : t.which === "TcpListener" ? { accept: 0 } : t.which === "TcpStream" ? { read: 1, write: 1 } : {};
    if (!(callee.name in methods)) {
      const has = t.which === "Semaphore" ? "it has 'acquire' and 'available'" : t.which === "Channel" ? "it has 'send', 'receive', 'close' and 'clone'"
        : t.which === "AbortController" ? "it has 'abort' and 'signal'" : t.which === "AbortSignal" ? "it has 'throwIfAborted' and 'aborted'"
        : t.which === "TcpListener" ? "it has 'accept' and 'port'" : t.which === "TcpStream" ? "it has 'read', 'write' and 'clone', and dropping it closes it" : "dropping it gives its slot back";
      throw new CompileError(`'${show(t)}' has no method '${callee.name}'; ${has}`, callee.start, callee.end);
    }
    if (linked(callee)) throw unsupported(`optional chains calling '${t.which}' methods`, callee);
    const signalled = waits && e.args.length === methods[callee.name]! + 1;
    if (e.args.length !== methods[callee.name] && !signalled) throw new CompileError(`'${callee.name}' takes ${methods[callee.name] === 1 ? "1 argument" : "no arguments"}${waits ? ", and may take an AbortSignal" : ""}`, e.start, e.end);
    if (signalled) signalArgument(e.args.at(-1)!, `'${callee.name}'`);
    // The std's own non-waiting send, which a promise's resolve and reject make.
    if (callee.name === "send" || callee.name === "settle") {
      const of = lower(t.of);
      expect(e.args[0]!, of);
      const given = value(e.args[0]!);
      coerce(e.args[0]!, given, of, `argument of type '${show(given)}' is not assignable to parameter of type '${show(of)}'`);
    }
    if (callee.name === "available") return { type: "i64", what: "'available'" };
    if (callee.name === "accept") return { type: leafFuture("accept", "void", socketError(signalled), signalled), what: "'accept'" };
    // `read(max)` gives at most max bytes, and `write(bytes)` takes its bytes to send them all.
    if (callee.name === "read" || callee.name === "write") {
      const want = callee.name === "read" ? "i64" : arrayType("u8");
      expect(e.args[0]!, want);
      const given = value(e.args[0]!);
      coerce(e.args[0]!, given, want, callee.name === "read" ? `'read' takes the most bytes to read as an 'i64', not '${show(given)}'` : `'write' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '${show(given)}'`);
      return { type: leafFuture(callee.name, "void", socketError(signalled), signalled), what: `'${callee.name}'` };
    }
    if (callee.name === "abort") return { type: "void", what: "'abort'" };
    if (callee.name === "throwIfAborted") {
      raise(e, abortError(), "'throwIfAborted'");
      return { type: "void", what: "'throwIfAborted'" };
    }
    if (callee.name === "close" || callee.name === "settle") return { type: "void", what: `'${callee.name}'` };
    return { type: leafFuture(callee.name as "acquire" | "send" | "receive", lower(t.of), signalled ? abortError() : undefined, signalled), what: `'${callee.name}'` };
  }

  // `AbortSignal.timeout(ms)`: a new signal that aborts itself after ms milliseconds. And
  // `AbortSignal.any(signals)`: one that aborts with the first of them, each lent to it.
  function signalStatic(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name === "any") return signalAny(e);
    if (callee.name !== "timeout") throw new CompileError(`'AbortSignal' has no static method '${callee.name}'; it has 'timeout' and 'any'`, callee.start, callee.end);
    // The std library's own code is compiled whatever main is; a sync main never reaches it.
    if (!ctx.runtime && e.start < STD_BASE) throw new CompileError("'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("'AbortSignal.timeout' takes how many milliseconds until it aborts, like 'AbortSignal.timeout(5000)'", e.start, e.end);
    expect(e.args[0]!, "i64");
    const t = value(e.args[0]!);
    coerce(e.args[0]!, t, "i64", `'AbortSignal.timeout' takes milliseconds as an 'i64', not '${show(t)}'`);
    return { type: blockType("AbortSignal"), what: "'AbortSignal.timeout'" };
  }

  // A literal list lends each signal, as a wait's is, so 'req.signal' stays the request's.
  function signalAny(e: Call): { type: Type; what: string } {
    const example = "like 'AbortSignal.any([a, b])'";
    if (e.args.length !== 1) throw new CompileError(`'AbortSignal.any' takes one list of signals, ${example}`, e.start, e.end);
    const list = e.args[0]!;
    const signal = blockType("AbortSignal");
    if (list.kind === "array") {
      for (const x of list.elements) {
        if (!x || x.kind === "spread") throw new CompileError(`'AbortSignal.any' takes its signals listed one by one, ${example}`, (x ?? list).start, (x ?? list).end);
        signalArgument(x, "'AbortSignal.any'");
      }
    } else {
      const given = value(list);
      coerce(list, given, refType(arrayType(signal), false), `'AbortSignal.any' takes a list of 'AbortSignal's, not '${show(given)}'`);
    }
    return { type: signal, what: "'AbortSignal.any'" };
  }

  // `TcpListener.bind(host, port)` and `TcpStream.connect(host, port)`: futures the async
  // runtime's reactor completes, throwing an `IoError` when the system says no.
  function tcpStatic(e: Call, callee: Extract<Expr, { kind: "member" }>, which: "TcpListener" | "TcpStream"): { type: Type; what: string } {
    const method = which === "TcpListener" ? "bind" : "connect";
    if (callee.name !== method) throw new CompileError(`'${which}' has no static method '${callee.name}'; it has '${method}'`, callee.start, callee.end);
    if (!ctx.runtime && e.start < STD_BASE) throw new CompileError(`'${which}.${method}' works only when 'main' is an async function, whose runtime waits on sockets`, e.start, e.end);
    // Connecting waits, so it may take an AbortSignal; binding doesn't.
    const signalled = method === "connect" && e.args.length === 3;
    if (e.args.length !== 2 && !signalled) throw new CompileError(`'${which}.${method}' takes a host address and a port, like '${which}.${method}("127.0.0.1", 8080)'${method === "connect" ? ", and may take an AbortSignal" : ""}`, e.start, e.end);
    if (signalled) signalArgument(e.args[2]!, `'${which}.${method}'`);
    const [host, port] = e.args as [Expr, Expr];
    expect(host, "string");
    const h = value(host);
    coerce(host, h, "string", `the host is a 'string' like "127.0.0.1", not '${show(h)}'`);
    expect(port, "i64");
    const p = value(port);
    coerce(port, p, "i64", `the port is an 'i64', not '${show(p)}'`);
    return { type: leafFuture(method, "void", socketError(signalled), signalled), what: `'${which}.${method}'` };
  }

  // The std `IoError` class, which failed socket calls throw.
  function ioError(): Type {
    return classes.get("IoError")!.type;
  }

  // What a socket's wait throws: an IoError, or an AbortError too when it was given a signal.
  function socketError(signalled: boolean): Type {
    return signalled ? unionType([ioError(), abortError()]) : ioError();
  }

  // A wait's AbortSignal, lent to it: the wait keeps a count on it of its own.
  function signalArgument(a: Expr, what: string) {
    const signal = blockType("AbortSignal");
    const given = value(a);
    coerce(a, given, refType(signal, false), `${what} takes an 'AbortSignal' to stop waiting early, not '${show(given)}'`);
  }

  // `new Promise<T>(executor)`, rewritten as the prelude's cell its executor settles, awaited.
  // T is written or the `Promise<T>` it meets; reject's error is its annotation's, or what the
  // function declares it throws, or `Error`.
  function promiseNew(e: Extract<Expr, { kind: "new" }>, list: Expr[]) {
    const example = "as in 'new Promise<i64>((resolve, reject) => resolve(1))'";
    if (list.length !== 1 || list[0]!.kind === "spread") throw new CompileError(`'new Promise' takes one executor, ${example}`, e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("'Promise' takes one type argument, what it gives", e.start, e.end);
    const executor = list[0]!;
    const expected = wanted.get(e);
    // A stored `Promise<T>`, or one a parameter takes, gives its T and can't throw; one awaited
    // where a T is wanted gives that T and may.
    const stored = expected === undefined ? undefined : promiseMet(expected);
    const gives = e.typeArgs[0] ? resolveType(e.typeArgs[0]) : stored ?? awaitedAs.get(e);
    if (gives === undefined) throw new CompileError(`can't tell what this Promise gives; write it, ${example}, since Fish has no 'unknown'`, e.start, e.end);
    const declared = executor.kind === "arrow" ? executor : executor.kind === "ident" && !lookup(executor.name) ? byName.get(executor.name) : undefined;
    const raw = declared === undefined ? lower(value(executor)) : undefined;
    const held = typeof raw !== "string" && raw?.kind === "param" && raw.bound?.kind === "function" ? raw.bound : raw;
    const fn = typeof held !== "string" && (held?.kind === "closure" || held?.kind === "function") ? held : held !== undefined && isCallable(held) ? callableOf.get((held as DynType).of) : undefined;
    if (declared === undefined && fn === undefined) throw new CompileError(`'new Promise' takes an executor, a function given 'resolve' and 'reject', ${example}; not '${show(held!)}'`, executor.start, executor.end);
    const async = declared?.async === true || (fn !== undefined && typeof fn.returns !== "string" && (fn.returns.kind === "future" || promiseElement(fn.returns.kind === "dyn" ? fn.returns.of : fn.returns) !== undefined));
    if (async) throw new CompileError("an executor runs at once, so it can't be async; call an async function that awaits and then calls 'resolve' instead", executor.start, executor.end);
    const takes = declared?.params.length ?? fn!.params.length;
    const rejects = takes >= 2;
    if (rejects && stored !== undefined) throw new CompileError(`a Promise stored as a '${show(expected!)}' can't throw yet, so its executor can't take 'reject'; await it where it is made, or resolve it with a value saying it failed`, executor.start, executor.end);
    // Reject's own type, written on the executor's parameter or in its signature.
    const annotated = declared?.params[1]?.type;
    const reason = annotated ? resolveType(annotated) : fn?.params[1];
    const signature = reason === undefined || typeof reason === "string" ? undefined : reason.kind === "function" ? reason : isCallable(reason) ? callableOf.get((reason as DynType).of) : undefined;
    if (reason !== undefined && signature?.params.length !== 1) throw new CompileError(`'reject' takes the error it fails with, as in 'reject: (reason: Error) => void', not '${show(reason)}'`, (annotated ?? executor).start, (annotated ?? executor).end);
    const error = signature?.params[0] ?? ctx.throwsDeclared() ?? classes.get("Error")!.type;
    const variant = `${rejects ? "" : " resolve"}${gives === "void" ? " void" : ""}`;
    const typeArgs = [...(gives === "void" ? [] : [presetNode(gives, e)]), ...(rejects ? [presetNode(error, e)] : [])];
    const at = { start: e.start, end: e.end };
    const cell: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: `promise cell${variant}`, ...at }, typeArgs, args: [executor], optional: false, ...at };
    Object.assign(e, { kind: "call", callee: { id: nextId(ids), kind: "ident", name: `promise await${variant}`, ...at }, typeArgs, args: [cell], optional: false });
    if (gives !== "void") {
      const resolves = rejects ? "" : " resolve";
      promiseVariants.set(cell, { name: `promise cell${resolves}`, typeArgs });
      promiseVariants.set(e, { name: `promise await${resolves}`, typeArgs });
    }
  }

  // The T of a `Promise<T>` a value meets, stored or taken by a parameter.
  function promiseMet(t: Type): Type | undefined {
    const held = typeof t !== "string" && t.kind === "param" ? t.bound : t;
    if (typeof held === "string" || held === undefined) return undefined;
    return held.kind === "dyn" ? promiseElement(held.of) : held.kind === "interface" ? promiseElement(held) : undefined;
  }

  // A type argument for a rewritten call, standing for a type already known.
  function presetNode(t: Type, at: Span): TypeNode {
    const made: TypeNode = { id: nextId(ids), kind: "ref", name: show(t), args: [], start: at.start, end: at.end };
    presetTypes.set(made, t);
    return made;
  }

  // `setTimeout(callback, ms)`, `setInterval` and their clears, rewritten as the std's timers.
  function timerCall(e: Call, name: string) {
    const at = { start: e.start, end: e.end };
    const helper = (named: string, args: Expr[]) => Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: named, start: e.callee.start, end: e.callee.end }, args, typeArgs: [] });
    if (e.typeArgs.length > 0) throw new CompileError(`'${name}' takes no type arguments`, e.start, e.end);
    if (e.args.some((a) => a.kind === "spread")) throw new CompileError(`'${name}' takes its arguments written out, not spread`, e.start, e.end);
    if (name === "clearTimeout" || name === "clearInterval") {
      if (e.args.length > 1) throw new CompileError(`'${name}' takes the timer to clear`, e.start, e.end);
      return helper("timeout clear", [e.args[0] ?? { id: nextId(ids), kind: "null", ...at }]);
    }
    if (e.args.length === 0) throw new CompileError(`'${name}' takes the function to run, then the milliseconds to wait`, e.start, e.end);
    if (!ctx.runtime && !ctx.async) throw new CompileError(`'${name}' can only be used inside an 'async' function here, where the runtime is running`, e.callee.start, e.callee.end);
    timerNames.set(e, name);
    if (e.args.length > 4) throw new CompileError(`'${name}' passes at most two arguments on to its function so far; pass the rest through an arrow, as in '${name}(() => f(a, b, c), ms)'`, e.args[4]!.start, e.args.at(-1)!.end);
    // What it passes on is captured when the timer is set, so each is a name or a literal, which
    // capturing then and reading later can't tell apart.
    const passed = e.args.slice(2);
    const plain = (x: Expr): boolean => ["ident", "int", "float", "bigint", "string", "bool", "null"].includes(x.kind) || (x.kind === "unary" && x.op === "-" && plain(x.operand));
    const odd = passed.find((x) => !plain(x));
    if (odd) throw new CompileError(`'${name}' passes on a name or a literal; give this value a name first, as in 'const v = ...; ${name}(f, ms, v)'`, odd.start, odd.end);
    // The callback runs inside an async arrow the timer keeps, which owns what it captures. It is
    // named or written in place, so making that arrow evaluates nothing early or late.
    const callback = e.args[0]!;
    if (callback.kind !== "arrow" && callback.kind !== "ident") throw new CompileError(`'${name}' takes a function written here or named, as in '${name}(() => tick(), ms)'; give this one a name first`, callback.start, callback.end);
    // An arrow's unwritten parameters take the types of what is passed, as TypeScript infers.
    if (callback.kind === "arrow") callback.params.forEach((p, i) => {
      if (!p.type && passed[i]) p.type = presetNode(widenLet(value(passed[i]!)), p);
    });
    const span = { start: callback.start, end: callback.end };
    // Each run passes its own copy of a value that doesn't copy, as each of node's runs passes it.
    const given = passed.map((x): Expr => (x.kind === "ident" && !isCopy(value(x)) ? { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: x, name: "clone", optional: false, start: x.start, end: x.end }, args: [], typeArgs: [], optional: false, start: x.start, end: x.end } : x));
    const run: Expr = { id: nextId(ids), kind: "call", callee: callback, args: given, typeArgs: [], optional: false, ...span };
    const body: Expr = givesPromise(callback) ? { id: nextId(ids), kind: "unary", op: "await", operand: run, ...span } : run;
    // An async arrow taking nothing is what the timer keeps, so its captures are made once.
    const own = callback.kind === "arrow" && callback.async && callback.params.length === 0 && Array.isArray(callback.body);
    const kept: Expr = own ? callback
      : { id: nextId(ids), kind: "arrow", move: false, async: true, typeParams: [], params: [], returnType: undefined, body: [{ id: nextId(ids), kind: "expr", expr: body, ...span }], ...span };
    const wrapper: Expr = givesPromise(callback) ? { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: "timer detached", ...span }, args: [kept], typeArgs: [], optional: false, ...span } : kept;
    timerWrappers.add(kept);
    if (!own) madeArrows.add(kept);
    const loop: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: "timer loop", ...at }, args: [], typeArgs: [], optional: false, ...at };
    const ms = e.args[1] ?? { id: nextId(ids), kind: "int", value: 0n, ...at };
    helper("timerSet", [wrapper, ms, { id: nextId(ids), kind: "bool", value: name === "setInterval", ...at }, loop]);
    timerSets.add(e);
  }

  // Whether a timer's callback gives a Promise to await: an async arrow or one whose body calls a
  // function that does, or a function or value that does.
  function givesPromise(callback: Expr): boolean {
    if (callback.kind === "arrow") {
      if (callback.async) return true;
      // A block body gives what its last statement returns.
      const last = Array.isArray(callback.body) ? callback.body.at(-1) : undefined;
      const given = Array.isArray(callback.body) ? (last?.kind === "return" ? last.value : undefined) : callback.body;
      return given?.kind === "call" && givesPromise(given.callee);
    }
    if (callback.kind !== "ident") return false;
    const local = lookup(callback.name);
    if (!local) {
      const f = byName.get(callback.name);
      return f?.async === true || (f?.returnType?.kind === "ref" && f.returnType.name === "Promise");
    }
    const held = lower(local.type);
    const fn = typeof held !== "string" && (held.kind === "closure" || held.kind === "function") ? held : isCallable(held) ? callableOf.get((held as DynType).of) : undefined;
    const returns = fn?.returns;
    return typeof returns !== "string" && returns !== undefined && (returns.kind === "future" || promiseMet(returns) !== undefined);
  }

  // `Promise.withResolvers<T>()`, rewritten as the prelude's cell with its promise and the
  // closures settling it; reject's error is what the function declares it throws, or `Error`.
  function promiseResolvers(e: Call) {
    if (e.args.length > 0) throw new CompileError("'Promise.withResolvers' takes no arguments", e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError("'Promise.withResolvers' takes one type argument, what its Promise gives", e.start, e.end);
    if (e.typeArgs.length === 0) throw new CompileError("can't tell what this Promise gives; write it, as in 'Promise.withResolvers<i64>()', since Fish has no 'unknown'", e.start, e.end);
    const gives = resolveType(e.typeArgs[0]!);
    const error = ctx.throwsDeclared() ?? classes.get("Error")!.type;
    const at = { start: e.start, end: e.end };
    Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: gives === "void" ? "promise with resolvers void" : "promise with resolvers", ...at }, typeArgs: [...(gives === "void" ? [] : [presetNode(gives, e)]), presetNode(error, e)] });
    if (gives !== "void") promiseVariants.set(e, { name: "promise with resolvers", typeArgs: e.typeArgs });
  }

  // `Promise.resolve(v)` and `Promise.reject(e)`, rewritten as the prelude's async functions
  // giving v or throwing e. Each gives the T it is written with or meets; a rejected one with
  // neither gives nothing.
  function promiseSettled(e: Call, name: "resolve" | "reject") {
    const at = { start: e.start, end: e.end };
    if (e.args.length > 1 || e.args[0]?.kind === "spread") throw new CompileError(`'Promise.${name}' takes ${name === "resolve" ? "the value it gives" : "the error it throws"}`, e.start, e.end);
    if (e.typeArgs.length > 1) throw new CompileError(`'Promise.${name}' takes one type argument, what it gives`, e.start, e.end);
    const expected = wanted.get(e);
    const met = (expected === undefined ? undefined : promiseMet(expected)) ?? awaitedAs.get(e);
    const written = e.typeArgs[0] ? resolveType(e.typeArgs[0]) : undefined;
    if (name === "resolve") {
      const gives = written ?? (e.args.length === 0 ? "void" : met);
      if (gives === "void" && e.args.length > 0) throw new CompileError("a 'Promise<void>' gives nothing, so 'Promise.resolve' takes no value for it", e.args[0]!.start, e.args[0]!.end);
      if (gives !== "void" && e.args.length === 0) throw new CompileError(`'Promise.resolve' takes the value it gives, of type '${show(gives!)}'`, e.start, e.end);
      const given = e.args.length > 0 ? value(e.args[0]!) : undefined;
      if (typeof given !== "string" && (given?.kind === "future" || given?.kind === "handle" || (given?.kind === "dyn" && promiseElement(given.of) !== undefined))) {
        throw new CompileError("'Promise.resolve' of a Promise would hold one Promise inside another, which Fish doesn't flatten; await it first, or use the Promise itself", e.args[0]!.start, e.args[0]!.end);
      }
      Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: gives === "void" ? "promise resolve void" : "promise resolve", ...at }, typeArgs: gives === "void" || gives === undefined ? [] : [presetNode(gives, e)] });
      return;
    }
    if (e.args.length === 0) throw new CompileError("'Promise.reject' takes the error it throws, as in 'Promise.reject(new Error(\"failed\"))'", e.start, e.end);
    const gives = written ?? met ?? "void";
    const reason = value(e.args[0]!);
    Object.assign(e, { callee: { id: nextId(ids), kind: "ident", name: gives === "void" ? "promise reject void" : "promise reject", ...at }, typeArgs: [...(gives === "void" ? [] : [presetNode(gives, e)]), presetNode(widenLet(reason), e)] });
    if (gives !== "void") promiseVariants.set(e, { name: "promise reject", typeArgs: e.typeArgs });
  }

  // The std `AbortError` class, which aborted work throws.
  function abortError(): Type {
    return classes.get("AbortError")!.type;
  }

  // Whether a value passes where a JS shape is wanted: a handle of a shape with its fields, or a
  // Fish value with them, converted; methods only a handle has.
  function takesShape(from: Type, shape: InterfaceType | ObjectType): boolean {
    return missingField(from, shape) === undefined;
  }

  // Why a value doesn't pass where a JS shape is wanted, said of the first field that fails.
  function missingField(from: Type, shape: InterfaceType | ObjectType): string | undefined {
    // A borrowed handle is the handle, counted again where it goes.
    if (isRefType(from) && jsShape(from.to)) from = from.to;
    const own = jsShape(from);
    if (own === shape) return undefined;
    // A pair of types met again while it is compared: handles' shapes referring to themselves
    // fit; a Fish type referring to itself has no value JS could take yet. Object types are
    // interned, so a nested value of another type is a pair of its own.
    const source = (own ?? from) as object;
    if (comparing.get(source)?.has(shape)) return own ? undefined : `'${show(from)}' refers to itself, which can't cross between Fish and JS yet`;
    if (!comparing.has(source)) comparing.set(source, new Set());
    comparing.get(source)!.add(shape);
    try {
      return shapeMisses(from, own, shape);
    } finally {
      comparing.get(source)!.delete(shape);
    }
  }

  function shapeMisses(from: Type, own: InterfaceType | ObjectType | undefined, shape: InterfaceType | ObjectType): string | undefined {
    const source = own ?? (typeof from !== "string" && (from.kind === "object" || from.kind === "class") && !isTuple(from) ? from : undefined);
    if (!source) return `a '${show(from)}' isn't an object`;
    if (!own && shape.kind === "interface" && shape.methods.length > 0) return `its methods come only with a value JS made`;
    // A handle of another shape has the methods this one declares, by name and types.
    if (own && shape.kind === "interface") {
      const methods = own.kind === "interface" ? own.methods : [];
      // A method fits as TypeScript's do: it may take fewer parameters, an extra one of its own
      // is optional, the wanted one's arguments pass for those it has, and what it gives passes for
      // what is wanted; a generic one is matched by its parameters' count.
      const same = (a: Method, b: Method) => {
        if (a.params.slice(b.params.length).some((p) => !isOption(p))) return false;
        if (a.generic || b.generic) return a.params.length === b.params.length;
        return a.params.every((p, i) => i >= b.params.length || passesJs(b.params[i]!, p)) && (b.returns === "void" || passesJs(a.returns, b.returns));
      };
      const lacking = shape.methods.find((m) => !methods.some((n) => n.name === m.name && same(n, m)));
      if (lacking) return methods.some((n) => n.name === lacking.name) ? `method '${lacking.name}' takes or gives other types` : `property '${lacking.name}' is missing`;
    }
    // A member Fish couldn't type that the shape declares is one only a handle of it has.
    const held = shape.kind === "interface" ? jsUntyped.get(shape) : undefined;
    const aside = [...(held ?? [])].filter(([, why]) => !jsOptional.has(why)).map(([n]) => n);
    const unseen = aside.find((n) => own?.kind !== "interface" || !(jsUntyped.get(own)?.has(n) ?? false));
    if (unseen !== undefined) return unseen.startsWith("[") ? `its ${unseen === "[index]" ? "index" : "call"} signature comes only with a value JS made` : `property '${unseen}' is missing`;
    // A Fish class's private fields stay its own.
    const fields = source.kind === "class" ? source.fields.filter((g) => (g.access ?? "public") === "public") : source.fields;
    for (const f of shape.fields) {
      const found = fields.find((g) => g.name === f.name);
      if (!found) {
        if (isOption(f.type)) continue;
        return `property '${f.name}' is missing`;
      }
      if (!passesJs(found.type, f.type)) return `property '${f.name}' is a '${show(found.type)}', not a '${show(f.type)}'`;
      const why = own ? undefined : uncrossable(found.type);
      if (why) return `property '${f.name}' is a '${show(found.type)}', which can't cross between Fish and JS yet: ${why}`;
    }
    return undefined;
  }

  // Whether a value passes where a package declares a type: as it fits it, or as a value JS takes
  // for it, inside unions and arrays too.
  function passesJs(from: Type, to: Type): boolean {
    if (isRefType(from) && typeof from.to !== "string" && from.to.kind === "block" && from.to.which === "JsValue") from = from.to;
    if (fits(from, to)) return true;
    // An integer is a number in JS, as a literal in an object for one is written.
    // ponytail: past 2^53 an integer loses precision, as it would in JS; refuse if that matters
    if (isInteger(from) && to === "f64") return true;
    if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => passesJs(m, to));
    if (typeof to === "string") return false;
    if (to.kind === "union") return to.members.some((m) => passesJs(from, m));
    if (to.kind === "array") return typeof from !== "string" && from.kind === "array" && passesJs(from.element, to.element);
    // A nested object becomes a new JS object as the one holding it does, so it takes a Fish value
    // of its shape the same way.
    const shape = jsShape(to) ?? (to.kind === "object" && !to.tuple ? to : undefined);
    if (shape) return takesShape(from, shape);
    return to.kind === "block" && to.which === "JsValue" && uncrossable(from) === undefined;
  }

  // Whether a type holds a JS handle or an any, where Fish values of other types pass.
  function holdsJs(t: Type): boolean {
    return holdsPart(t, (u) => typeof u !== "string" && u.kind === "block" && u.which === "JsValue");
  }

  // A shape's member Fish couldn't type, as the refusal of its declaration, noting this use.
  function untyped(shape: InterfaceType | ObjectType | undefined, name: string, at: Span): CompileError | undefined {
    const why = shape?.kind === "interface" ? jsUntyped.get(shape)?.get(name) : undefined;
    if (why && !why.note) why.note = { message: `'${name}' is used here`, start: at.start, end: at.end };
    return why;
  }

  // A type a handle's member gives or takes, refused when it can't cross between Fish and JS.
  function crossing(t: Type, what: string, at: Span): Type {
    // A generic body's definition holds placeholders, which each instance checks as what they are.
    if (holdsPart(t, (u) => typeof u !== "string" && u.kind === "param" && u.concrete === undefined)) return t;
    const why = t === "void" ? undefined : uncrossable(t);
    if (why) throw new CompileError(`${what} '${show(t)}', which can't cross between Fish and JS yet: ${why}`, at.start, at.end);
    return t;
  }

  // A JS handle's property, as its shape declares it, read from JS.
  function jsProperty(e: Extract<Expr, { kind: "member" }>, t: BlockType): Type {
    if (t.of === "void") {
      if (writing === e) throw new CompileError("writing a JS value's properties isn't supported yet; a 'JsValue' is read with 'get'", e.start, e.end);
      if (["get", "at", "has"].includes(e.name)) throw new CompileError(`'${e.name}' is a method of a 'JsValue'; call it, as in '${placeText(e)}(...)'`, e.start, e.end);
      throw new CompileError(`a 'JsValue' could be anything, as an 'unknown' could, so it has no property '${e.name}' to use; read one with '${placeText(e.object)}.get("${e.name}")'`, e.start, e.end);
    }
    const shape = jsShape(t);
    const found = shape?.fields.find((f) => f.name === e.name);
    if (found) {
      jsMembers.add(e);
      // A callback or a Promise goes to JS when written, but Fish has no reading of one back.
      const kept = (u: Type) => typeof u !== "string" && u.kind === "dyn" && keptByJs(u);
      if (writing !== e && holdsPart(found.type, kept)) {
        const promise = holdsPart(found.type, (u) => kept(u) && promiseElement((u as DynType).of) !== undefined);
        throw new CompileError(`reading property '${e.name}' of '${show(t)}' isn't supported yet: it holds a ${promise ? "Promise" : "function"}, which Fish can give JS but not read back`, e.start, e.end);
      }
      return crossing(jsView(found.type), `property '${e.name}' of '${show(t)}' is a`, e);
    }
    const method = shape?.kind === "interface" && shape.methods.some((m) => m.name === e.name);
    if (method) throw new CompileError(`'${e.name}' is a method of '${show(t)}'; call it, as in '${placeText(e)}(...)'`, e.start, e.end);
    throw untyped(shape, e.name, e) ?? new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(t)}'`, e.start, e.end);
  }

  // `v.get(key)` and `v.at(i)` read a property or an element of a JsValue, and `v.has(key)` tests
  // for one.
  function jsAccessor(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const name = callee.name;
    const takes = ({ get: "string", has: "string", at: "i64" } as Record<string, Type>)[name];
    if (!takes) throw new CompileError(`a 'JsValue' has no method '${name}': its own are 'get', 'at' and 'has', and it is narrowed with 'typeof' to read it`, callee.start, callee.end);
    const what = takes === "i64" ? "an index, as an 'i64'" : "a key, as a 'string'";
    if (e.args.length !== 1) throw new CompileError(`'${name}' takes ${what}`, e.start, e.end);
    expect(e.args[0]!, takes);
    const given = value(e.args[0]!);
    coerce(e.args[0]!, given, takes, `'${name}' takes ${what}, not '${show(given)}'`);
    jsAccessors.add(e);
    return { type: name === "has" ? "boolean" : blockType("JsValue"), what: `'${name}'` };
  }

  // A JS handle's method, called with its declared parameters.
  function jsMethodCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: BlockType): { type: Type; what: string } {
    if (t.of === "void") return jsAccessor(e, callee);
    const shape = jsShape(t);
    const method = shape?.kind === "interface" ? shape.methods.find((m) => m.name === callee.name) : undefined;
    if (!method) {
      const field = shape?.fields.some((f) => f.name === callee.name);
      throw untyped(shape, callee.name, callee) ?? new CompileError(field ? `'${callee.name}' is a property of '${show(t)}', not a method` : `property '${shownName(callee.name)}' does not exist on type '${show(t)}'`, callee.start, callee.end);
    }
    jsMethods.add(e);
    // A generic one is typed for the call's type arguments, written or inferred.
    if (method.generic) {
      // An optional parameter left out is undefined, as JS gives it.
      while (e.args.length < method.params.length && isOption(method.params[e.args.length]!)) e.args.push({ id: nextId(ids), kind: "null", start: e.end, end: e.end });
      jsCrossings.add(e);
      jsOptionalOf.set(e, method.optional ?? []);
      const typed = familyCall(e, { kind: "function", name: method.name, names: [], params: method.params, returns: method.returns, fields: [], generic: method.generic }, `'${callee.name}'`);
      e.args.forEach((a) => crossing(types.get(a) ?? "void", `'${callee.name}' of '${show(t)}' is given a`, a));
      return { type: crossing(typed.type === "void" ? "void" : jsView(typed.type), `'${callee.name}' of '${show(t)}' gives a`, e), what: typed.what };
    }
    // A callback or a Promise it takes is one JS keeps, and an object type a JS object's shape.
    const params = method.params.map(jsTakes);
    params.forEach((p) => crossing(p, `'${callee.name}' of '${show(t)}' takes a`, e));
    jsArgs(e, params, method.optional ?? []);
    return { type: crossing(method.returns === "void" ? "void" : jsView(method.returns), `'${callee.name}' of '${show(t)}' gives a`, e), what: `'${callee.name}'` };
  }

  // The signature of a package's function a call takes: the first, in the order declared, whose
  // parameters the arguments pass for; a generic one is taken on the count of its arguments.
  function jsOverload(e: Call, first: Body): Body {
    const signatures = [first, ...first.js!.overloads!.map((f) => jsBodies.get(f)!)];
    if (e.args.some((a) => a.kind === "arrow" || a.kind === "spread")) return first;
    const given = e.args.map((a) => value(a));
    // In a generic body's definition an argument may be a placeholder: each instance picks again.
    const open = given.some((t) => holdsPart(t, (u) => typeof u !== "string" && u.kind === "param" && u.concrete === undefined));
    const fitting = signatures.find((f) => {
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (given.length < required || (given.length > f.params.length && !f.params.at(-1)?.rest)) return false;
      if ((f.typeParams?.length ?? 0) > 0 || open) return true;
      return given.every((t, i) => {
        const p = f.params[Math.min(i, f.params.length - 1)]!;
        const declared = p.type ? resolveType(p.type) : blockType("JsValue");
        return passesJs(t, p.optional ? unionType([declared, "null"]) : declared);
      });
    });
    if (fitting) return fitting;
    const shown = signatures.map((f) => `(${f.params.map((p) => `${(p.pattern as { name?: string }).name ?? "_"}${p.optional ? "?" : ""}: ${p.type ? show(resolveType(p.type)) : "any"}`).join(", ")})`).join(", ");
    throw new CompileError(`no signature of '${first.js!.name}' takes (${given.map(show).join(", ")}); it takes ${shown}`, e.start, e.end);
  }

  // The overload a call takes: the first, in the order declared, whose parameters its arguments
  // pass for, as TypeScript picks one. A generic one is taken on the count of its arguments.
  function overload(e: Call, impl: Body): Body {
    const spread = e.args.find((a) => a.kind === "spread");
    if (spread) throw new CompileError(`spreading arguments into the overloaded '${impl.name}' isn't supported yet; pass them one by one`, spread.start, spread.end);
    const given = e.args.map((a) => (a.kind === "arrow" ? undefined : tried(a)));
    const fitting = impl.overloads!.find((f) => {
      const required = f.params.filter((p) => !p.optional && !p.rest).length;
      if (e.args.length < required || (e.args.length > f.params.length && !f.params.at(-1)?.rest)) return false;
      const types = signatureTypes(f);
      return types === undefined || e.args.every((a, i) => passes(a, given[i], types[Math.min(i, types.length - 1)]!, f.params[Math.min(i, f.params.length - 1)]!));
    });
    if (fitting) return fitting;
    const shown = impl.overloads!.map((f) => {
      const types = signatureTypes(f);
      // A destructured parameter, named only to be passed on, shows as its type alone.
      const params = f.params.map((p, i) => {
        const name = (p.pattern as { name?: string }).name ?? "_";
        const type = types ? show(types[i]!) : "_";
        return name.startsWith("argument ") ? type : `${p.rest ? "..." : ""}${name}${p.optional ? "?" : ""}: ${type}`;
      });
      return `(${params.join(", ")}): ${f.returnType ? show(resolveType(f.returnType)) : "_"}`;
    });
    const args = given.map((t) => (t === undefined ? "a function" : show(t)));
    throw new CompileError(`no overload of '${impl.name}' takes (${args.join(", ")}); its overloads are ${shown.join(", ")}`, e.start, e.end);
  }

  // What an overload's body gives back: the implementation's value, as the members of its type the
  // signature's return type takes; codegen panics on any other.
  function narrowedReturn(call: Expr, node: TypeNode): Type {
    const from = value(call);
    const to = resolveType(node);
    if (fits(from, to)) return from;
    const kept = typeof from !== "string" && from.kind === "union" ? from.members.filter((m) => fits(m, to)) : [];
    if (kept.length === 0 && fits(to, from)) throw new CompileError(`it returns '${show(to)}', narrower than the implementation's '${show(from)}', which isn't a union whose members it could be narrowed to; give the implementation a union return type, as in '${show(to)} | ...'`, node.start, node.end);
    if (kept.length === 0) throw new CompileError(`this overload signature is not compatible with its implementation, which returns '${show(from)}', never a '${show(to)}'`, node.start, node.end);
    return kept.length === 1 ? kept[0]! : unionType(kept);
  }

  // An argument's type before it meets a parameter, or nothing when it needs one to be typed.
  function tried(a: Expr): Type | undefined {
    try {
      return value(a);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A signature's parameter types, unless it is generic, when each call's instance decides them.
  function signatureTypes(f: Body): Type[] | undefined {
    if ((f.typeParams ?? []).some((p) => !isLifetime(p)) || f.params.some((p) => p.comptime)) return undefined;
    const bounds = implicitOf(f);
    const known = bounds.size > 0 ? undefined : paramTypes(instanceOf(f));
    return f.params.map((p, i) => {
      const t = bounds.get(i) ?? known![i]!;
      return p.optional ? unionType([t, "null"]) : p.rest && isArray(lower(t)) ? (lower(t) as ArrayType).element : t;
    });
  }

  // Whether an argument passes for a parameter, as choosing an overload asks before the call
  // checks it against the one chosen.
  function passes(a: Expr, given: Type | undefined, to: Type, p: Param): boolean {
    if (a.kind === "arrow") return arrowPasses(a, to);
    if (given === undefined) return true;
    if (fits(given, to)) return true;
    if (isRefType(to)) return passes(a, isRefType(given) ? given.to : given, to.to, p);
    if (isRefType(given)) return passes(a, given.to, to, p);
    const n = numberLiteral(a);
    if (typeof to === "string") {
      if (n === undefined || !isNumeric(to)) return false;
      if (isFloat(to)) return true;
      return typeof n === "bigint" && isInteger(to) && n >= range(to)[0] && n <= range(to)[1];
    }
    if (to.kind === "union") return to.members.some((m) => passes(a, given, m, p));
    if (to.kind === "interface") return unsatisfied(given, to, members, a) === undefined;
    if (to.kind === "literal") return (a.kind === "string" || a.kind === "bool") ? a.value === to.value : n !== undefined && n === to.value;
    return false;
  }

  // Whether an arrow passes for a function type: no more parameters than it takes, each one
  // written with a type taking what it is given. Without a function type, the call decides.
  function arrowPasses(a: Extract<Expr, { kind: "arrow" }>, to: Type): boolean {
    if (typeof to !== "string" && to.kind === "union") return to.members.some((m) => arrowPasses(a, m));
    if (typeof to === "string" || to.kind !== "function" || to.generic) return true;
    if (a.params.length > to.params.length) return false;
    return a.params.every((q, i) => {
      if (!q.type) return true;
      const written = tryType(q.type);
      return written === undefined || fits(to.params[i]!, written);
    });
  }

  function tryType(t: TypeNode): Type | undefined {
    try {
      return resolveType(t);
    } catch (err) {
      if (err instanceof CompileError) return undefined;
      throw err;
    }
  }

  // A numeric literal's value, negated or not: a bigint for an integer, a number for a float.
  function numberLiteral(a: Expr): bigint | number | undefined {
    if (a.kind === "int") return a.value;
    if (a.kind === "float") return a.value;
    if (a.kind === "unary" && a.op === "-") {
      const n = numberLiteral(a.operand);
      return n === undefined ? undefined : -n;
    }
    return undefined;
  }

  // A call's arguments against a JS declaration's parameters: a trailing Option may be left out,
  // as an optional parameter.
  function jsArgs(e: Call | Extract<Expr, { kind: "new" }>, params: Type[], optional: boolean[]) {
    jsCrossings.add(e);
    jsOptionalOf.set(e, optional);
    const list = e.args ?? [];
    let required = params.length;
    while (required > 0 && isOption(params[required - 1]!)) required--;
    if (list.length < required || list.length > params.length) {
      const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
      throw new CompileError(`expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${list.length}`, e.start, e.end);
    }
    list.forEach((a, i) => {
      if (a.kind === "spread") throw new CompileError("spreading arguments into a package's functions isn't supported yet", a.start, a.end);
      expect(a, params[i]!);
      const given = value(a);
      coerce(a, given, params[i]!, `argument of type '${show(given)}' is not assignable to parameter of type '${show(params[i]!)}'`);
      givenToJs(a, given);
    });
  }

  // A value given to JS, which the call or write converts: refused when it has no JS form.
  function givenToJs(a: Expr, given: Type) {
    jsGiven.add(a);
    // A type parameter is what it stands for in this instance.
    while (typeof given !== "string" && given.kind === "param" && given.concrete !== undefined) given = given.concrete;
    // A callback given to JS is kept by JS, which may call it later from whichever task calls
    // into JS next, so what it holds goes with it to any thread.
    // A future given to JS is a promise, running as a task from when it is given.
    if (typeof given !== "string" && (given.kind === "future" || given.kind === "handle")) {
      if (!ctx.async) throw new CompileError("a Promise given to JS starts running as a task when it is given, so it is given only inside an 'async' function", a.start, a.end);
      const blocker = unsent(given);
      if (blocker) throw new CompileError(`a Promise given to JS runs as a task of its own, so it must own everything it uses; it holds a '${show(blocker)}'`, a.start, a.end);
      return;
    }
    if (typeof given !== "string" && (given.kind === "closure" || given.kind === "function" || given.kind === "dyn")) {
      const blocker = unsent(given);
      if (blocker) throw new CompileError(`a callback given to JS must own everything it uses, as JS may keep it and call it from another task; it holds a '${show(blocker)}'`, a.start, a.end);
      return;
    }
    // JS keeps a callback or a future, so one only borrowed here can't be given; one inside
    // another value would be dropped by Fish as well as kept by JS.
    if (isRefType(given) && keptByJs(given.to)) throw new CompileError("JS keeps a callback or a Promise given to it, so it is given owned, not borrowed; give it a clone, or take it owned", a.start, a.end);
    if (holdsPart(given, (u) => u !== given && keptByJs(u))) throw new CompileError("a callback or a Promise inside another value isn't supported yet; give it to JS on its own", a.start, a.end);
    const open = holdsPart(given, (u) => typeof u !== "string" && u.kind === "param" && u.concrete === undefined);
    if (!open && !jsConverts(given)) throw new CompileError(`a '${show(given)}' has no JS form yet, so it can't be given to JS`, a.start, a.end);
  }

  // A package's declared parameters as Fish types: an optional one is an Option.
  function jsParams(params: Param[]): Type[] {
    return params.map((p) => {
      const declared = jsTakes(p.type ? resolveType(p.type) : blockType("JsValue"));
      return p.optional ? unionType([declared, "null"]) : declared;
    });
  }

  // `new C(...)` of a package's class: its constructor's parameters, giving a handle.
  function jsNew(e: Extract<Expr, { kind: "new" }>, c: Interface): Type {
    if (c.typeParams.length > 0) throw unsupported("generic classes of a package", e);
    const constructor = jsChain(c).find((k) => k.jsClass!.constructors.length > 0)?.jsClass!.constructors[0] ?? [];
    const params = jsParams(constructor);
    params.forEach((p) => crossing(p, `'${c.name}''s constructor takes a`, e));
    jsArgs(e, params, constructor.map((p) => p.optional));
    jsNews.set(e, c.js!);
    return resolveType({ id: nextId(ids), kind: "ref", name: c.name, args: [], start: e.start, end: e.end });
  }

  // A package's class and the classes it extends, nearest first: a class without its own
  // constructor takes its base's, and inherits its statics, as in JS.
  function jsChain(c: Interface): Interface[] {
    const chain = [c];
    for (let at = c; ; ) {
      const base = at.extends[0]?.kind === "ref" ? jsClasses.get(at.extends[0].name) : undefined;
      if (!base || chain.includes(base)) return chain;
      chain.push(base);
      at = base;
    }
  }

  // A package's class's static member: a property read, or a method called.
  function jsStatic(c: Interface, name: string, at: Expr): TypeMember {
    const found = jsChain(c).flatMap((k) => k.jsClass!.statics).find((m) => "name" in m && m.name === name);
    if (!found) throw new CompileError(`property '${name}' does not exist on '${c.name}'`, at.start, at.end);
    jsStatics.set(at, c.js!);
    return found;
  }

  // `c.signal` on a controller, another handle to its signal, and `signal.aborted`, whether
  // its controller has aborted: values computed by the runtime, not fields.
  function blockProperty(e: Extract<Expr, { kind: "member" }>, t: BlockType): Type {
    if (linked(e)) throw unsupported(`optional chains through '${t.which}' values`, e);
    computed.add(e);
    if (t.which === "JsValue") return jsProperty(e, t);
    if (t.which === "AbortController" && e.name === "signal") return blockType("AbortSignal");
    if (t.which === "AbortSignal" && e.name === "aborted") return "boolean";
    if (t.which === "TcpListener" && e.name === "port") return "i64";
    throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(t)}'`, e.start, e.end);
  }

  // `shared(v)`: v moved into a new counted block, of its type argument, the type expected of
  // it, or else v's own type.
  function sharedNew(e: Call): { type: Type; what: string } {
    if (e.args.length !== 1 || e.typeArgs.length > 1) throw new CompileError("'shared' takes the value it starts with, as in 'shared({ hits: 0 })'", e.start, e.end);
    const expected = wanted.get(e);
    const given = e.typeArgs[0] ? heldArgument(resolveType(e.typeArgs[0])) : typeof expected !== "string" && expected?.kind === "shared" ? expected.of : undefined;
    const a = e.args[0]!;
    if (given) expect(a, given);
    const t = value(a);
    const of = given ?? heldArgument(widenLet(t));
    coerce(a, t, of, `argument of type '${show(t)}' is not assignable to parameter of type '${show(of)}'`);
    return { type: shareable(typing, of, e), what: "'shared'" };
  }

  // A shared value's `update`, a Lock's: the callback changes the value under the block's lock.
  function sharedCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: SharedType): { type: Type; what: string } {
    const inner = lower(t.of);
    const stored = typeof inner !== "string" && (inner.kind === "object" || inner.kind === "class") ? field(inner, callee.name) : undefined;
    if (stored && isCallable(lower(stored.type))) return callableCall(e, callee, lower(stored.type) as DynType);
    if (callee.name !== "update") throw new CompileError(`'shared' has no method '${callee.name}'; read its fields, change it with 'update', or share it again with 'clone'`, callee.start, callee.end);
    return lockCall(e, callee, interiorType("Lock", t.of), true);
  }

  // `s.f` on a shared value: an interior-mutable field is borrowed where it lives, unlocked,
  // since it changes only through its own methods; any other is copied out under the lock.
  function sharedField(e: Extract<Expr, { kind: "member" }>, t: SharedType): Type {
    if (linked(e)) throw unsupported("optional chains through shared values", e);
    const inner = lower(t.of);
    if (typeof inner !== "string" && inner.kind === "class") classOf(inner);
    const found = typeof inner === "string" || inner.kind === "closure" ? undefined : field(inner, e.name);
    if (!found) throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(t)}'${didYouMean(e.name, memberNames(inner))}`, e.start, e.end);
    if (typeof inner !== "string" && inner.kind === "class") visible(found.access, declaring(inner, e.name), e.name, e);
    // A Rust value is reached only under the lock, and a read here would copy its handle out.
    let rust: RustClass | undefined;
    if (holdsPart(found.type, (u) => (rust ??= rustClassOf(u)) !== undefined)) {
      throw new CompileError(`'${e.name}' holds a Rust '${rust!.name}', which a shared value gives only inside 'update', as in 's.update((v) => v.${e.name}...)'`, e.start, e.end);
    }
    if (!interiorMutable(found.type)) ctx.copiesOut.add(e);
    return found.type;
  }

  // `lock.update(v => ...)`: the callback changes what the lock holds while it is locked, and
  // gives what the callback gives. A closure can't return a reference, so nothing it gives
  // borrows from the value once the lock is released.
  function lockCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: InteriorType, sharing = false): { type: Type; what: string } {
    if (callee.name !== "update") throw new CompileError(`'Lock' has no method '${callee.name}'; 'update' runs a callback with what it holds`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling 'Lock' methods", callee);
    if (e.args.length !== 1) throw new CompileError("'update' takes 1 argument, a callback like 'v => ...'", e.start, e.end);
    const callback = e.args[0]!;
    if (callback.kind !== "arrow") throw unsupported("callbacks passed to 'update' by name; write the arrow function in place", callback);
    const held = refType(lower(t.of), true);
    const signature = functionType(["value"], [held], "void");
    lockCallbacks.add(signature);
    if (sharing) sharedCallbacks.add(signature);
    expect(callback, signature);
    const c = value(callback);
    if (typeof c === "string" || c.kind !== "closure" || c.params.length > 1) throw new CompileError(`'update' passes its callback a '${show(held)}'`, callback.start, callback.end);
    if (c.params[0] !== undefined) passedExactly("update", held, c.params[0], callback.kind === "arrow" ? callback.params[0] : undefined, callback);
    return { type: c.returns, what: "'update'" };
  }

  // `await p`: the future runs to completion, the async function stopping while it is pending,
  // and gives its value, or raises its error as a call would. It moves into the await.
  function awaited(e: Extract<Expr, { kind: "unary" }>): Type {
    if (ctx.locked) throw new CompileError("'update' holds its lock while the callback runs, so the callback can't 'await': every task needing the lock would wait too; finish the update, then await", e.start, e.end);
    if (!ctx.async || ctx.syncMain) throw new CompileError("'await' can only be used inside an 'async' function", e.start, e.end);
    if (!ctx.awaitable.has(e)) throw new CompileError("'await' inside an expression isn't supported yet; give its value a name first, as in 'const x = await ...;'", e.start, e.end);
    awaitedNow.add(e.operand);
    let t = value(e.operand);
    // Through a bound: in an instance, the concrete method's own future; in the definition, what
    // the bound's `Promise<T>` gives.
    if (typeof t !== "string" && t.kind === "param" && t.concrete) t = t.concrete;
    const promise = typeof t !== "string" && t.kind === "param" ? t.bound : t;
    const described = typeof promise !== "string" && promise?.kind === "interface" ? promiseElement(promise) : undefined;
    if (described !== undefined && typeof t !== "string" && (t.kind === "interface" || t.kind === "param")) return described;
    if (typeof t !== "string" && (t.kind === "param" || t.kind === "interface")) throw unsupported("awaits of 'Promise<T>' parameters", e.operand);
    if (typeof t !== "string" && t.kind === "dyn" && promiseElement(t.of) !== undefined) return promiseElement(t.of)!;
    if (typeof t === "string" || (t.kind !== "future" && t.kind !== "handle")) throw new CompileError(`'await' needs a Promise, like an async function's call, not '${show(t)}'`, e.operand.start, e.operand.end);
    if (t.throws) raise(e, t.throws, "this Promise");
    return t.gives;
  }

  // `Promise.all`, `race`, `allSettled` and `any`: one future awaiting those in the list at once,
  // in this task. It is awaited where it is made, so the futures' borrows end with the await.
  function combined(e: Call, kind: Combiner): { type: Type; what: string } {
    const name = `'Promise.${kind}'`;
    if (e.optional) throw new CompileError(`${name} is always there, so it is called without '?.'`, e.start, e.end);
    if (!awaitedNow.has(e)) throw new CompileError(`${name} is awaited where it is called, as in 'await Promise.${kind}([a(), b()])'`, e.start, e.end);
    const [list] = e.args;
    if (e.args.length !== 1 || list === undefined || list.kind === "spread") throw new CompileError(`${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])'`, e.start, e.end);
    // An array of `Promise<T>` values gives a `T[]`, or for `race` a `T`.
    if (list.kind !== "array") {
      const t = value(list);
      const element = typeof t !== "string" && t.kind === "array" ? t.element : undefined;
      if (typeof element === "string" || element?.kind !== "dyn" || promiseElement(element.of) === undefined) throw new CompileError(`${name} takes an array of Promises, as in 'Promise.${kind}([a(), b()])' or a 'Promise<T>[]', not '${show(t)}'`, list.start, list.end);
      combinedCalls.add(e);
      // Boxed futures throw nothing, so an `any` over them fails only when the array is empty,
      // with no errors, typed as null.
      return { type: combinedFuture({ kind, futures: [], array: t as ArrayType, aggregate: kind === "any" ? aggregateOf("null", e) : undefined, at: e }), what: name };
    }
    if (list.elements.length === 0) throw new CompileError(`${name} needs a Promise to wait for${kind === "race" ? "; an empty race never settles" : ""}`, list.start, list.end);
    const futures = list.elements.map((x) => {
      if (x === undefined || x.kind === "spread") throw new CompileError(`${name} takes each Promise written in the list`, (x ?? list).start, (x ?? list).end);
      if (x.kind === "call" && x.callee.kind === "member" && x.callee.object.kind === "ident" && x.callee.object.name === "Promise" && COMBINERS.includes(x.callee.name) && !lookup("Promise") && !classes.has("Promise")) {
        throw new CompileError(`'Promise.${(x.callee as { name: string }).name}' can't be in another Promise's list; give it an async function of its own, as in 'async function both() { return await Promise.all([...]); }', and put its call in the list`, x.start, x.end);
      }
      let t = value(x);
      if (typeof t !== "string" && t.kind === "param" && t.concrete) t = t.concrete;
      if (typeof t !== "string" && t.kind === "dyn" && promiseElement(t.of) !== undefined) return t;
      if (typeof t === "string" || (t.kind !== "future" && t.kind !== "handle")) throw new CompileError(`${name} takes Promises, like an async function's call, not '${show(t)}'`, x.start, x.end);
      return t;
    });
    // An `any` fails only when every future can, with all their errors.
    const thrown = futures.map((f) => (f.kind === "dyn" ? undefined : f.throws));
    const aggregate = kind === "any" && thrown.every((x) => x !== undefined) ? aggregateOf(unionType(thrown as Type[]), e) : undefined;
    const type = combinedFuture({ kind, futures, aggregate, at: e });
    combinedCalls.add(e);
    return { type, what: name };
  }

  // The prelude's `AggregateError<E>` for errors of type `E`.
  function aggregateOf(errors: Type, at: Span): ClassType {
    return construct("AggregateError", [], [arrayType(errors)], at)!.type as ClassType;
  }

  // What keeps a value from moving to another thread: a reference, which borrows from the
  // thread that made it, a raw pointer, which nothing checks, or a Cell, which changes unlocked.
  function unsent(t: Type, seen: Set<Type> = new Set<Type>()): Type | undefined {
    // A type holding itself is looked into once.
    if (typeof t === "string" || seen.has(t)) return undefined;
    seen.add(t);
    if (t.kind === "ref" || t.kind === "pointer" || (t.kind === "interior" && t.which === "Cell") || (t.kind === "dyn" && borrowing.has(t.of))) return t;
    // A Rust type is Send, which the shim asserts.
    if (rustClassOf(t)) return undefined;
    const parts = t.kind === "interior" ? [t.of] : t.kind === "future" || t.kind === "generator" ? t.params.map((f) => f.type)
      : t.kind === "union" ? t.members : t.kind === "array" || t.kind === "fixed" ? [t.element] : t.kind === "map" ? [t.key, t.value] : t.kind === "class" && t.base ? [t.base, ...t.fields.map((f) => f.type)] : t.fields.map((f) => f.type);
    for (const part of parts) {
      const found = unsent(part, seen);
      if (found) return found;
    }
    return undefined;
  }

  // `g.next()` runs a generator to its next `yield`, changing it, so it needs a place. An async
  // generator's gives a future borrowing it, awaited where it is made so the borrow ends there.
  function generatorCall(e: Call, callee: Extract<Expr, { kind: "member" }>, generator: Type, yields: Type, async = false): { type: Type; what: string } {
    if (!async && Object.hasOwn(GENERATOR_HELPERS, callee.name)) return helperCall(e, callee, yields);
    if (callee.name !== "next") throw new CompileError(`generators have no method '${callee.name}' yet${didYouMean(callee.name, async ? ["next"] : ["next", ...Object.keys(GENERATOR_HELPERS)])}`, callee.start, callee.end);
    if (async && !awaitedNow.has(e)) throw new CompileError("an async generator's 'next()' is awaited where it is called, as in 'await g.next()'", e.start, e.end);
    if (linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    if (e.args.length > 0) throw unsupported("values sent into 'next'", e.args[0]!);
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, generator);
    if (!place(callee.object)) throw new CompileError("'next' changes its generator, so call it on a variable or a field", callee.start, callee.end);
    changeable(callee.object, "advance");
    if (!async) return { type: nextResult(yields), what: "'next'" };
    const made = typeof generator !== "string" && generator.kind === "param" && generator.concrete ? generator.concrete : generator;
    return { type: typeof made !== "string" && made.kind === "generator" ? leafFuture("next", made) : promiseInterface(nextResult(yields)), what: "'next'" };
  }

  // The iterator helpers call std's generators and functions over the generator, which they take
  // over. `map`, `filter`, `take`, `drop` and `flatMap` give a generator that pulls from it only
  // when pulled; the rest run it at once. Callbacks get each value and its index, the predicates
  // a borrow of the value.
  function helperCall(e: Call, callee: Extract<Expr, { kind: "member" }>, yields: Type): { type: Type; what: string } {
    const name = callee.name;
    const source = callee.object;
    if (linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    if (e.typeArgs.length > 0) throw new CompileError(`'${name}' takes no type arguments`, e.start, e.end);
    if (isRefType(types.get(source)!)) throw new CompileError(`'${name}' takes its generator over, and this one is borrowed; call it on a generator this code owns`, source.start, source.end);
    once.add(source);
    const at = { start: e.start, end: e.end };
    const helper = (helperName: string, args: Expr[]): Call => ({ id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: helperName, ...at }, args, typeArgs: [], optional: false, shown: name, ...at }) as Call;
    // A count or a fold that can't give a value panics at the call, with JavaScript's reason.
    const unwrap = (expr: Expr, reason: string): Expr => ({ id: nextId(ids), kind: "nonNull", expr, reason, ...at }) as Expr;
    const counted = name === "take" || name === "drop";
    if (name === "toArray" ? e.args.length !== 0 : name === "reduce" ? e.args.length < 1 || e.args.length > 2 : e.args.length !== 1) {
      const takes = name === "toArray" ? "no arguments" : counted ? "1 argument, a count" : name === "reduce" ? "a callback and an optional initial value" : "1 argument, a callback like 'x => ...'";
      throw new CompileError(`'${name}' takes ${takes}`, e.start, e.end);
    }
    if (name === "toArray") {
      Object.assign(e, helper("array collect", [source]));
      return call(e);
    }
    if (counted) {
      Object.assign(e, helper(GENERATOR_HELPERS[name]!, [source, unwrap(helper("iter count", [e.args[0]!]), `'${name}''s count can't be negative`)]));
      return call(e);
    }
    const [callback, init] = e.args as [Expr, Expr | undefined];
    // A declared function given by name becomes an arrow calling it, as for array methods.
    namedFunction(callback);
    const reducing = name === "reduce";
    const lent = PREDICATES.has(name);
    const each = lent ? refType(yields, false) : yields;
    const acc = !reducing ? undefined : init ? widenLet(value(init)) : yields;
    if (init) once.add(init);
    const params = acc ? [acc, each, "i64" as const] : [each, "i64" as const];
    if (callback.kind === "arrow" && callback.params.length > params.length) {
      throw new CompileError(`'${name}' passes its callback ${acc ? "the accumulator, " : ""}the value and its index`, callback.params[params.length]!.start, callback.params[params.length]!.end);
    }
    const names = acc ? ["accumulator", "value", "index"] : ["value", "index"];
    // std calls the callback with every argument, so an arrow leaving some out takes them under
    // names no program can write.
    if (callback.kind === "arrow") {
      for (let i = callback.params.length; i < params.length; i++) {
        const pattern = { id: nextId(ids), kind: "ident" as const, name: `_ ${names[i]}`, start: callback.start, end: callback.start };
        callback.params.push({ id: nextId(ids), pattern, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, start: callback.start, end: callback.start });
      }
    }
    // std lends a predicate even a value that copies; a function taking the copy reads it there.
    if (callback.kind === "arrow" && lent && isCopy(yields) && presetParams.get(callback.params[0]!) === yields) presetParams.delete(callback.params[0]!);
    expect(callback, functionType(names, params, "void"));
    const c = value(callback);
    once.add(callback);
    if (typeof c === "string" || c.kind !== "closure") throw new CompileError(`'${name}' takes a callback like 'x => ...'`, callback.start, callback.end);
    c.params.forEach((p, i) => passedExactly(name, params[i]!, p, callback.kind === "arrow" ? callback.params[i] : undefined, callback, i !== params.length - 1));
    runsOften(c, name, "its callback once per value", callback);
    const gives = c.returns;
    if (lent && gives !== "boolean") {
      throw new CompileError(`'${name}''s callback has to give a 'boolean', since Fish has no truthiness; this one gives '${show(gives)}'`, callback.start, callback.end);
    }
    if (acc && !fits(gives, acc)) throw new CompileError(`'reduce''s callback gives the next accumulator, a '${show(acc)}', but this one gives '${show(gives)}'`, callback.start, callback.end);
    if (name === "map" && (gives === "void" || holdsRef(gives))) throw new CompileError(`'map''s callback has to give a value to keep, not '${show(gives)}'`, callback.start, callback.end);
    let target = GENERATOR_HELPERS[name]!;
    if (name === "flatMap") {
      if (yieldsOf(lower(gives)) !== undefined) target = "iter flat map generator";
      else if (!isArray(lower(gives))) throw new CompileError(`'flatMap''s callback gives a generator or an array for each value, whose values make up the result; this one gives '${show(gives)}'`, callback.start, callback.end);
      else clonable((lower(gives) as ArrayType).element, callback, "flatMap");
    }
    if (reducing && !init) {
      // std gives the fold in a one-element tuple, or nothing when the generator was empty.
      const folded = unwrap(helper("iter reduce first", [source, callback]), "reduce of empty generator with no initial value");
      for (const stale of ["callee", "args", "typeArgs"] as const) delete (e as Partial<Call>)[stale];
      Object.assign(e, { kind: "index", object: folded, index: { id: nextId(ids), kind: "int", value: 0n, ...at }, optional: false });
      return { type: typeOf(e as Expr), what: "'reduce'" };
    }
    Object.assign(e, helper(target, init ? [source, callback, init] : [source, callback]));
    return call(e);
  }

  // Whether an expression is an index into an array, a place inside it.
  function element(e: Expr): e is Extract<Expr, { kind: "index" }> {
    if (e.kind !== "index") return false;
    const object = types.get(e.object);
    const held = object !== undefined && (isRefType(object) ? object.to : object);
    return held !== false && (isArray(held) || isFixed(held));
  }

  // A string read where a string's property or method is used: a literal becomes its string,
  // and a reference is read through. In an optional chain, the chain reads the Option.
  function text(object: Expr, type: Type, chained: boolean) {
    if (chained && type !== "string") throw unsupported("optional chains on string literal types", object);
    const held = types.get(object);
    if (held && isRefType(held)) coercions.set(object, "string");
    else if (type !== "string" && !chained) coerce(object, type, "string", "");
  }

  // A member of a data-carrying enum: a variant, read on its own only when it holds nothing.
  // A generic enum's type arguments come from those written, then from the payload, then from
  // the type expected where the value goes.
  function variant(e: Extract<Expr, { kind: "member" }>, named: EnumInfo, alone: boolean, given: Type[] = [], typeArgs: TypeNode[] = []): VariantType {
    const data = named.data!;
    const member = data.members.find((m) => m.name === e.name);
    if (!member) throw new CompileError(`property '${e.name}' does not exist on enum '${data.name}'${didYouMean(e.name, data.members.map((m) => m.name))}`, e.start, e.end);
    if (typeArgs.length > 0 && typeArgs.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError(`enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, e.start, e.end);
    }
    const bindings = new Map<string, Type>();
    const expected = typeArgs.length > 0 ? undefined : expectedVariant(e, named, given);
    if (typeArgs.length > 0) data.params.forEach((p, i) => bindings.set(p, ctx.resolveType(typeArgs[i]!)));
    else if (expected) data.params.forEach((p, i) => bindings.set(p, expected.args[i]!));
    else {
      const names = new Set(data.params);
      (member.payload ?? []).forEach((node, i) => given[i] && infer(ctx.tables, node, widenLet(given[i]!), names, bindings, e));
    }
    const missing = data.params.find((p) => !bindings.has(p));
    if (missing) {
      throw new CompileError(`can't tell what '${missing}' is for '${data.name}.${e.name}'; give it a declared type, like 'const x: ${data.name}<${data.params.join(", ")}> = ...' with real types`, e.start, e.end);
    }
    const found = ctx.enumInstance(named, data.params.map((p) => bindings.get(p)!), e).variants.get(e.name)!;
    if (alone && found.fields.length > 0) throw new CompileError(`'${found.name}' holds ${found.fields.length === 1 ? "a value" : "values"}; build it with '${found.name}(...)'`, e.start, e.end);
    if (!alone && found.fields.length === 0) throw new CompileError(`'${found.name}' holds nothing, so it isn't called; write '${found.name}'`, e.start, e.end);
    return found;
  }

  // The variant of this enum the type expected here holds: of the instances it names, one whose
  // fields the payload fits, if it is given, or else the first.
  function expectedVariant(e: Extract<Expr, { kind: "member" }>, named: EnumInfo, given?: Type[]): VariantType | undefined {
    const want = wanted.get(e);
    const members = want === undefined ? [] : typeof want !== "string" && want.kind === "union" ? want.members : [want];
    const candidates = members.flatMap((m) => {
      if (typeof m === "string" || m.kind !== "variant" || m.enum !== named.data!.name) return [];
      const v = ctx.enumInstance(named, m.args, e).variants.get(e.name);
      return v ? [v] : [];
    });
    // A payload that fits exactly decides first; then a number takes a number type of its own
    // kind, an integer an integer type and a float a float type.
    const suits = (exact: boolean) => (v: VariantType) => v.fields.every((f, i) => {
      const g = given?.[i];
      if (g === undefined || fits(g, f.type)) return true;
      return !exact && isNumeric(g) && isNumeric(f.type) && isFloat(g) === isFloat(f.type);
    });
    return (given && (candidates.find(suits(true)) ?? candidates.find(suits(false)))) ?? candidates[0];
  }

  // Whether `x.clone()` is the compiler's copy: for any value whose class doesn't declare a
  // `clone` method of its own. A base's `clone` makes a base, so it doesn't count.
  function copies(t: Type): boolean {
    if (typeof t === "string" || t.kind === "literal" || t.kind === "pattern") return true;
    // A generator's frame may hold a view into what it iterates, which a copy would share.
    if (t.kind === "generator") return false;
    if (t.kind === "class") return !classOf(t).methods.has("clone");
    const bound = t.kind === "param" ? t.bound : t.kind === "interface" ? t : undefined;
    return !bound || bound.kind !== "interface" || !bound.methods.some((m) => m.name === "clone");
  }

  // The compiler's copy of a value, or in an instance, the concrete class's own `clone()`.
  function cloned(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    if (e.args.length > 0 || e.typeArgs.length > 0) throw new CompileError("'clone' takes no arguments", e.start, e.end);
    const stored = lower(receiver);
    // A generator runs once, through its frame, so there is no second one to make.
    if (typeof stored !== "string" && stored.kind === "generator") throw new CompileError("a generator can't be cloned: it runs once, and a copy would share its place in the run", e.start, e.end);
    // A copy of a value holding references borrows what it does.
    if (holdsRef(receiver)) borrowsFrom.set(e, [callee.object]);
    if (stored !== receiver && typeof stored !== "string" && stored.kind === "class" && classOf(stored).methods.has("clone")) {
      return { type: concreteMethod(e, callee, stored, receiver), what: "'clone'" };
    }
    clonable(receiver, e);
    // A clone of what a recursive type's block holds is a value of its own.
    return { type: unfold(receiver), what: "'clone'" };
  }

  // Refuses a value that can't be cloned, for `clone()` and for the array methods that give
  // clones of elements, named by `by`; `dyns` copies Dyns one by one, as those methods do.
  function clonable(type: Type, at: Span, by?: string, dyns: boolean = by !== undefined) {
    const stored = lower(type);
    const say = (why: string) => new CompileError(by ? `'${by}' gives clones of the array's elements, and ${why}` : why, at.start, at.end);
    const permit = holdsPart(stored, (u) => typeof u !== "string" && u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit"));
    if (permit) throw say("can't clone a 'Semaphore' or a 'Permit', or a value holding one: a semaphore's slots are counted, so share it inside a shared value or a class instead");
    let rust: ClassType | undefined;
    holdsPart(isRefType(stored) ? stored.to : stored, (u) => (rustClassOf(u) ? ((rust = u as ClassType), true) : false));
    if (rust) {
      const name = rustClassOf(rust)!.name;
      if (classOf(rust).methods.has("clone")) throw say(`can't clone a value holding a Rust '${name}' as a whole; clone each '${name}' with its 'clone()'`);
      throw say(`can't clone a Rust '${name}'${rustClassOf(isRefType(stored) ? stored.to : stored) ? "" : ", or a value holding one,"} unless its class declares 'clone(): ${name}', which calls its Clone`);
    }
    // An array method's copy of a Dyn may panic, which unwinds as a Dyn's own copy does; only
    // `clone()` written on a value holding one asks for its Dyns to be cloned one by one.
    if (!dyns && (typeof stored === "string" || stored.kind !== "dyn") && holdsPart(stored, (u) => typeof u !== "string" && u.kind === "dyn")) throw say("can't clone a value holding a Dyn, whose clone may fail at run time; clone its Dyns one by one");
    const inner = holdsInterior(stored);
    if (inner) throw say(`can't clone ${inner === stored ? "" : "a value holding "}${article(inner.which)}, which is changed in place wherever it is shared; make a new one from what it holds`);
    if (holdsHandle(stored)) throw say("can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself");
    // Its value is given once, so a copy awaited after the first would find nothing to give.
    if (holdsPart(stored, (u) => typeof u !== "string" && u.kind === "future" && u.name.startsWith("promise await"))) throw say("can't clone a Promise made with 'new Promise', or a value holding one: its value is given once, to one await; await it once and share the value");
    // Two mutable references to one thing can't be.
    if (holdsMut(type)) throw say("can't clone a value holding a mutable reference ('Mut'), since the copy would change the same thing");
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  function receiverType(callee: Extract<Expr, { kind: "member" }>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !lookup(object.name) && (classes.has(object.name) || ctx.definedClass(object.name) || enums.has(object.name)))) return undefined;
    if (object.kind === "ident") objects.add(object);
    const type = linked(callee) ? unwrapped(object, callee.optional) : value(object);
    // A method called through a reference gets the pointer itself.
    return unfold(typeof type !== "string" && type.kind === "ref" ? type.to : type);
  }

  // Whether a field read or method call is a link of an optional chain: written `?.`, or after
  // one in the same chain. Such a link reads what the Option holds, and gives an Option, empty
  // when the chain was.
  function linked(e: Extract<Expr, { kind: "member" }>): boolean {
    return e.optional || chained(e.object);
  }

  function chained(e: Expr): boolean {
    for (let x = e; x.kind === "member" || x.kind === "call"; x = x.kind === "member" ? x.object : x.callee) {
      if (x.kind === "member" && x.optional) return true;
    }
    return false;
  }

  // What a link of an optional chain gives: an Option of what it reads.
  function optional(t: Type, at: Expr): Type {
    if (holdsRef(t) && !isRefType(t)) throw unsupported("Options holding references", at);
    return unionType([t, "null"]);
  }

  // The object a link reads, as what its Option holds.
  function unwrapped(object: Expr, written: boolean): Type {
    const option = value(object);
    if (!isOption(option)) {
      if (written) throw new CompileError(`'?.' reads through an Option, and this is a '${show(option)}', which is never empty; use '.'`, object.start, object.end);
      return option;
    }
    const inner = held(option);
    coercions.set(object, inner);
    return inner;
  }

  // A method of an interface, called while checking a generic body at its definition on a
  // value of a type parameter bounded by it, or of an interface a call returned. Each
  // instance resolves the call to its concrete type's method.
  function traitCall(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Extract<Type, { kind: "param" | "interface" }>): { type: Type; what: string } {
    const trait = receiver.kind === "param" ? receiver.bound : receiver;
    const found = trait?.kind === "interface" ? trait.methods.find((m) => m.name === callee.name) : undefined;
    if (!found) throw new CompileError(`property '${shownName(callee.name)}' does not exist on type '${receiver.name}'${didYouMean(callee.name, memberNames(receiver))}`, callee.start, callee.end);
    const stored = receiver.kind === "param" ? receiver.concrete : undefined;
    // A generic method's call infers its types, then in an instance runs the concrete method's.
    if (found.generic) {
      const { type } = familyCall(e, { kind: "function", name: found.name, names: [], params: found.params, returns: found.returns, fields: [], generic: found.generic }, `'${callee.name}'`);
      if (typeof stored !== "string" && stored?.kind === "class") return { type: concreteMethod(e, callee, stored, type), what: `'${callee.name}'` };
      return { type, what: `'${callee.name}'` };
    }
    if (e.typeArgs.length > 0) throw new CompileError("expected 0 type arguments", e.start, e.end);
    if (e.args.length !== found.params.length) {
      throw new CompileError(`expected ${found.params.length} argument${found.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const type = value(a);
      coerce(a, type, found.params[i]!, `argument of type '${show(type)}' is not assignable to parameter of type '${show(found.params[i]!)}'`);
    });
    // A reference an interface's method returns borrows from its receiver, as may the future a
    // `Promise<T>` describes, which in the definition is checked as one borrowing it.
    const promised = promiseElement(found.returns);
    if (holdsRef(found.returns) || promised !== undefined) borrowsFrom.set(e, [callee.object, ...e.args.filter(lends)]);
    if (typeof stored !== "string" && stored?.kind === "class") return { type: concreteMethod(e, callee, stored, found.returns), what: `'${callee.name}'` };
    return { type: promised !== undefined ? lentPromise(promised) : found.returns, what: `'${callee.name}'` };
  }

  // In an instance, a call through a type parameter runs its concrete class's method. An
  // interface it returns is, as for any call, the one concrete type the method returns.
  function concreteMethod(e: Call, callee: Extract<Expr, { kind: "member" }>, c: ClassType, returns: Type): Type {
    const target = inherited(classOf(c), "methods", callee.name)!;
    if (target.self!.owned) takesOver(callee.object, callee.name);
    else if (target.self!.mutable) mutates(callee.object, callee.name);
    const instance = instantiate(target, e.typeArgs, e.args, e.args.map((a) => coercions.get(a) ?? types.get(a)!), e);
    calls.set(e, instance);
    if (typeof returns === "string" || returns.kind !== "interface") return returns;
    return wrapped(returns.name, returns, lower(returnOf(instance, e)));
  }

  // An owning method takes its object over, which can't happen through a borrow.
  function takesOver(object: Expr, name: string) {
    const type = types.get(object);
    if (typeof type !== "string" && type?.kind === "ref") {
      throw new CompileError(`can't call '${name}' through the reference '${placeText(object)}': it takes its object over, and a reference only borrows it; call it on the value itself`, object.start, object.end);
    }
    if ((object.kind === "this" || object.kind === "super") && !self?.owned) {
      throw new CompileError(`can't call '${name}' on 'this' here: it takes its object over, and this method only borrows 'this'; declare 'this: Own<this>' to give it away`, object.start, object.end);
    }
  }

  // A mutating method's receiver must be a place that could change, or a temporary.
  function mutates(object: Expr, name: string) {
    const type = types.get(object);
    if (typeof type !== "string" && type?.kind === "ref" && !type.mutable) {
      throw new CompileError(`cannot call '${name}' on '${placeText(object)}' because it is a shared reference ('Ref'), which only reads`, object.start, object.end);
    }
    if (object.kind === "conditional") {
      throw new CompileError(`can't call '${name}' on a '?:', which would change a copy; call it in each branch`, object.start, object.end);
    }
    // `x!` gives a copy of what x holds, which a change wouldn't reach.
    const through = copied(object);
    if (through) throw new CompileError(`can't call '${name}' through '${through}', which would change a copy; check '!== null' first, or call it with '?.'`, object.start, object.end);
    if (readCopy(object)) throw new CompileError(`'${name}' changes its object, and this one is read through a Dyn, which gives a copy; change it through a method`, object.start, object.end);
    intoMember(typing, object, types, `call '${name}' on`);
    if (place(object)) changeable(object, `call '${name}' on`);
  }

  // The `!` or `??` a place is read through, if any, which gives a copy of what the place holds,
  // so a change through it would be lost. A temporary has no place to change.
  function copied(e: Expr, through?: string): string | undefined {
    switch (e.kind) {
      // A getter's result is a temporary.
      case "member":
        return calls.has(e) ? undefined : copied(e.object, through);
      case "nonNull":
        return copied(e.expr, "!");
      case "binary":
        return e.op === "??" ? (copied(e.left, "??") ?? copied(e.right, "??")) : undefined;
      case "conditional":
        return copied(e.then, through) ?? copied(e.else, through);
      case "this":
        return through;
      case "ident":
        return through && lookup(e.name) ? through : undefined;
      default:
        return undefined;
    }
  }

  // A class's static property, `C.x`: a `static readonly` field, the const `C.x`, or a static
  // accessor, the static methods `get x` and `set x`. Reads and writes of one are rewritten in
  // place into a read of that const or a call of those methods, forms the rest of the compiler knows.
  type Static = { field?: FieldDecl; declaring: ClassInfo; getter?: Body; setter?: Body };
  // The nearest class declaring `x` decides what it is, as in TypeScript: a class declaring only
  // a setter hides its base's getter.
  function staticProperty(e: Expr): Static | undefined {
    if (e.kind !== "member" || e.optional || e.object.kind !== "ident" || lookup(e.object.name)) return undefined;
    const c = classes.get(e.object.name);
    return c && staticOf(c, e.name);
  }

  function staticOf(c: ClassInfo, name: string): Static | undefined {
    for (let b: ClassInfo | undefined = c; b; b = b.base) {
      const field = b.staticFields.get(name);
      if (field) return { field, declaring: b };
      const getter = b.statics.get(`get ${name}`);
      const setter = b.statics.get(`set ${name}`);
      if (getter || setter) return { getter, setter, declaring: b };
    }
    return undefined;
  }

  // Rewrites `e` in place into `to`, keeping its own span and id.
  function become(e: Expr, to: Expr) {
    const at = { id: e.id, start: e.start, end: e.end };
    for (const k of Object.keys(e)) delete (e as Record<string, unknown>)[k];
    Object.assign(e, to, at);
  }

  function staticRead(e: Extract<Expr, { kind: "member" }>, found: Static): Expr {
    const at = { start: e.start, end: e.end };
    if (found.field) {
      visible(found.field.access, found.declaring!.type, e.name, e);
      return { id: nextId(ids), kind: "ident", name: `${found.declaring!.type.name}.${e.name}`, ...at };
    }
    if (!found.getter) {
      const hidden = found.declaring.base && staticOf(found.declaring.base, e.name)?.getter;
      throw new CompileError(hidden ? `'${found.declaring.type.name}' declares only a setter for '${e.name}', which hides the getter of its base; declare a getter in '${found.declaring.type.name}' too` : `property '${e.name}' has a setter but no getter`, e.start, e.end);
    }
    visible(found.getter.access, found.declaring.type, e.name, e);
    return staticCall(e, "get", []);
  }

  function staticCall(e: Extract<Expr, { kind: "member" }>, kind: "get" | "set", args: Expr[]): Expr {
    const at = { start: e.start, end: e.end };
    return { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: e.object, name: `${kind} ${e.name}`, optional: false, ...at }, typeArgs: [], args, optional: false, ...at };
  }

  // `C.x = v`, `C.x += v` and `C.x++` on a static setter call it with the value to store. Whether
  // the write was rewritten.
  function staticWrite(e: Extract<Expr, { kind: "assign" | "update" }>): boolean {
    const target = e.kind === "assign" ? e.target : e.operand;
    const found = staticProperty(target);
    if (!found) return false;
    const member = target as Extract<Expr, { kind: "member" }>;
    if (!found.setter) throw new CompileError(`cannot assign to '${member.name}' because it is a read-only property`, member.start, member.end);
    visible(found.setter.access, found.declaring.type, member.name, member);
    const op = e.kind === "update" ? (e.op === "++" ? "+" : "-") : ASSIGNMENTS[e.op];
    if (!op) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
    const at = { start: e.start, end: e.end };
    const right: Expr = e.kind === "update" ? { id: nextId(ids), kind: "int", value: 1n, ...at } : e.value;
    const given: Expr = op === "=" ? right : { id: nextId(ids), kind: "binary", op, left: staticRead(member, found), right, ...at };
    become(e, staticCall(member, "set", [given]));
    return true;
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  function method(callee: Extract<Expr, { kind: "member" }>, receiver: Type | undefined): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !lookup(object.name) ? (classes.get(object.name) ?? ctx.definedClass(object.name)) : undefined;
    if (named) {
      const found = inherited(named, "statics", name);
      const property = found ? undefined : staticOf(named, name);
      if (property) throw new CompileError(`'${name}' is a static ${property.field ? "field" : "accessor"} of '${property.declaring.type.name}', not a method; read it as '${named.type.name}.${name}'`, callee.start, callee.end);
      if (!found) throw new CompileError(`property '${name}' does not exist on type 'typeof ${named.type.name}'${didYouMean(name, staticNames(named))}`, callee.start, callee.end);
      visible(found.access, found.declared ?? found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return superMethod(callee);
    const type = receiver!;
    const found = typeof type !== "string" && type.kind === "class" ? inherited(classOf(type), "methods", name) : undefined;
    if (!found) throw new CompileError(`'${show(type)}' has no method '${name}'${didYouMean(name, memberNames(type))}`, callee.start, callee.end);
    visible(found.access, found.declared ?? found.owner!, name, callee);
    if (found.self!.owned) takesOver(object, name);
    else if (found.self!.mutable) mutates(object, name);
    return found;
  }

  // `super.m()` runs the base's `m` on the embedded base.
  function superMethod(callee: Extract<Expr, { kind: "member" }>): Body {
    // In a copy of a base's member, `super` is the base of the class it was written in.
    const base = (owner && self && derives(self.type, owner) ? owner : self?.type)?.base;
    if (!base) throw new CompileError("'super' can only be used in a class that extends another", callee.start, callee.end);
    if (!thisReady(callee.object)) throw new CompileError("'super' can't be used until every field is assigned", callee.object.start, callee.object.end);
    let found = inherited(classOf(base), "methods", callee.name);
    if (!found) throw new CompileError(`'${base.name}' has no method '${callee.name}'${didYouMean(callee.name, memberNames(base))}`, callee.start, callee.end);
    if (found.abstract) throw new CompileError(`'${callee.name}' is abstract in '${found.owner!.name}', so 'super.${callee.name}()' has nothing to run`, callee.start, callee.end);
    // A template runs as this class's own copy of it, on this class's `this`.
    const original = found.copyOf ?? found;
    const copied = original.template === true && !self!.type.abstract;
    if (copied) found = copyFor(ids, classOf(self!.type), original);
    visible(found.access, found.declared ?? found.owner!, callee.name, callee);
    if (found.self!.mutable && !self!.mutable) {
      throw new CompileError(`cannot call '${callee.name}' on 'super' because 'this' is read-only here; declare 'this: Mut<this>'`, callee.start, callee.end);
    }
    types.set(callee.object, copied ? self!.type : base);
    if (found.self!.owned) takesOver(callee.object, callee.name);
    return found;
  }

  // Inside an abstract class's code, its copies included, `this.name` naming one of its abstract
  // members is typed by the declaration, which each implementation's result is converted to.
  function abstractDeclaration(e: Extract<Expr, { kind: "member" }>, table: "methods" | "getters"): Body | undefined {
    if (e.object.kind !== "this" || !owner?.abstract) return undefined;
    const declared = inherited(classOf(owner), table, e.name);
    return declared?.abstract ? declared : undefined;
  }

  // TypeScript's access rules: a private member is reachable only from inside its class, and
  // a protected one also from the classes that embed it.
  function visible(access: Access | undefined, declaring: ClassType, name: string, at: Span) {
    if (accessible(access, declaring, name)) return;
    const message = name.startsWith("#")
      ? `property '${shownName(name)}' is not accessible outside class '${declaring.name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${declaring.name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError(message, at.start, at.end);
  }

  // Access is by declaration, as in TypeScript, so any two instances of one generic class share it.
  function sameClass(a: ClassType, b: ClassType): boolean {
    return a === b || (a.generic !== undefined && a.generic.name === b.generic?.name);
  }

  function accessible(access: Access | undefined, declaring: ClassType, name: string): boolean {
    if (!access || access === "public" || (owner && sameClass(owner, declaring))) return true;
    if (access === "protected" && owner) for (let b: ClassType | undefined = owner.base; b; b = b.base) if (sameClass(b, declaring)) return true;
    // A base reaches a subclass's implementation of its abstract member.
    return access === "protected" && owner !== undefined && derives(declaring, owner) && abstractIn(classOf(owner), name);
  }

  // The members of a type this body can reach, for suggesting one: an object's fields; a
  // class's fields, methods and accessors with its bases', those private or protected only where
  // accessible; an interface's or a Dyn's fields and methods.
  function memberNames(t: Type | undefined): string[] {
    if (t === undefined || typeof t === "string") return [];
    if (t.kind === "ref") return memberNames(t.to);
    if (t.kind === "param") return memberNames(t.bound);
    if (t.kind === "dyn") return memberNames(t.of);
    if (t.kind === "interface") return [...t.fields, ...t.methods].map((m) => m.name);
    if (t.kind === "object") return t.fields.map((f) => f.name);
    if (t.kind !== "class") return [];
    const names: string[] = [];
    for (let c: ClassInfo | undefined = classOf(t); c; c = c.base) {
      const declaring = c.type;
      names.push(...declaring.fields.filter((f) => accessible(f.access, declaring, f.name)).map((f) => shownName(f.name)));
      for (const table of [c.methods, c.getters, c.setters]) for (const [name, body] of table) if (accessible(body.access, declaring, name)) names.push(shownName(name));
    }
    return names;
  }

  // A class's static members, with its bases', for suggesting one.
  function staticNames(c: ClassInfo): string[] {
    const names: string[] = [];
    for (let b: ClassInfo | undefined = c; b; b = b.base) {
      for (const [name, body] of b.statics) if (accessible(body.access, b.type, name)) names.push(shownName(name.replace(/^[gs]et /, "")));
      for (const [name, f] of b.staticFields) if (accessible(f.access, b.type, name)) names.push(shownName(name));
    }
    return names;
  }

  // The class whose own fields include `name`: `t` itself or a base it embeds.
  function declaring(t: ClassType, name: string): ClassType {
    return t.fields.some((f) => f.name === name) || !t.base ? t : declaring(t.base, name);
  }

  function args(list: Expr[], argTypes: Type[], target: Instance, at: Span) {
    // A package's function takes a callback or a Promise as its signature made it for JS, a
    // stored one JS keeps.
    if (target.body.js && target.concrete) returnOf(target, at);
    const signature = target.body.js && target.concrete ? target.signature : undefined;
    const params = signature && signature.length > 0 ? signature : paramTypes(target);
    arity(list.length, target.body.params, at);
    list.forEach((a, i) => {
      const [type, expected] = [argTypes[i]!, params[i]!];
      const shown = defaultedArg(a, type, target.body.params[i]!) ?? expected;
      coerce(a, type, expected, `argument of type '${show(type)}' is not assignable to parameter of type '${show(shown)}'`);
    });
  }

  // A parameter with a default takes a value of its declared type, which this gives: leaving the
  // argument out gives the default, so a null or an Option where none is declared is refused.
  function defaultedArg(a: Expr, type: Type, p: Param): Type | undefined {
    const declared = declaredTypes.get(p);
    if (!declared || holdsNull(declared)) return declared;
    if (holdsNull(type)) throw new CompileError("this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default", a.start, a.end);
    return declared;
  }

  function value(e: Expr): Type {
    if (once.delete(e)) return types.get(e)!;
    const type = typeOf(e);
    // An abstract class's code sees `this` as the abstract class, which exists only embedded in
    // a subclass, so a value of that type, such as `this.clone()`, can't be made there.
    if (owner?.abstract && type === owner && e.kind !== "this" && e.kind !== "super") {
      throw new CompileError(`this would make a value of the abstract class '${owner.name}', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there`, e.start, e.end);
    }
    types.set(e, type);
    return type;
  }

  function typeOf(e: Expr): Type {
    switch (e.kind) {
      // A literal is an i64 unless where it is written gives it another number type.
      case "int":
        if (e.value > I64_MAX) oversized.push(e);
        return "i64";
      case "float":
        return "f64";
      case "bigint":
        return "bigint";
      // `x satisfies T` checks x against T and keeps x's own type, as TypeScript does.
      case "satisfies": {
        const wanted = resolveType(e.type);
        expect(e.expr, wanted);
        const t = value(e.expr);
        if (!fits(t, wanted)) throw new CompileError(`type '${show(t)}' does not satisfy the expected type '${show(wanted)}'`, e.expr.start, e.expr.end);
        return t;
      }
      case "regex":
        return regexLiteral(e.pattern, e.flags, e);
      case "destructure":
        throw new CompileError("a destructuring assignment can only be a statement of its own, as in '[a, b] = [b, a];', since its value can't be used here", e.start, e.end);
      case "null":
        return "null";
      // A throw expression never gives a value, so it fits wherever it is.
      case "throw":
        thrown(e, e.value);
        return "never";
      // `x!` is what an Option holds; it panics when there is nothing.
      case "nonNull": {
        const narrows = (e as Narrowing).narrows;
        if (narrows) return narrowedReturn(e.expr, narrows);
        const option = read(e.expr);
        if (!isOption(option)) throw new CompileError(`'!' takes the value out of an Option, and this is a '${show(option)}', which is never empty`, e.start, e.end);
        return held(option);
      }
      case "bool":
        return "boolean";
      case "ident": {
        // A nested function used as a value is a closure made here, from what it uses as it is
        // here, which it borrows from here on.
        const nested = nestedFunction(e.name);
        if (nested) {
          nestedEnv(e, nested, e);
          return nested.type;
        }
        const local = lookup(e.name, e);
        // A generic arrow a const holds, as a value, is the function it was lifted to.
        if (local?.generic) {
          e.name = local.generic.name;
          return typeOf(e);
        }
        if (!local && e.name === "undefined") return "null";
        // A package's const, read from JS.
        const jsConst = local ? undefined : byName.get(e.name);
        if (jsConst?.js?.const) {
          const type = jsView(resolveType(jsConst.returnType!));
          if (jsConverts(type)) jsExports.set(e, jsConst.js);
          else jsUses.push(e);
          return type;
        }
        // A top-level const: its value, computed while compiling. An aggregate is read where it
        // lives, through a reference, as a const can't change.
        const constant = local ? undefined : byName.get(`const ${e.name}`);
        if (constant) {
          const instance = ctx.instanceOf(constant);
          calls.set(e, instance);
          const type = ctx.returnOf(instance, e);
          return isCopy(type) || type === "string" ? type : refType(type, false);
        }
        // A declared function named as a value is a closure calling it.
        const declared = local ? undefined : byName.get(e.name);
        if (declared?.overloads) throw new CompileError(`'${e.name}' is overloaded, so it can't be used as a value yet; pass an arrow that calls it, as in '(x) => ${e.name}(x)'`, e.start, e.end);
        if (declared && !declared.comptime && declared.typeParams?.some((p) => !isLifetime(p))) return genericValue(declared, e);
        if (declared && !declared.comptime) {
          functionValue(e, declared);
          return typeOf(e);
        }
        if (!local) {
          const message = byName.has(e.name) ? "functions can't be used as values yet"
            : classes.has(e.name) ? "classes can't be used as values yet; construct one with 'new'"
            : enums.has(e.name) ? "an enum can't be used as a value; name one of its members"
            : `cannot find name '${e.name}'${didYouMean(e.name, ctx.names(e.start))}`;
          throw new CompileError(message, e.start, e.end);
        }
        if (!reachable(local)) {
          throw new CompileError(`'${e.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, e.start, e.end);
        }
        locals.set(e, local);
        const held = typeof local.type !== "string" && local.type.kind === "ref" ? local.type.to : local.type;
        if (ctx.sharing && local.param && !objects.has(e) && interiorMutable(held)) {
          throw new CompileError(`inside a shared value's 'update', use '${e.name}' only through its fields: other tasks borrow its interior-mutable parts without the lock, and another name for it could replace them`, e.start, e.end);
        }
        const read = narrowed(local);
        // A JsValue narrowed by `typeof` to one kind of value is read out of JS, as a new value
        // each time; one narrowed to several stays a JsValue.
        const js = jsRead(local.type, read);
        if (js === "one") ctx.copiesOut.add(e);
        if (js === "several") return stillJs(local.type);
        return read ?? local.type;
      }
      // Its literal type, which a string takes it as.
      case "string":
        return literalType(e.value);
      // A string's one-unit string at a `usize` index.
      case "index": {
        if (e.object.kind === "ident") objects.add(e.object);
        // An enum's reverse mapping, `Color[0]`, has no meaning yet.
        if (e.object.kind === "ident" && !lookup(e.object.name) && enums.has(e.object.name)) throw unsupported(EXPRESSION_FORMS.index, e);
        if (untuple(e)) return typeOf(e);
        const through = value(e.object);
        const object = isRefType(through) ? through.to : through;
        // A fixed array's element, checked against its known length when the program runs.
        if (isFixed(object)) {
          if (e.optional) throw unsupported("optional index expressions", e);
          const index = value(e.index);
          coerce(e.index, index, "usize", `a fixed array's index is a 'usize', not '${show(index)}'`);
          return unfolded(object.element);
        }
        const array = isArray(object);
        if (isPlainJs(object)) throw new CompileError(`a 'JsValue' could be anything, as an 'unknown' could, so its elements are read with 'at': '${placeText(e.object)}.at(i)'`, e.start, e.end);
        if (!stringLike(object) && !array) throw unsupported(EXPRESSION_FORMS.index, e);
        if (e.optional) throw unsupported("optional index expressions", e);
        if (array && object !== through) coercions.set(e.object, object);
        if (!array) text(e.object, object, false);
        const index = value(e.index);
        coerce(e.index, index, "usize", `${array ? "an array" : "a string"}'s index is a 'usize', not '${show(index)}'`);
        return array ? unfolded(object.element) : "string";
      }
      // Text alone is a literal; with substitutions, a new string.
      case "template":
        if (e.exprs.length === 0) return literalType(e.quasis[0]!);
        for (const x of e.exprs) joined(x, operand(x), "a template");
        return "string";
      case "member": {
        // A static property of a package's class.
        const jsClass = e.object.kind === "ident" && !lookup(e.object.name) ? jsClasses.get(e.object.name) : undefined;
        if (jsClass) {
          const m = jsStatic(jsClass, e.name, e);
          if (m.kind !== "property") throw new CompileError(`'${e.name}' is a method of '${jsClass.name}'; call it`, e.start, e.end);
          const declared = m.type ? resolveType(m.type) : blockType("JsValue");
          return crossing(jsView(m.optional ? unionType([declared, "null"]) : declared), `'${jsClass.name}.${e.name}' is a`, e);
        }
        if (isMath(e.object)) {
          if (MATH_CONSTANTS[e.name] === undefined) throw new CompileError(`'Math.${e.name}' is a function, or not in Fish yet; the constants are ${Object.keys(MATH_CONSTANTS).join(", ")}`, e.start, e.end);
          maths.add(e);
          return "f64";
        }
        const property = staticProperty(e);
        if (property) {
          become(e, staticRead(e, property));
          return typeOf(e);
        }
        // `Color.Red` names an enum member, whose value is known; the enum's name is no value.
        const named = e.object.kind === "ident" && !lookup(e.object.name) ? enums.get(e.object.name) : undefined;
        if (named?.data) return variant(e, named, true);
        if (named) {
          const found = named.members.get(e.name);
          if (!found) throw new CompileError(`property '${e.name}' does not exist on enum '${(e.object as { name: string }).name}'${didYouMean(e.name, named.members.keys())}`, e.start, e.end);
          return found;
        }
        if (e.object.kind === "ident") objects.add(e.object);
        const through = linked(e) ? unwrapped(e.object, e.optional) : value(e.object);
        const object = unfold(typeof through !== "string" && through.kind === "ref" ? through.to : through);
        // A field read through a reference loads what it points to; a getter gets the pointer.
        if (typeof object !== "string" && object.kind === "shared") return sharedField(e, object);
        if (typeof object !== "string" && object.kind === "block") return blockProperty(e, object);
        if (typeof object !== "string" && object.kind === "dyn") return dynField(e, object);
        const rx = asRegex(object);
        if (rx) {
          if (object !== through) coercions.set(e.object, object);
          return regexMember(e, rx, lower(object) !== rx);
        }
        const load = () => object !== through && coercions.set(e.object, object);
        const shared = typeof object !== "string" && object.kind === "union" ? unionField(typing, object, e.name, e) : undefined;
        if (shared) {
          load();
          return linked(e) ? optional(shared, e) : shared;
        }
        if (typeof object !== "string" && object.kind === "class") classOf(object);
        // A Map's or a Set's one property is its size, the number of entries it holds.
        if (typeof object !== "string" && object.kind === "map") {
          if ((object.set ? SET_METHODS : MAP_METHODS).has(e.name)) throw new CompileError(`'${object.set ? "Set" : "Map"}' methods can only be called, like 'm.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "size") throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(object)}'${didYouMean(e.name, ["size", ...(object.set ? SET_METHODS : MAP_METHODS)])}`, e.start, e.end);
          load();
          return linked(e) ? optional("usize", e) : "usize";
        }
        // A tuple's one property is its length: the count of its elements, up to the last
        // optional one there.
        if (isTuple(object) && !(object as ObjectType).match && e.name === "length") {
          load();
          return linked(e) ? optional("usize", e) : "usize";
        }
        // A fixed array's one property is its length, known while compiling.
        if (isFixed(object)) {
          if (e.name !== "length") throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(object)}'${didYouMean(e.name, ["length"])}`, e.start, e.end);
          load();
          return "usize";
        }
        // An array's properties are its length and its capacity, the room before a push grows it;
        // capacity isn't JavaScript's.
        if (isArray(object)) {
          if (ARRAY_METHODS.has(e.name)) throw new CompileError(`array methods can only be called, like 'a.${e.name}(...)'`, e.start, e.end);
          // A shared value's array is read as a copy, which has only the room it needs.
          if (e.name === "capacity" && ctx.copiesOut.has(e.object)) throw new CompileError(`a shared value's array is read as a copy, so read its capacity inside '${placeText(e.object).split(".")[0]}.update(...)'`, e.start, e.end);
          if (e.name !== "length" && e.name !== "capacity") throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(object)}'${didYouMean(e.name, ["length", "capacity", ...ARRAY_METHODS])}`, e.start, e.end);
          load();
          return linked(e) ? optional("usize", e) : "usize";
        }
        // A string's one property is its length in UTF-16 code units.
        if (stringLike(object)) {
          if (stringMethods(typing)[e.name]) throw new CompileError(`string methods can only be called, like 's.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "length") throw new CompileError(`property '${shownName(e.name)}' does not exist on type 'string'${didYouMean(e.name, ["length", ...Object.keys(stringMethods(typing))])}`, e.start, e.end);
          text(e.object, object, linked(e));
          return linked(e) ? optional("usize", e) : "usize";
        }
        const found = typeof object === "string" || object.kind === "closure" ? undefined : field(object, e.name);
        const c = typeof object !== "string" && object.kind === "class" ? classOf(object) : undefined;
        const getter = !found && c ? inherited(c, "getters", e.name) : undefined;
        if (getter) {
          visible(getter.access, getter.declared ?? getter.owner!, e.name, e);
          calls.set(e, instanceOf(getter));
          const returns = returnOf(instanceOf(abstractDeclaration(e, "getters") ?? getter), e);
          // A getter's reference borrows from its object.
          if (holdsRef(returns)) borrowsFrom.set(e, [e.object]);
          return linked(e) ? optional(returns, e) : returns;
        }
        if (!found && c && inherited(c, "methods", e.name)) throw new CompileError("methods can't be used as values yet; call it", e.start, e.end);
        if (!found && c && inherited(c, "setters", e.name)) throw new CompileError(`property '${e.name}' has a setter but no getter`, e.start, e.end);
        if (!found) throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(object)}'${didYouMean(e.name, memberNames(object))}`, e.start, e.end);
        if (typeof object !== "string" && object.kind === "class") visible(found.access, declaring(object, e.name), e.name, e);
        // Through a type parameter the field has its bound's type, and in an instance the
        // concrete class may give it with a getter.
        const stored = lower(object);
        if (stored !== object && typeof stored !== "string" && stored.kind === "class" && !field(stored, e.name)) {
          const instance = instanceOf(inherited(classOf(stored), "getters", e.name)!);
          returnOf(instance, e);
          calls.set(e, instance);
        }
        if (!calls.has(e)) load();
        return linked(e) ? optional(unfolded(found.type), e) : unfolded(found.type);
      }
      case "object": {
        const tuple = tuples.get(e);
        if (tuple) return tupleLiteral(e, tuple);
        if ((shaped.has(e) || pairs.has(e)) && tupleLiterals.has(e)) return tupleLiteral(e, shapedTuple(e, tupleParts(e).map((x) => widenLet(value(x!)))));
        if (e.props.some((p) => p.kind === "spread")) return objectSpread(e);
        return objectType(fields(e.props.map(property), e.props));
      }
      // An array literal holds its elements' types, each widened as a `let` widens; with none, a
      // declared type has to say what it holds.
      case "array": {
        if (e.elements.some((x) => x === undefined)) throw unsupported("holes in array literals", e);
        const tuple = tuples.get(e);
        if (tuple) return tupleLiteral(e, tuple);
        // A pair in `new Map([[k, v]])` is a tuple of what it holds.
        if (pairs.has(e)) {
          const parts = (e.elements as Expr[]).map((x) => {
            const t = widenLet(value(x));
            once.add(x);
            return t;
          });
          return tupleLiteral(e, tupleType(parts));
        }
        // `Array.of<T>(...)`: an array of T, its elements checked against it.
        const written = ofElements.get(e);
        if (written) {
          // Resolved as an array's element is, so references and functions get the same rules.
          const element = (resolveType({ id: nextId(ids), kind: "array", element: written, start: written.start, end: written.end } as TypeNode) as ArrayType).element;
          for (const x of e.elements as Expr[]) {
            expect(x, element);
            const t = value(x);
            coerce(x, t, element, `type '${show(t)}' is not assignable to type '${show(element)}'`);
          }
          return arrayType(element);
        }
        const inline = fixedLiterals.get(e);
        if (inline) {
          const given = e.elements as Expr[];
          if (given.length !== inline.size) throw new CompileError(`type '${show(inline)}' holds ${inline.size} element${inline.size === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
          const spread = given.find((x) => x.kind === "spread");
          if (spread) throw unsupported("spread elements in fixed array literals", spread);
          for (const x of given) {
            const t = value(x);
            coerce(x, t, inline.element, `type '${show(t)}' is not assignable to type '${show(inline.element)}'`);
          }
          return inline;
        }
        if (shaped.has(e) && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
          return tupleLiteral(e, shapedTuple(e, (e.elements as Expr[]).map((x) => widenLet(value(x)))));
        }
        const elements = e.elements as Expr[];
        // A spread gives an array's elements: those of an array itself, or of what a string, a
        // generator, a Map or a Set gives, as `Array.from` would. Its elements type the others
        // when nothing else does.
        const spreads = new NodeMap<Expr, Type>();
        for (const x of elements) if (x.kind === "spread") spreads.set(x, spreadElements(x));
        const first = [...spreads.values()][0];
        if (first !== undefined && !wanted.has(e)) for (const x of elements) if (x.kind !== "spread") expect(x, first);
        // Closures meeting the callable an annotation expects of each element are boxed into it.
        const want = wanted.get(e);
        const callable = typeof want !== "string" && want?.kind === "dyn" && callableOf.has(want.of) ? want : undefined;
        const promise = typeof want !== "string" && want?.kind === "dyn" && promiseElement(want.of) !== undefined ? want : undefined;
        const given = elements.map((x) => {
          const spread = spreads.get(x);
          if (spread !== undefined) return spread;
          const t = value(x);
          const boxed = typeof t !== "string" && ((t.kind === "closure" && callable) || (t.kind === "future" && promise));
          if (boxed) {
            const into = (callable ?? promise)!;
            coerce(x, t, into, `type '${show(t)}' is not assignable to type '${show(into)}'`);
            return into;
          }
          if (typeof t !== "string" && t.kind === "closure") throw unsupported("arrays of functions", x);
          if (holdsRef(t)) throw unsupported("arrays of references", x);
          const widened = widenLet(t);
          if (widened !== t) coerce(x, t, widened, "");
          return widened;
        });
        const fromSpreads = spreads.size > 0 && !wanted.has(e);
        const element = given.length === 0 ? "never" : fromSpreads ? unionType([...spreads.values()]) : unionType(given);
        elements.forEach((x, i) => {
          if (given[i] === element || sameLowered(given[i]!, element)) return;
          // A spread's elements are each converted to the array's type, which has to hold them.
          if (spreads.has(x)) {
            if (!fits(given[i]!, element)) throw new CompileError(`this spread gives '${show(given[i]!)}' elements, which an array of '${show(element)}' can't hold`, x.start, x.end);
            return;
          }
          coerce(x, types.get(x)!, element, `type '${show(types.get(x)!)}' is not assignable to type '${show(element)}', the type of the spread's elements`);
        });
        return arrayType(element);
      }
      case "arrow":
        // A generic arrow is a family of functions: a generic function value, named by the
        // function it is lifted to.
        if (e.typeParams.some((p) => !isLifetime(p))) {
          ctx.liftArrow(e);
          return typeOf(e);
        }
        return closure(e, expecting.get(e), unsafeDepth > 0, owning.has(e));
      // `as` converts between numbers as Rust's does; a boolean or an enum member converts to
      // an integer.
      case "as": {
        const written = resolveType(e.type);
        // A function type or a `Promise<T>` makes the value a stored one, as a declared variable's does.
        const to = storedType(written);
        if (to !== written) expect(e.expr, to);
        const from = operand(e.expr);
        // A raw pointer converts to another, or to and from an address, only inside `unsafe`.
        const pointer = (t: Type) => typeof t !== "string" && t.kind === "pointer";
        if (pointer(to) || pointer(from)) {
          needsUnsafe("'as' with a raw pointer", e);
          if (!((pointer(to) && (pointer(from) || isInteger(from))) || (to === "usize" && pointer(from)))) {
            throw new CompileError(`a raw pointer converts only to another raw pointer or a 'usize', not '${show(pointer(to) ? from : to)}'`, e.start, e.end);
          }
          return to;
        }
        // A bigint becomes a number with 'as', truncated to an integer type's bits as
        // 'BigInt.asIntN' does; a number becomes a bigint only through 'BigInt(x)'.
        if (to === "bigint" && from !== "bigint") throw new CompileError(`'${show(from)}' converts to a bigint with 'BigInt(x)', not 'as'`, e.start, e.end);
        if (from === "bigint" && (isNumeric(to) || to === "bigint")) return to;
        // Between other types, 'as' only widens, which nothing needs to check at run time; a
        // narrower type is reached by a check that narrows.
        if (!isNumeric(to) || !isNumeric(from)) {
          // A reference widened to what it points to would be a copy nobody wrote.
          const read = types.get(e.expr) ?? from;
          if ((isRefType(from) || isRefType(read)) && !isCopy(lower(from)) && !isRefType(to) && !optionRef(to)) throw new CompileError(`'as' can't take the value out of '${show(read)}', which only borrows it; use '.clone()' for a copy`, e.start, e.end);
          if (!(from === "boolean" && isInteger(to)) && (fits(from, to) || fits(from, written))) {
            coerce(e.expr, from, to, "");
            return to;
          }
          if (fits(to, from)) throw new CompileError(`'as' can't narrow '${show(from)}' to '${show(to)}', since nothing would check it while the program runs; narrow it with a check, like 'typeof', 'instanceof' or '!== null'`, e.start, e.end);
          if (!(from === "boolean" && isInteger(to))) throw new CompileError(`'${show(from)}' can't be converted to '${show(to)}' with 'as', since neither fits the other`, e.start, e.end);
        }
        return to;
      }
      case "this":
        if (!self) throw new CompileError("'this' can only be used inside a class", e.start, e.end);
        if (!thisReady(e)) throw new CompileError("'this' can't be used until every field is assigned", e.start, e.end);
        noteThis(e);
        return self.type;
      case "new": {
        const list = e.args ?? [];
        if (e.callee.kind === "ident" && INTERIORS.has(e.callee.name) && !lookup(e.callee.name) && !classes.has(e.callee.name)) {
          return interiorNew(e, e.callee.name as InteriorType["which"], list);
        }
        if (e.callee.kind === "ident" && (e.callee.name === "Semaphore" || e.callee.name === "Channel") && !lookup(e.callee.name) && !classes.has(e.callee.name)) {
          return blockNew(e, e.callee.name, list);
        }
        if (e.callee.kind === "ident" && (e.callee.name === "Map" || e.callee.name === "Set") && !lookup(e.callee.name)) return mapNew(e, e.callee.name === "Set", list);
        if (e.callee.kind === "ident" && !lookup(e.callee.name) && jsClasses.has(e.callee.name)) return jsNew(e, jsClasses.get(e.callee.name)!);
        if (e.callee.kind === "ident" && e.callee.name === "Promise" && !lookup("Promise") && !classes.has("Promise")) {
          promiseNew(e, list);
          return typeOf(e);
        }
        if (e.callee.kind === "ident" && e.callee.name === "RegExp" && !lookup("RegExp") && !classes.has("RegExp")) return regexNew(e, list);
        if (e.callee.kind === "ident" && e.callee.name === "AbortController" && !lookup(e.callee.name) && !classes.has(e.callee.name)) {
          if (list.length > 0 || e.typeArgs.length > 0) throw new CompileError("'AbortController' takes no arguments", e.start, e.end);
          return blockType("AbortController");
        }
        const named = e.callee.kind === "ident" && !lookup(e.callee.name) ? classes.get(e.callee.name) : undefined;
        if (named?.node.abstract) throw new CompileError(`cannot create an instance of the abstract class '${named.type.name}'`, e.start, e.end);
        const written = named?.constructor.params ?? (e.callee.kind === "ident" && !lookup(e.callee.name) ? ctx.templateParams(e.callee.name) : undefined);
        if (written?.at(-1)?.rest && e.args) packRest(e, e.args, written);
        else refuseSpread(list);
        if (named) expectFrom(named.constructor, list);
        // A generic class's written type arguments type the arrows given for parameters they name,
        // as in `new Box<(n: i64) => i64>((n) => n * 2)`.
        const early = !named && e.typeArgs.length > 0 && e.callee.kind === "ident" && !lookup(e.callee.name) ? construct(e.callee.name, e.typeArgs, [], e) : undefined;
        early?.constructor.params.forEach((p, i) => {
          const held = p.type?.kind === "ref" && p.type.args.length === 0 ? (early.constructor.scope ?? early.scope).get(p.type.name) : undefined;
          if (list[i]?.kind === "arrow" && held) expect(list[i]!, held);
        });
        // JavaScript's `new Array(n)` holds n holes, which Fish has no way to make.
        if (e.callee.kind === "ident" && e.callee.name === "Array" && !lookup("Array") && !classes.has("Array")) {
          const one = list.length === 1 ? value(list[0]!) : undefined;
          throw new CompileError(list.length === 0 ? "'new Array()' is an empty array; write '[]', with its type where it can't be inferred, as in 'const xs: string[] = []'"
            : one !== undefined && isInteger(one) ? "'new Array(n)' would hold n empty slots, which Fish has no way to make; fill it, as in 'new Array(n).fill(0)', or use 'Array.from({ length: n }, (_, i) => ...)'"
            : list.length === 1 ? "'new Array(x)' of one value that isn't a length makes '[x]'; write 'Array.of(x)' or '[x]'"
            : "'new Array(a, b)' makes an array of its arguments; write 'Array.of(a, b)' or '[a, b]'", e.start, e.end);
        }
        const argTypes = list.map(value);
        const c = e.callee.kind === "ident" ? construct(e.callee.name, e.typeArgs, argTypes, e) : undefined;
        if (!c) throw new CompileError(`only a class can be constructed with 'new'${e.callee.kind === "ident" && !lookup(e.callee.name) ? didYouMean(e.callee.name, ctx.classNames(e.callee.start)) : ""}`, e.callee.start, e.callee.end);
        const rust = rustClassOf(c.type);
        if (rust && !c.constructor.rust) throw new CompileError(`the Rust type '${rust.name}' declares no constructor; declare one, as in 'constructor(x: i64);', or make it with a static function`, e.start, e.end);
        constructs(c.constructor, list, argTypes);
        const constructor = instantiate(c.constructor, [], list, argTypes, e);
        args(list, argTypes, constructor, e);
        calls.set(e, constructor);
        const error = errorOf(constructor);
        if (error) raise(e, error, `'new ${c.type.name}'`);
        // An instance holding references borrows from what it was built from.
        if (holdsRef(c.type)) borrowsFrom.set(e, list.filter(lends));
        return c.type;
      }
      case "tagged":
        if (isQuote(e)) return quote(e, e.tag.kind === "ident" && e.tag.name === "quoteType");
        untag(e);
        return typeOf(e);
      case "call": {
        const { type, what } = call(e);
        if (type === "void") throw new CompileError(`${what} does not return a value`, e.start, e.end);
        return type;
      }
      case "match":
        return match(e, true);
      case "pipe":
        return pipe(e, true);
      case "unsafe":
        return unsafely(() => value(e.expr));
      // Checked as the code it is; it runs while compiling, and codegen bakes its value.
      case "comptime":
        return ctx.comptime(() => value(e.expr));
      case "yield":
        if (ctx.generator) throw unsupported("'yield' inside expressions", e);
        throw new CompileError("'yield' can only be used inside a 'function*'", e.start, e.end);
      case "unary": {
        if (e.op === "await") {
          const gives = awaited(e);
          if (gives === "void") throw new CompileError("this Promise gives nothing once awaited, so its value can't be used", e.start, e.end);
          return gives;
        }
        if (e.op !== "-" && e.op !== "!" && e.op !== "~") throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        const type = operand(e.operand);
        // The smallest i64 is written as the negation of a literal one past the largest.
        if (e.op === "-" && e.operand.kind === "int" && e.operand.value === I64_MAX + 1n) fitted.add(e.operand);
        if (e.op === "!" ? type !== "boolean" : type !== "bigint" && (e.op === "~" ? !isInteger(type) : !isNumeric(type))) {
          throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(type)}'`, e.start, e.end);
        }
        if (e.op === "-" && isInteger(type) && !INTEGERS[type].signed) {
          throw new CompileError(`'${show(type)}' is unsigned, so it can't be negated; convert it to a signed type with 'as' first`, e.start, e.end);
        }
        return type;
      }
      case "assign": {
        if (staticWrite(e)) throw new CompileError("a static setter gives no value, so an assignment to it can only be a statement of its own", e.start, e.end);
        const op = ASSIGNMENTS[e.op];
        if (!op) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        const target = assignable(e.target, op !== "=");
        if (op === "=") expect(e.value, target);
        const assigned = op === "=" ? value(e.value) : read(e.value);
        // A variable whose type is still open takes the integer type assigned to it.
        if (op === "=" && isInteger(assigned) && assigned !== target && ctx.infer(e.target, assigned)) return assigned;
        const type = op === "=" ? assigned
          : op === "+" && target === "string" ? join(e.target, target, e.value, widen(e.value, assigned))
          : op === "**" ? power(e.target, target, e.value, widen(e.value, assigned), e)
          : binaryType(typing, op, ...sameNumbers(e.target, target, e.value, widen(e.value, assigned)), e);
        coerce(e.value, type, target, `type '${show(type)}' is not assignable to type '${show(target)}'`);
        // A handle's property is written in JS, with the value converted.
        if (jsMembers.has(e.target)) {
          givenToJs(e.value, assigned);
          // What JS is given is JS's to keep, so nothing is left to be the assignment's value.
          if (keptByJs(target) && statementAssign !== e) throw new CompileError(`a callback or a Promise written to property '${(e.target as { name: string }).name}' goes to JS, so the assignment has no value to use; write it as a statement of its own`, e.start, e.end);
        }
        const local = e.target.kind === "ident" ? locals.get(e.target) : undefined;
        if (local && typeof local.type !== "string" && local.type.kind === "ref" && !coercions.has(e.target)) rebind(local, e.value);
        const narrow = local && narrowed(local);
        if (local && op === "=" && coercions.has(e.target) && narrow && isRefType(narrow) && !fits(type, narrow.to)) rewritten(local, e);
        return target;
      }
      case "update": {
        if (staticWrite(e)) throw new CompileError("a static setter gives no value, so an assignment to it can only be a statement of its own", e.start, e.end);
        const target = assignable(e.operand, true);
        if (!isNumeric(target) && target !== "bigint") throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(target)}'`, e.start, e.end);
        return target;
      }
      case "conditional": {
        condition(e.cond);
        const proven = proves(e.cond);
        let [then, otherwise] = [assume(proven.yes, () => value(e.then)), assume(proven.no, () => value(e.else))];
        [then, otherwise] = sameNumbers(e.then, then, e.else, otherwise);
        if (then === otherwise) return then;
        // Two references lend shared what both point to, or a type both fit; otherwise a side
        // that borrows gives its value.
        const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";
        if (isRef(then) && isRef(otherwise)) {
          const [a, b] = [(then as RefType).to, (otherwise as RefType).to];
          if ((then as RefType).mutable && (otherwise as RefType).mutable && lower(a) === lower(b)) return then;
          const bound = (t: Type) => (typeof t !== "string" && t.kind === "param" ? t.bound : undefined);
          const common = [a, b, bound(a), bound(b)].find((t) => t && fits(a, t) && fits(b, t));
          if (common) {
            const shared = refType(common, false);
            coerce(e.then, then, shared, "");
            coerce(e.else, otherwise, shared, "");
            return shared;
          }
        }
        // A reference against nothing is a reference or nothing.
        const option = isRef(then) && otherwise === "null" ? unionType([then, "null"]) : isRef(otherwise) && then === "null" ? unionType([otherwise, "null"]) : undefined;
        if (option) {
          coerce(e.then, then, option, "");
          coerce(e.else, otherwise, option, "");
          return option;
        }
        if (isRef(then) || isRef(otherwise)) [then, otherwise] = [loaded(e.then, then), loaded(e.else, otherwise)];
        if (then === otherwise) return then;
        return bothSides(typing, e, then, otherwise, coerce);
      }
      case "binary":
        // Each instance of an isDeepStrictEqual checks its own operands' types.
        if (deepEqualities.has(e)) {
          for (const a of [e.left, e.right]) {
            const t = value(a);
            once.add(a);
            if (holdsFloat(t)) throw new CompileError("'isDeepStrictEqual' over floats isn't supported yet: Node's compares them as Object.is does, NaN equal to NaN and -0 apart from 0, unlike '==='", a.start, a.end);
          }
        }
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError(`'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (e.op === "&&" || e.op === "||") {
          // The right side runs only when the left is true, for `&&`, or false, for `||`.
          const left = operand(e.left);
          const proven = proves(e.left);
          return binaryType(typing, e.op, left, assume(e.op === "&&" ? proven.yes : proven.no, () => operand(e.right)), e);
        }
        if (e.op === "===" || e.op === "!==") {
          const special = jsEmpty(e) ?? typeofComparison(e, unions) ?? equality(e) ?? unionComparison(e, unions, adapt);
          if (special) return special;
        }
        if (e.op === "instanceof") return instanceofCheck(e, unions);
        if (e.op === "**") return power(e.left, operand(e.left), e.right, operand(e.right), e);
        if (e.op === "??") return orElse(e);
        if (e.op === "in" && e.left.kind === "privateName") {
          throw new CompileError(`'${e.left.name} in' can't be used: Fish has no run-time reflection, and a value's class is known while compiling`, e.start, e.end);
        }
        if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        if (e.op === "+") {
          const [left, right] = [operand(e.left), operand(e.right)];
          if (stringLike(left) || stringLike(right) || enumText(left) || enumText(right)) return join(e.left, left, e.right, right);
        }
        return binaryType(typing, e.op, ...sameNumbers(e.left, operand(e.left), e.right, operand(e.right), e.op === "===" || e.op === "!=="), e);
      // A spread anywhere but in an array literal or a call filling a rest parameter.
      case "spread":
        throw new CompileError("'...' spreads into an array literal, or as an argument into a rest parameter, as in 'function f(...xs: T[])'; it can't be used here yet", e.start, e.end);
      default:
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
    }
  }

  // A fresh object literal's literal properties take the number types of the fields they meet,
  // in nested literals too; the literal's type is then made again from its properties.
  // The part of an object literal that gives its field `name`: the last that has it. A spread of
  // an object-typed parameter has its bound's fields, each instance being checked with its own.
  function winner(e: Extract<Expr, { kind: "object" }>, name: string): ObjectProp | undefined {
    return e.props.findLast((q) => {
      if (q.kind === "property") return q.key === name;
      if (q.kind === "shorthand") return q.name === name;
      if (q.kind !== "spread") return false;
      const t = types.get(q.value)!;
      const low = lower(isRefType(t) ? t.to : t);
      const source = typeof low !== "string" && low.kind === "param" && low.bound?.kind === "object" ? low.bound : low;
      return typeof source === "string" || source.kind === "param" || field(source, name) !== undefined;
    });
  }

  function adaptFields(e: Expr, type: Type, to: Type): Type {
    if (e.kind !== "object" || typeof to === "string" || (to.kind !== "object" && to.kind !== "class")) return type;
    // Only a property no later part replaces gives its field, so only that one adapts.
    const winners = e.props.filter((p): p is Extract<ObjectProp, { kind: "property" }> =>
      p.kind === "property" && typeof p.key === "string" && winner(e, p.key) === p);
    let changed = false;
    for (const p of winners) {
      const key = p.key as string;
      const want = field(to, key)?.type;
      const have = types.get(p.value)!;
      // A string literal widened for the object keeps its literal type where one is wanted.
      if (want && want !== "string" && coercions.get(p.value) === "string" && fits(have, want)) {
        coercions.delete(p.value);
        changed = true;
        continue;
      }
      if (!want || have === want) continue;
      // An array literal meeting a union becomes the union's array, which then joins the union.
      const adapted = adapt(p.value, want) ? want : literalArray(p.value, have, want) ? types.get(p.value)! : adaptFields(p.value, have, want);
      if (adapted !== have) {
        types.set(p.value, adapted);
        changed = true;
      }
    }
    if (!changed) return type;
    const fields = (type as ObjectType).fields.map((f) => {
      const p = winners.find((q) => q.key === f.name);
      return p ? { ...f, type: coercions.get(p.value) ?? types.get(p.value)! } : f;
    });
    // A tuple stays one, its rest taken from its adapted array.
    const tuple = type as ObjectType;
    const many = fields.find((f) => f.name === "...")?.type as ArrayType | undefined;
    const remade = isTuple(tuple) && !tuple.match ? tupleType(elementsOf({ ...tuple, fields }), tuple.required, many?.element) : objectType(fields);
    types.set(e, remade);
    return remade;
  }

  // `**` raises an integer to a `u32` power, like Rust's `pow`, and a float to a float power of
  // its own type, like `powf`. A literal base takes its type from the exponent's only when that
  // is a float.
  function power(base: Expr, left: Type, exponent: Expr, right: Type, at: Expr): Type {
    // A bigint's exponent is a bigint, as in JavaScript.
    if (left === "bigint" || right === "bigint") return binaryType(typing, "*", left, right, at);
    if (isFloat(right) && left !== right && adapt(base, right)) left = right;
    // A power of literals alone may still become a float where it is written, so an exponent
    // a u32 can't hold waits to see.
    if (isInteger(left) && right !== "u32" && literalOnly(base, false) && literalOnly(exponent, false)) {
      try {
        if (adapt(exponent, "u32")) right = "u32";
      } catch {
        powers.push([at, exponent]);
        return left;
      }
    }
    if (isInteger(left) && right !== "u32" && adapt(exponent, "u32")) right = "u32";
    if (isFloat(left) && left !== right && adapt(exponent, left)) right = left;
    if (isInteger(left) && right !== "u32") {
      throw new CompileError(`the exponent of '**' on an integer is a 'u32', as in Rust's 'pow', not '${show(right)}'; convert it with 'as u32'`, exponent.start, exponent.end);
    }
    if (!isNumeric(left) || (isFloat(left) && left !== right)) {
      throw new CompileError(`operator '**' cannot be applied to types '${show(left)}' and '${show(right)}'`, at.start, at.end);
    }
    return left;
  }

  // What an Option holds when it isn't empty.
  function held(option: UnionType): Type {
    return unionType(option.members.filter((m) => m !== "null"));
  }

  // `a ?? b` is what `a` holds, or `b` when `a` is empty, which only then runs. With an Option
  // for `b`, the result may still be empty.
  function orElse(e: Extract<Expr, { kind: "binary" }>): Type {
    // A destructuring default in a generic instance meets the Option its type parameter is.
    const option = unusedDefaults.has(e) ? lower(read(e.left)) : read(e.left);
    // A default a destructuring assignment adds is only for an Option's absence.
    // Its default is still checked, as TypeScript checks it.
    if (!isOption(lower(option)) && unusedDefaults.has(e)) {
      value(e.right);
      return option;
    }
    if (!isOption(option)) throw new CompileError(`the left side of '??' is a '${show(option)}', which is never empty; '??' gives a default for an Option`, e.left.start, e.left.end);
    const inner = held(option);
    // A parameter's default is checked as an argument for it would be; a nullable one's is null.
    const declared = fallbacks.get(e);
    if (declared) {
      const to = holdsNull(resolveType(declared)) ? option : inner;
      expect(e.right, to);
      const fallback = value(e.right);
      coerce(e.right, fallback, to, `a default of type '${show(fallback)}' is not assignable to parameter of type '${show(to)}'`);
      return to;
    }
    const fallback = value(e.right);
    // An Option of a reference takes a place to lend as its fallback.
    const to = fits(fallback, inner) || adaptable(e.right, inner) || (isRefType(inner) && fits(fallback, inner.to)) ? inner : option;
    coerce(e.right, fallback, to, `type '${show(fallback)}' is not assignable to type '${show(to)}', what '${show(option)}' holds`);
    return to;
  }

  // Whether an expression of only literals could take this number type.
  function adaptable(e: Expr, to: Type): boolean {
    return isNumeric(to) && literalOnly(e, isFloat(to));
  }

  // An array literal takes a declared element type, each element meeting it.
  function literalArray(e: Expr, type: Type, to: Type): boolean {
    // Meeting a union, it takes the union's one array member, and then joins the union.
    const members = typeof to !== "string" && to.kind === "union" ? to.members.filter(isArray) : [];
    if (e.kind === "array" && isArray(type) && members.length === 1 && literalArray(e, type, members[0]!)) {
      coerce(e, members[0]!, to, "");
      return true;
    }
    if (e.kind !== "array" || !isArray(type) || !isArray(to) || type === to) return false;
    // Each element meets the declared type afresh, replacing how it met the literal's own.
    for (const x of e.elements as Expr[]) {
      coercions.delete(x);
      coerce(x, types.get(x)!, to.element, `type '${show(types.get(x)!)}' is not assignable to type '${show(to.element)}'`);
    }
    types.set(e, to);
    return true;
  }

  // `v === null` and `v === undefined` test a JsValue for JS's two empty values, which Fish's one
  // empty value can't tell apart.
  function jsEmpty(e: Extract<Expr, { kind: "binary" }>): Type | undefined {
    for (const [subject, other] of [[e.left, e.right], [e.right, e.left]] as const) {
      if (!isEmpty(other, locals as NodeMap<Expr, Local>)) continue;
      const t = value(subject);
      once.add(subject);
      if (!isPlainJs(isRefType(t) ? t.to : t)) return undefined;
      once.delete(subject);
      value(other);
      jsEmptyTests.set(e, [subject, other.kind === "null" ? "null" : "undefined"]);
      return "boolean";
    }
    return undefined;
  }

  // `===` between values holding objects, arrays or instances compares them by value, as Fish's
  // Eq does, where TypeScript compares objects by identity: every part has to compare, and the
  // wider value is compared as the narrower.
  function equality(e: Extract<Expr, { kind: "binary" }>): Type | undefined {
    const [left, right] = [value(e.left), value(e.right)];
    once.add(e.left);
    once.add(e.right);
    const deref = (t: Type) => unfold(isRefType(t) ? t.to : t);
    const [l, r] = [deref(left), deref(right)];
    if (!objectsMeet(l, r)) return undefined;
    once.delete(e.left);
    once.delete(e.right);
    for (const t of [l, r]) {
      const part = unequal(t, comparesAsValue);
      if (part) throw new CompileError(`values of type '${show(part)}' can't be compared with '${e.op}': ${uncomparable(part)}`, e.start, e.end);
    }
    // A comparison over type parameters is checked again in each instance, once they're concrete.
    if (openParam(typing, l, true) || openParam(typing, r, true)) return "boolean";
    // A type parameter is compared as the type it stands for in this instance.
    const concrete = (t: Type): Type => (typeof t !== "string" && t.kind === "param" && t.concrete ? concrete(t.concrete) : t);
    const [cl, cr] = [concrete(l), concrete(r)];
    const common = fits(cl, cr) ? cr : fits(cr, cl) ? cl : undefined;
    // Two unions that share a member compare as unions do, member by member.
    const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
    const overlap = members(cl).some((x) => members(cr).some((y) => fits(x, y) || fits(y, x)));
    if (!common && !overlap) throw new CompileError(`this comparison appears to be unintentional because the types '${show(l)}' and '${show(r)}' have no overlap`, e.start, e.end);
    // A reference is compared through, reading the value it borrows.
    const [a, b] = [loaded(e.left, left), loaded(e.right, right)];
    if (common && a !== common) coerce(e.left, a, common, "");
    if (common && b !== common) coerce(e.right, b, common, "");
    return "boolean";
  }

  // Why values of a type can't be compared.
  function uncomparable(t: Type): string {
    const rust = rustClassOf(t);
    if (rust) return `a Rust '${rust.name}' isn't compared from Fish; compare what its methods give`;
    if (typeof t !== "string" && t.kind === "class") return `a class compares through 'equals(other: Ref<this>): boolean', which '${t.name}' doesn't have; add one, or '@derive(Eq)'`;
    if (typeof t !== "string" && t.kind === "variant") return "an enum holding values compares when it has '@derive(Eq)'";
    if (typeof t !== "string" && t.kind === "map") return `a ${t.set ? "Set" : "Map"} isn't compared by value; compare its entries`;
    return "it has no value equality";
  }

  // Whether a class or a data enum's values compare: a class through its `equals`, an enum
  // when it derives Eq.
  function comparesAsValue(t: ClassType | VariantType): boolean {
    if (rustClassOf(t)) return false;
    if (t.kind === "variant") return [...enums.values()].some((e) => e.data?.name === t.enum && e.data.eq);
    const known = equalities.get(t);
    if (known) return true;
    const method = inherited(classOf(t), "methods", "equals");
    if (!method) return false;
    const instance = instanceOf(method);
    const [arg, ...more] = paramTypes(instance);
    const shaped = !method.self?.mutable && !method.self?.owned && more.length === 0 && arg !== undefined && isRefType(arg) && !arg.mutable && (lower(arg.to) === lower(t) || (typeof arg.to !== "string" && arg.to.kind === "class" && derives(t, arg.to))) && returnOf(instance, method) === "boolean";
    if (!shaped) throw new CompileError(`'${t.name}.equals' is what '===' compares instances with, so it takes 'other: Ref<this>' and returns a boolean`, method.start, method.end);
    equalities.set(t, instance);
    return true;
  }

  // `+` with a string on either side joins the two into a new string.
  function join(a: Expr, left: Type, b: Expr, right: Type): Type {
    joined(a, left, "'+'");
    joined(b, right, "'+'");
    return "string";
  }

  // Values printed, or formatted as util.format does: what isn't a scalar is shown as Node's
  // util.inspect shows it.
  function shown(args: Expr[]) {
    for (const a of args) {
      const type = a.kind === "string" ? "void" : read(a);
      if (holdsPart(type, (u) => rustClassOf(u) !== undefined, true)) throw new CompileError(`printing a '${show(type)}' isn't supported, since it holds a Rust value; print what its methods give`, a.start, a.end);
      if (printable(type)) continue;
      printed.add(a);
      const part = uninspectable(type);
      if (!part) continue;
      throw new CompileError(typeof part !== "string" && (part.kind === "function" || part.kind === "closure" || part.kind === "dyn") ? "printing a function isn't supported yet" : `printing a '${show(part)}' isn't supported yet`, a.start, a.end);
    }
  }

  // `%j`, JSON, in a literal format, where it would take an argument.
  function unformattable(args: Expr[]) {
    const [first] = args;
    if (first?.kind !== "string" || args.length < 2 || !formatPlan(first.value, args.length).specs.includes("j")) return;
    throw new CompileError("'%j' in a format isn't supported yet; pass 'JSON.stringify(x)' to '%s' instead", first.start, first.end);
  }

  // A value written into a string: text, or a number or boolean written as JavaScript would.
  function joined(e: Expr, type: Type, into: string) {
    if (stringLike(type) || enumText(type)) {
      if (type !== "string") coerce(e, type, "string", "");
      return;
    }
    if (isNumeric(type) || type === "boolean" || type === "bigint") return;
    throw new CompileError(`${into} works with strings, numbers and booleans, not '${show(type)}'`, e.start, e.end);
  }

  // Two operands of different number types meet as one when either is only literals. String
  // literals meet as strings, unless two different ones are compared for equality.
  function sameNumbers(a: Expr, left: Type, b: Expr, right: Type, equality = false): [Type, Type] {
    if (isText(left) && isText(right) && (!equality || (left !== right && (left === "string" || right === "string")))) {
      if (left !== "string") coerce(a, left, "string", "");
      if (right !== "string") coerce(b, right, "string", "");
      return ["string", "string"];
    }
    if (left === right) return [left, right];
    if (adapt(b, left)) return [left, left];
    if (adapt(a, right)) return [right, right];
    return [left, right];
  }

  // A value meeting a declared type must fit it. A wider one is copied down to it, except
  // that a fresh object literal may not name extra properties, as in TypeScript.
  function coerce(e: Expr, type: Type, to: Type, message: string) {
    // A reference that changes its value's form points at a copy in a slot of the function,
    // which an async function loses each time it stops.
    if (ctx.async && isRefType(to) && !isRefType(type) && lower(type) !== lower(to.to) && fits(type, to.to)) {
      throw unsupported("references that convert their value inside async functions", e);
    }
    // `unsafe { expr }` is `expr`, which meets the type itself.
    if (e.kind === "unsafe") {
      coerce(e.expr, type, to, message);
      if (type !== to) types.set(e, coercions.has(e.expr) ? coercions.get(e.expr)! : types.get(e.expr)!);
      return;
    }
    // A recursive type's value meeting another type is the type it stands for, read out of
    // its block.
    if (typeof type !== "string" && type.kind === "recursive" && type !== to && !(typeof to !== "string" && to.kind === "union" && to.members.includes(type))) {
      coercions.delete(e);
      coerce(e, type.of, to, message);
      if (!coercions.has(e)) coercions.set(e, type.of);
      return;
    }
    // A value meeting a recursive type meets the type it stands for, then moves into a block.
    if (typeof to !== "string" && to.kind === "recursive" && type !== to) {
      coerce(e, type, to.of, message);
      coercions.set(e, to);
      return;
    }
    // A derived `equals` lends its argument to the base's, which reads the embedded base.
    if (upcasts.has(`${e.start}:${e.end}`) && isRefType(type) && isRefType(to) && !to.mutable && typeof type.to !== "string" && type.to.kind === "class" && typeof to.to !== "string" && to.to.kind === "class" && derives(type.to, to.to)) return;
    // A mutable reference lent on must be reachable only through mutable references.
    if (isRefType(to) && to.mutable && isRefType(type) && type.mutable && rooted(e) && place(e)) changeable(e, "mutably borrow");
    if (type === to || sameLowered(type, to) || sameCallable(type, to)) return;
    // An array literal takes the array of JS values it meets element by element, as any does.
    if (e.kind === "array" && typeof to !== "string" && to.kind === "array" && holdsJs(to) && literalArray(e, type, to)) return;
    // An Option or array of JS values takes what each of its members would.
    if (typeof to !== "string" && to.kind !== "block" && holdsJs(to) && !fits(type, to) && passesJs(type, to)) {
      coercions.set(e, to);
      return;
    }
    // Any value that crosses to JS is a JsValue there, as TypeScript's 'any' takes anything, and
    // a Fish value of a shape's fields becomes a new JS object of that shape.
    if (typeof to !== "string" && to.kind === "block" && to.which === "JsValue") {
      // A borrowed handle passes as the handle, counted again.
      if (isRefType(type) && typeof type.to !== "string" && type.to.kind === "block" && type.to.which === "JsValue") type = type.to;
      const shape = jsShape(to);
      if (shape ? takesShape(type, shape) : uncrossable(type) === undefined) {
        coercions.set(e, to);
        return;
      }
      const field = shape && missingField(type, shape);
      throw new CompileError(field ? `${message}: ${field}` : message, e.start, e.end);
    }
    if (adapt(e, to)) return;
    type = adaptFields(e, type, to);
    if (type === to) return;
    if (literalArray(e, type, to)) return;
    if (isNumeric(type) && isNumeric(to)) throw new CompileError(`${message}; convert it with 'as ${show(to)}'`, e.start, e.end);
    if (typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) {
      borrow(e, type, to, message);
      return;
    }
    // A place meeting a reference or nothing is lent, as one meeting the reference is.
    const lent = optionRef(to);
    // A `?:` lends a place either side chooses into it, as it does into a reference.
    if (lent && e.kind === "conditional" && optionRef(type) === undefined && [e.then, e.else].some(rooted)) {
      for (const side of [e.then, e.else]) {
        coercions.delete(side);
        coerce(side, types.get(side)!, to, message);
      }
      types.set(e, to);
      return;
    }
    if (lent && type !== "null" && !optionRef(type) && (typeof type === "string" || type.kind !== "ref")) {
      borrow(e, type, lent, message);
      coercions.set(e, to);
      return;
    }
    // A reference gives its value where one is wanted only by copying it: nothing moves out of
    // a borrow.
    if (typeof type !== "string" && type.kind === "ref" && (typeof to === "string" || to.kind !== "ref") && !lent) {
      if (!isCopy(type.to) && fits(type.to, to)) {
        throw new CompileError(`can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy`, e.start, e.end);
      }
      coercions.set(e, type.to);
      coerce(e, type.to, to, message);
      return;
    }
    if (typeof to !== "string" && to.kind === "union") {
      // A value no member takes as it is goes into the union's one Dyn, boxed.
      const dyns = to.members.filter((m): m is DynType => typeof m !== "string" && m.kind === "dyn");
      const boxable = typeof type !== "string" && (type.kind === "class" || type.kind === "generator");
      if (boxable && dyns.length === 1 && membersFor(type, to).length === 0 && !callableOf.has(dyns[0]!.of)) {
        boxing(e, type, dyns[0]!, message);
        boxedMembers.set(e, dyns[0]!);
        coercions.set(e, to);
        return;
      }
      intoUnion(e, type, to, message, unions);
      return;
    }
    // A literal type takes exactly its value, so only a literal expression of that value fits.
    if (typeof to !== "string" && to.kind === "literal") {
      if (literalValue(e) !== to.value) throw new CompileError(message, e.start, e.end);
      coercions.set(e, to);
      return;
    }
    if (e.kind === "object" && typeof to !== "string" && to.kind === "object" && holdsRef(to)) type = lendFields(e, to, message);
    const shape = !fits(type, to) ? literalShape(typing, e, to, types) : undefined;
    if (shape) {
      shape.apply(coercions);
      type = shape.type;
    }
    if (typeof to !== "string" && to.kind === "function") {
      if (!fits(type, to)) throw new CompileError(message, e.start, e.end);
      return;
    }
    if (typeof to !== "string" && to.kind === "dyn") return boxing(e, type, to, message);
    if (typeof to !== "string" && to.kind === "interface") {
      const reason = unsatisfied(type, to, members, e);
      if (reason) throw new CompileError(`${message}: ${reason}`, e.start, e.end);
      excess(e, to);
      return;
    }
    if (typeof type !== "string" && type.kind === "class" && typeof to !== "string" && to.kind === "class" && derives(type, to)) {
      throw new CompileError(`'${type.name}' extends '${to.name}' by embedding one, so it can't be used as '${to.name}'; extract an interface both classes implement`, e.start, e.end);
    }
    if (typeof type !== "string" && type.kind === "ref" && typeof to !== "string" && to.kind === "ref" && !fits(type, to)) {
      // A shared reference to something narrower lends a copy of what this one points to.
      if (!to.mutable && fits(type.to, to.to)) {
        coercions.set(e, to);
        return;
      }
      if (!to.mutable) throw new CompileError(message, e.start, e.end);
      const reason = !type.mutable ? "a shared reference can't lend itself as mutable" : `only a reference to exactly '${show(to.to)}' can be lent mutably`;
      throw new CompileError(`${message}: ${reason}`, e.start, e.end);
    }
    if (!fits(type, to) && !builds(e, type, to)) throw new CompileError(message, e.start, e.end);
    // An instance's concrete class may give a field its bound declares with a getter, which
    // copying field by field can't read, so that copy is rejected in the instance.
    if (lower(type) !== type && !fits(lower(type), lower(to))) throw new CompileError(message, e.start, e.end);
    excess(e, to);
    coercions.set(e, to);
  }

  // A value meeting a reference is lent rather than handed over. A place is lent where it
  // lives, so it must be exactly the type borrowed; a temporary is converted first. Lending
  // mutably needs a place that could be assigned.
  function borrow(e: Expr, type: Type, to: RefType, message: string) {
    // A `?:` choosing between places lends whichever it chooses, where it lives.
    if (e.kind === "conditional" && (rooted(e.then) || rooted(e.else))) {
      // A side read as its value before is lent instead.
      coercions.delete(e.then);
      coercions.delete(e.else);
      coerce(e.then, types.get(e.then)!, to, message);
      coerce(e.else, types.get(e.else)!, to, message);
      types.set(e, to);
      return;
    }
    // A literal lent is a temporary: it meets the type referred to, as its own literals do.
    if ((e.kind === "object" || e.kind === "array") && !fits(type, to.to)) {
      coerce(e, type, to.to, message);
      type = coercions.get(e) ?? types.get(e)!;
    }
    const exact = sameLowered(type, to.to);
    // A type that holds itself may lend a part of a parameter's value as the parameter's type,
    // which each instance checks against the type it is made for.
    const part = partOfItself(type, to.to);
    if (!exact && !part && !fits(type, to.to)) throw new CompileError(message, e.start, e.end);
    const unlocked = to.mutable ? unlocks(type, to.to) : undefined;
    if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, so it can't be lent mutably as '${show(to.to)}', which could change it`, e.start, e.end);
    const through = to.mutable ? copied(e) : undefined;
    if (through) throw new CompileError(`can't lend this mutably through '${through}', which would lend a copy; check '!== null' first and lend the variable`, e.start, e.end);
    if (to.mutable && readCopy(e)) throw new CompileError("this is part of a value read through a Dyn, which gives a copy, so lending it mutably would change only the copy; change it through a method", e.start, e.end);
    // A shared borrow of anything but such a place lends a copy, but a mutable one of anything
    // that isn't a temporary must reach the place.
    if (to.mutable && rooted(e)) {
      if (!place(e) || !inPlace(e, to)) {
        throw new CompileError(`${message}: only a place holding exactly '${show(to.to)}' can be lent mutably`, e.start, e.end);
      }
      changeable(e, "mutably borrow");
    }
    coercions.set(e, to);
  }

  // Whether an argument lends references to what it is passed to: borrowed, a reference, or
  // a value holding references.
  function lends(a: Expr): boolean {
    return holdsRef(coercions.get(a) ?? types.get(a)!);
  }

  // Whether an expression reaches into a variable or `this`, rather than being a temporary.
  function rooted(e: Expr): boolean {
    while ((e.kind === "member" && !calls.has(e)) || element(e)) e = e.object;
    return e.kind === "this" || (e.kind === "ident" && lookup(e.name) !== undefined);
  }

  // Whether lending a place to `to` points to where it lives, rather than to a copy: it holds
  // exactly that type, and isn't a variable narrowed to part of a union.
  function inPlace(e: Expr, to: RefType): boolean {
    const type = types.get(e)!;
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const held = typeof type !== "string" && type.kind === "ref" ? type.to : type;
    if (local && local.type !== type && typeof held !== "string" && held.kind === "union") return false;
    // A field read through a type parameter may be stored as a different type by the concrete
    // type; at a definition, where nothing is concrete, each instance decides.
    if (e.kind === "member" && lower(stored(e)) !== lower(type)) return false;
    return typeof type !== "string" && type.kind === "ref" ? fits(type, to) : (sameLowered(type, to.to) && sameLowered(to.to, type)) || partOfItself(type, to.to);
  }

  // Without lifetimes, a reference variable can only be pointed at something that lives as long
  // as it: a place lent where it lives, or another reference variable, declared in its own
  // scope or an enclosing one.
  function rebind(target: Local, e: Expr) {
    const to = target.type as RefType;
    // A `?:`, or a call's result, lives as long as what it points into.
    if (e.kind === "conditional") {
      rebind(target, e.then);
      rebind(target, e.else);
      return;
    }
    const from = borrowsFrom.get(e);
    if (from) {
      from.forEach((s) => rebind(target, s));
      return;
    }
    let root: Expr = e;
    while (root.kind === "member" && !calls.has(root)) root = root.object;
    const local = root.kind === "ident" ? locals.get(root) : undefined;
    const lives = root.kind === "this" || (local !== undefined && depthOf(local) <= depthOf(target));
    if (!lives || !place(e) || !inPlace(e, to)) {
      throw new CompileError(`'${target.name}' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as '${target.name}'`, e.start, e.end);
    }
  }

  // An object literal meeting a type with fields holding references lends each property to
  // its field, so the literal holds what it borrows.
  function lendFields(e: Extract<Expr, { kind: "object" }>, to: ObjectType, message: string): Type {
    const own = types.get(e) as ObjectType;
    const lent = own.fields.map((f) => {
      const want = field(to, f.name)?.type;
      const p = winner(e, f.name);
      if (!want || !p || p.kind === "spread" || !holdsRef(want) || fits(f.type, want)) return f;
      if (p.kind === "property") coerce(p.value, types.get(p.value)!, want, message);
      else if (p.kind === "shorthand") {
        // A shorthand lends its variable where it lives, so only as exactly what it holds.
        const local = locals.get(p)!;
        if (typeof want === "string" || want.kind !== "ref" || want.mutable || lower(local.type) !== lower(want.to)) {
          throw new CompileError(`${message}: write '${p.name}: ${p.name}' to lend '${p.name}' here`, p.start, p.end);
        }
      }
      return { ...f, type: want };
    });
    const type = objectType(lent);
    types.set(e, type);
    return type;
  }

  // An object literal builds a class it is declared as, without its constructor, when it
  // gives every field and the class has no field hidden from it. Nested literals may build
  // the classes of nested fields.
  function builds(e: Expr, type: Type, to: Type): boolean {
    if (e.kind !== "object" || typeof type === "string" || typeof to === "string" || to.kind !== "class") return false;
    classOf(to);
    for (const f of allFields(to)) {
      if ((f.access ?? "public") !== "public") {
        throw new CompileError(`an object literal can't build '${to.name}' because '${f.name}' is ${f.access}; use 'new'`, e.start, e.end);
      }
      const given = field(type, f.name);
      if (!given) {
        throw new CompileError(`property '${f.name}' is missing in type '${show(type)}' but required in type '${to.name}'`, e.start, e.end);
      }
      const prop = e.props.find((p) => p.kind === "property" && p.key === f.name);
      if (!fits(given.type, f.type) && !(prop?.kind === "property" && builds(prop.value, given.type, f.type))) {
        throw new CompileError(`type '${show(given.type)}' is not assignable to type '${show(f.type)}'`, (prop ?? e).start, (prop ?? e).end);
      }
    }
    return true;
  }

  function excess(e: Expr, to: Type) {
    to = unfold(to);
    if (e.kind !== "object" || typeof to === "string") return;
    // Against a union, a name no member has is excess, and the literal is checked as the one
    // member that has all its names, when one does.
    if (to.kind === "union") {
      const names = e.props.flatMap((p) => (p.kind === "spread" ? [] : [p.kind === "shorthand" ? p.name : (p as { key: string }).key]));
      const objects = to.members.map(unfold).filter((m): m is ObjectType | ClassType => typeof m !== "string" && (m.kind === "object" || m.kind === "class"));
      if (objects.length === 0) return;
      const missing = names.find((n) => !objects.some((m) => field(m, n)));
      if (missing !== undefined) {
        const p = e.props.find((p) => p.kind !== "spread" && (p.kind === "shorthand" ? p.name : (p as { key: string }).key) === missing)!;
        throw new CompileError(`object literal may only specify known properties, and '${missing}' does not exist in type '${show(to)}'`, p.start, p.end);
      }
      const whole = objects.filter((m) => names.every((n) => field(m, n)));
      if (whole.length === 1) excess(e, whole[0]!);
      return;
    }
    for (const p of e.props) {
      // A spread's fields aren't checked as excess, as in TypeScript.
      if (p.kind === "spread") continue;
      const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
      const found = field(to, name);
      if (!found) {
        throw new CompileError(`object literal may only specify known properties, and '${name}' does not exist in type '${show(to)}'`, p.start, p.end);
      }
      if (p.kind === "property") excess(p.value, found.type);
    }
  }

  // Properties are checked in source order, which is the order they run in.
  // `{ ...a, x: 1, ...b }`: the fields of each part in order, a later one replacing an earlier one
  // of its name. A spread takes an object's fields, or an instance's public ones.
  function objectSpread(e: Extract<Expr, { kind: "object" }>): Type {
    const merged = new Map<string, Field>();
    const written = new Set<string>();
    // The spread a field comes from, when that spread copies a place rather than taking over a
    // value made for it.
    const copied = new Map<string, ObjectProp>();
    for (const p of e.props) {
      if (p.kind !== "spread") {
        const f = property(p);
        if (written.has(f.name)) throw new CompileError(`duplicate property '${f.name}'`, p.start, p.end);
        written.add(f.name);
        merged.delete(f.name);
        merged.set(f.name, f);
        copied.delete(f.name);
        continue;
      }
      const t = value(p.value);
      const low = lower(isRefType(t) ? t.to : t);
      // An object-typed parameter stands for any type with its fields, which its bound names.
      const held = typeof low !== "string" && low.kind === "param" && low.bound?.kind === "object" ? low.bound : low;
      if (typeof held === "string" || (held.kind !== "object" && held.kind !== "class") || isTuple(held)) {
        throw new CompileError(`'...' in an object literal spreads an object or an instance, not '${show(t)}'`, p.start, p.end);
      }
      if (holdsRef(held)) throw unsupported("spreads of values holding references", p);
      if (rustClassOf(held)) throw new CompileError(`a Rust '${rustClassOf(held)!.name}' has no fields Fish can read, so it can't be spread; call its methods for what it holds`, p.start, p.end);
      const parts = held.kind === "class" ? allFields(held).filter((f) => (f.access ?? "public") === "public") : held.fields;
      const place = copiesPlace(p.value);
      for (const f of parts) {
        merged.delete(f.name);
        merged.set(f.name, { name: f.name, type: f.type });
        if (place) copied.set(f.name, p);
        else copied.delete(f.name);
      }
    }
    // A spread of a place copies the fields it gives, which must be ones a clone may copy; its
    // Dyns copy one by one, as an array method's elements do.
    for (const [name, p] of copied) clonable(merged.get(name)!.type, p, undefined, true);
    return objectType([...merged.values()]);
  }

  // Whether a value may be a place's, which taking it copies: a place, or any branch of `!`,
  // `?:`, `??` or a `match` giving one, a match arm's block through its `return`s. A place here
  // is what codegen copies rather than takes over: any field read but a getter's, a shared
  // value's copy or one the runtime computes, through unions and optional chains too.
  function copiesPlace(e: Expr): boolean {
    // A reference, whatever gives it, is read where its value lives; an assignment gives its
    // target's value.
    const given = types.get(e);
    if ((given !== undefined && isRefType(given)) || e.kind === "assign") return true;
    if (e.kind === "nonNull") return copiesPlace(e.expr);
    if (e.kind === "conditional") return copiesPlace(e.then) || copiesPlace(e.else);
    if (e.kind === "binary" && e.op === "??") return copiesPlace(e.left) || copiesPlace(e.right);
    if (e.kind === "match") return e.arms.some((a) => (a.body.kind === "block" ? armReturns(a.body).some(copiesPlace) : copiesPlace(a.body)));
    if (e.kind === "member") return !calls.has(e) && !ctx.copiesOut.has(e) && !computed.has(e);
    if (e.kind === "index") return element(e);
    return e.kind === "ident" || e.kind === "this";
  }

  // The values a match arm's block gives, through its own `return`s, not those of functions in it.
  function armReturns(block: Stmt): Expr[] {
    const found: Expr[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const s = n as Stmt | Expr;
      if (s.kind === "arrow" || s.kind === "function") return;
      if (s.kind === "return" && s.value) found.push(s.value);
      Object.values(n).forEach(walk);
    };
    walk(block);
    return found;
  }

  function property(p: ObjectProp): Field {
    const field = propertyField(p);
    // A generic function value is held as it is, captures nothing, and is called by name.
    if (typeof field.type !== "string" && field.type.kind === "closure" && field.type.generic) return field;
    // A value for a field the object's type holds a Dyn in is boxed into it.
    const boxed = p.kind === "property" ? wanted.get(p.value) : undefined;
    // `null`, or an Option, already is what an optional Dyn field holds.
    const plain = lower(field.type);
    const already = plain === "null" || (typeof plain !== "string" && plain.kind === "union") || (boxed !== undefined && plain === lower(boxed));
    if (p.kind === "property" && typeof boxed !== "string" && boxed?.kind === "dyn" && !already) {
      coerce(p.value, field.type, boxed, `type '${show(field.type)}' is not assignable to type '${show(boxed)}'`);
      return { ...field, type: boxed };
    }
    // An arrow written for a field the object's type stores a callable in is boxed into it.
    const want = p.kind === "property" ? wanted.get(p.value) : undefined;
    if (typeof field.type !== "string" && field.type.kind === "closure" && want && isCallable(want)) {
      coerce((p as Extract<ObjectProp, { kind: "property" }>).value, field.type, want, `type '${show(field.type)}' is not assignable to type '${show(want)}'`);
      return { ...field, type: want };
    }
    // With no type to say which, a sync arrow is stored as a callable of its own signature.
    if (typeof field.type !== "string" && field.type.kind === "closure" && p.kind === "property" && !(typeof field.type.returns !== "string" && field.type.returns.kind === "future")) {
      const own = storedType({ kind: "function", name: field.type.name, names: field.type.params.map((_, i) => `p${i}`), params: field.type.params, returns: field.type.returns, ...(field.type.throws && { throws: field.type.throws }), fields: [] });
      coerce(p.value, field.type, own, `type '${show(field.type)}' is not assignable to type '${show(own)}'`);
      return { ...field, type: own };
    }
    if (typeof field.type !== "string" && field.type.kind === "closure") throw unsupported("functions stored in objects", p);
    if (optionRef(field.type)) throw unsupported("unions holding references", p);
    return field;
  }

  function propertyField(p: ObjectProp): Field {
    if (p.kind === "property") {
      if (typeof p.key !== "string") throw unsupported("computed property names", p.key);
      // An object stores its fields, so an arrow written in one owns what it captures.
      if (p.value.kind === "arrow") owning.add(p.value);
      const type = value(p.value);
      const widened = widenLet(type);
      if (widened !== type) coerce(p.value, type, widened, "");
      return { name: p.key, type: widened };
    }
    if (p.kind !== "shorthand") {
      throw unsupported(p.kind === "spread" ? "spread elements" : p.kind === "method" ? "methods in object literals" : "accessors in object literals", p);
    }
    if (p.default) throw new CompileError("'=' in an object literal is only valid in a destructuring pattern", p.start, p.end);
    // A shorthand reads its variable like a name does: within its switch case, narrowed, and
    // widened from an enum member to the enum like any property.
    const local = lookup(p.name, p);
    if (!local) throw new CompileError(`cannot find name '${p.name}'${didYouMean(p.name, ctx.names(p.start))}`, p.start, p.end);
    if (!reachable(local)) {
      throw new CompileError(`'${p.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, p.start, p.end);
    }
    locals.set(p, local);
    const js = jsRead(local.type, narrowed(local));
    if (js === "one") throw new CompileError(`'${p.name}' is read out of JS as a '${show(narrowed(local)!)}' here; write '${p.name}: ${p.name}'`, p.start, p.end);
    if (js === "several") return { name: p.name, type: stillJs(local.type) };
    return { name: p.name, type: widenEnum(narrowed(local) ?? local.type) };
  }

  // What a variable holding a JsValue reads as where `typeof` left several kinds of JS value:
  // the JsValue, taken out of a union holding it, through a reference too.
  function stillJs(t: Type): Type {
    if (isRefType(t)) return refType(stillJs(t.to), t.mutable);
    return typeof t !== "string" && t.kind === "union" ? t.members.find(isPlainJs)! : t;
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  function assignable(target: Expr, reads: boolean): Type {
    const outer = writing;
    writing = target;
    try {
      const type = assignableTo(target, reads);
      if (reads && jsMembers.has(target)) throw unsupported("compound assignments to a package's properties", target);
      return type;
    } finally {
      writing = outer;
    }
  }

  function assignableTo(target: Expr, reads: boolean): Type {
    untuple(target);
    if ((target.kind === "member" || target.kind === "index") && target.object.kind === "ident") objects.add(target.object);
    const setter = target.kind === "member" ? accessor(target) : undefined;
    intoMember(typing, target, types);
    const indexed = target.kind === "index" ? read(target.object) : undefined;
    if (indexed !== undefined && stringLike(indexed)) {
      throw new CompileError("strings can't be changed; build a new one instead, joining parts with '+'", target.start, target.end);
    }
    if (indexed !== undefined && isPlainJs(indexed)) throw new CompileError("writing a JS value's elements isn't supported yet; a 'JsValue' is read with 'at'", target.start, target.end);
    const holder = target.kind === "member" ? types.get(target.object) : undefined;
    if (holder && isArray(isRefType(holder) ? holder.to : holder)) {
      const capacity = (target as { name: string }).name === "capacity";
      throw new CompileError(capacity ? "an array's 'capacity' can't be set; use 'reserve(n)' to make room, or 'shrinkToFit()' to give it back" : "an array's 'length' can't be set; use 'pop()' to remove elements, or 'push' to add them", target.start, target.end);
    }
    const table = holder && (isRefType(holder) ? holder.to : holder);
    if (table && typeof table !== "string" && table.kind === "map") {
      throw new CompileError("a Map's or a Set's 'size' can't be set; use 'delete' or 'clear' to remove entries", target.start, target.end);
    }
    if (holder && stringLike(isRefType(holder) ? holder.to : holder)) {
      throw new CompileError(`a string's '${(target as { name: string }).name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    }
    // A top-level const, or a part of one, was computed while compiling and never changes.
    let root = target;
    while (root.kind === "member" || root.kind === "index") root = root.object;
    if (root.kind === "ident" && !lookup(root.name) && byName.has(`const ${root.name}`)) {
      throw new CompileError(`'${root.name}' is a top-level const, computed while compiling, so it never changes; a global that changes is a const holding an Atomic or a Lock`, target.start, target.end);
    }
    if (!place(target)) throw new CompileError("can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      const read = value(target);
      // Below a read through a Dyn, the place is part of a copy.
      if (!computed.has(target) && readCopy(target)) throw new CompileError("this is part of a value read through a Dyn, which gives a copy, so writing it would change only the copy; change it through a method", target.start, target.end);
      if (computed.has(target)) {
        const holder = types.get((target as Extract<Expr, { kind: "member" }>).object);
        // A JS handle's property is written in JS, whatever holds the handle.
        const handle = holder === undefined ? undefined : jsShape(isRefType(holder) ? holder.to : holder);
        const field = handle?.fields.find((f) => f.name === (target as { name: string }).name);
        if (field) {
          if (field.readonly) throw new CompileError(`'${field.name}' is read-only in its declaration`, target.start, target.end);
          return crossing(field.type, `property '${field.name}' is a`, target);
        }
        const through = typeof holder !== "string" && (holder?.kind === "dyn" || (holder?.kind === "ref" && typeof holder.to !== "string" && holder.to.kind === "dyn"));
        throw new CompileError(through ? "writing a field through a Dyn isn't supported yet; change it through a method" : `'${(target as { name: string }).name}' is read-only: the runtime keeps it`, target.start, target.end);
      }
      // A whole value assigned to a mutable reference is written through it, to what it was
      // declared to point to, whatever a check narrowed it to. An update like `+=` keeps the
      // member, so it goes through the narrowed reference.
      const declared = target.kind === "ident" && !reads ? locals.get(target)!.type : read;
      // A constructor's assignment to a field of `this` sets the field rather than writing through it.
      const initialises = target.kind === "member" && target.object.kind === "this" && self?.constructor && self.type.fields.some((f) => f.name === target.name);
      if ((target.kind === "ident" || target.kind === "member") && !initialises && isRefType(declared) && declared.mutable) {
        // What a type parameter stands for may be wider than any value written here.
        if (typeof declared.to !== "string" && declared.to.kind === "param") {
          throw new CompileError(`can't assign a whole value through '${placeText(target)}', which may point to a wider value; assign its fields instead`, target.start, target.end);
        }
        if (target.kind === "member") changeable(target, "assign to");
        else if (captured(locals.get(target)!)) changesCapture(locals.get(target)!, "", "assign to", target, true);
        types.set(target, declared);
        coercions.set(target, declared.to);
        return declared.to;
      }
      intoMember(typing, target, types);
      changeable(target, "assign to");
      const type = stored(target);
      types.set(target, type);
      return type;
    }
    const type = paramTypes(instanceOf(setter))[0]!;
    if (reads && value(target) !== type) {
      throw new CompileError(`the getter and setter of '${target.name}' must have the same type`, target.start, target.end);
    }
    changeable(target, "assign to");
    setters.set(target, instanceOf(setter));
    types.set(target, type);
    return type;
  }

  // The type a write stores. Read through a type parameter, a field has its bound's type, but
  // in an instance it is stored as the concrete type's field, which may be narrower.
  function stored(target: Expr): Type {
    if (target.kind !== "member") return types.get(target)!;
    // Through a reference, what it points to stores the field.
    const holder = lower(stored(target.object));
    const object = typeof holder !== "string" && holder.kind === "ref" ? lower(holder.to) : holder;
    if (stringLike(object)) throw new CompileError(`a string's '${target.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    if (typeof object !== "string" && object.kind === "union") {
      throw new CompileError(`can't assign to '${target.name}' through '${show(object)}'; narrow it to one member first`, target.start, target.end);
    }
    const found = typeof object !== "string" && field(object, target.name)?.type;
    // A pattern the field was declared with is what a write must match, though lowering made it a string.
    const declared = types.get(target)!;
    if (found && holdsPattern(declared) && lower(declared) === lower(found)) return declared;
    return found || declared;
  }

  // The setter an assignment to a class member runs, if it is an accessor. A getter alone
  // makes the property read-only.
  function accessor(target: Extract<Expr, { kind: "member" }>): Body | undefined {
    const object = lower(value(target.object));
    if (typeof object === "string" || object.kind !== "class" || field(object, target.name)) return undefined;
    const c = classOf(object);
    const setter = inherited(c, "setters", target.name);
    if (!setter && inherited(c, "getters", target.name)) {
      throw new CompileError(`cannot assign to '${target.name}' because it is a read-only property`, target.start, target.end);
    }
    if (setter) visible(setter.access, setter.declared ?? setter.owner!, target.name, target);
    return setter;
  }

  // A variable, `this`, or a field inside one: somewhere a value lives, rather than a
  // temporary.
  // A getter's result is a temporary, so a path through one isn't a place.
  function place(e: Expr): boolean {
    while ((e.kind === "member" && !e.optional && !calls.has(e)) || element(e)) {
      // An enum's member, and a field every member of a union shares, are values, not places.
      const object = types.get(e.object);
      const held = typeof object !== "string" && object?.kind === "ref" ? object.to : object;
      if (!held || (typeof held !== "string" && held.kind === "union")) return false;
      e = e.object;
    }
    return e.kind === "this" || (e.kind === "ident" && lookup(e.name) !== undefined);
  }

  // Checks that a place, already typed, may change. `const` is deeply immutable, so no field
  // of a constant can change, and `this` changes only in a constructor or a method declared
  // `this: Mut<this>`.
  function changeable(target: Expr, action: string) {
    // Below a read through a Dyn, the place is part of a copy.
    if (readCopy(target) && !computed.has(target)) throw new CompileError(`cannot ${action} this: it is part of a value read through a Dyn, which gives a copy, so the change would be lost; change it through a method`, target.start, target.end);
    let root = target;
    let path = "";
    // Through a mutable reference anything below it may change, whatever variable holds the
    // reference, as long as nothing above it is shared.
    let throughMut = false;
    while (root.kind === "member" || element(root)) {
      if (root.kind === "member") readonly(root, target, action);
      const holder = types.get(root.object);
      const referred = typeof holder !== "string" && holder?.kind === "ref" ? holder.to : holder;
      if (typeof referred !== "string" && referred?.kind === "shared") {
        throw new CompileError(`cannot ${action} '${placeText(target)}' because '${placeText(root.object)}' is shared between threads; change it inside '${placeText(root.object)}.update(...)'`, target.start, target.end);
      }
      if (ctx.sharing && interiorMutable(types.get(root)!) && isParamPath(root)) {
        throw new CompileError(`cannot ${action} '${placeText(target)}' inside 'update': other tasks borrow '${placeText(root)}' without the lock, so it changes only through its own methods`, target.start, target.end);
      }
      if (typeof holder !== "string" && holder?.kind === "ref" && holder.mutable) throughMut = true;
      else if (typeof holder !== "string" && holder?.kind === "ref") {
        throw new CompileError(`cannot ${action} '${placeText(target)}' because '${placeText(root.object)}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
      }
      // A rest tuple's element is named by its place in the tuple, its array left unsaid.
      if (root.kind === "index" && root.index.kind === "int" && restStarts.has(root.object)) path = `[${BigInt(restStarts.get(root.object)!) + root.index.value}]${path}`;
      else if (!(root.kind === "member" && restStarts.has(root))) path = `${root.kind === "member" ? (/^\d+$/.test(root.name) ? `[${root.name}]` : `.${shownName(root.name)}`) : "[...]"}${path}`;
      root = root.object;
    }
    if (ctx.sharing && path === "" && isParamPath(root)) {
      const whole = types.get(root)!;
      if (interiorMutable(typeof whole !== "string" && whole.kind === "ref" ? whole.to : whole)) {
        throw new CompileError(`cannot ${action} '${placeText(target)}' as a whole inside 'update': other tasks borrow its interior-mutable fields without the lock; change its other fields one by one`, target.start, target.end);
      }
    }
    if (root.kind === "this" || root.kind === "super") return changesThis(path, action, target);
    changesLocal(locals.get(root)!, path, action, target, throughMut);
  }

  // A value moved into a new `Dyn`: its type implements the interface, and owns everything and
  // changes only under locks, since a Dyn hides what it holds from every later check and may
  // cross to another thread.
  function boxing(e: Expr, type: Type, to: DynType, message: string) {
    if (promiseElement(to.of) !== undefined) return boxingFuture(e, lower(type), to, message);
    if (relaying(lower(type), to)) {
      if (isRefType(types.get(e)!)) throw new CompileError("can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
      dynMembers.set(`${keyOf(lower(type))} ${keyOf(lower(to))}`, { methods: [], fields: [], clone: "copy" });
      return void coercions.set(e, to);
    }
    if (callableOf.has(to.of)) storing(e, lower(type), to, message);
    else if (isRefType(types.get(e)!)) throw new CompileError("can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
    const held = lower(type);
    if (typeof held !== "string" && held.kind === "dyn") throw new CompileError(`a '${show(held)}' can't become a '${show(to)}' yet; box the value it was made from`, e.start, e.end);
    let rust: RustClass | undefined;
    if (holdsPart(held, (u) => (rust ??= rustClassOf(u)) !== undefined)) throw new CompileError(`a Rust '${rust!.name}' can't become a '${show(to)}' yet; call its methods on it, or take it as a generic parameter`, e.start, e.end);
    const reason = callableOf.has(to.of) ? undefined : unsatisfied(type, to.of, members, e);
    if (reason) throw new CompileError(`${message}: ${reason}`, e.start, e.end);
    const blocker = unsent(held);
    if (blocker) {
      const why = typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from where it was made";
      throw new CompileError(`a '${show(to)}' may cross to another thread, so it can't hold a '${show(blocker)}', which ${why}`, e.start, e.end);
    }
    // A Dyn of a generic interface made in a generic body is keyed as codegen finds it, lowered.
    if (typeof held === "string" || held.kind !== "param") {
      const table = dynTable(e, held, lower(to) as DynType);
      dynMembers.set(`${keyOf(held)} ${keyOf(lower(to))}`, table);
      ctx.dynOf(e, table);
    }
    coercions.set(e, to);
  }

  // A stored callable held in one taking and giving the same, that throws what it throws or
  // more: its calls are passed on through a slot of their own.
  function relaying(from: Type, to: DynType): boolean {
    const [f, g] = [typeof from !== "string" && from.kind === "dyn" ? callableOf.get(from.of) : undefined, callableOf.get(to.of)];
    if (!f || !g || !g.throws || f.params.length !== g.params.length || lower(f.returns) !== lower(g.returns)) return false;
    return f.params.every((p, i) => lower(p) === lower(g.params[i]!)) && (!f.throws || fits(f.throws, g.throws));
  }

  // A future stored as a `Promise<T>`: one an async function's call made, giving T, throwing
  // nothing, and owning what it holds, since it may be awaited on any thread.
  function boxingFuture(e: Expr, type: Type, to: DynType, message: string) {
    if (typeof type !== "string" && type.kind === "param") return coercions.set(e, to), undefined;
    if (typeof type === "string" || type.kind !== "future" || type === YIELD_NOW || type === SLEEP || leafOf.has(type)) {
      const what = typeof type !== "string" && type.kind === "future" ? "; store the async function's call instead" : "";
      throw new CompileError(`${message}${what}`, e.start, e.end);
    }
    if (lower(type.gives) !== lower(promiseElement(to.of)!)) throw new CompileError(message, e.start, e.end);
    if (type.throws) throw new CompileError(`a stored '${show(to)}' can't throw yet, and this one can throw '${show(type.throws)}'; await it where it is made, or catch inside the async function`, e.start, e.end);
    const blocker = unsent(type);
    if (blocker) throw new CompileError(`a stored '${show(to)}' may be awaited on any thread, so its future can't hold a '${show(blocker)}'`, e.start, e.end);
    dynMembers.set(`${keyOf(type)} ${keyOf(to)}`, { methods: [], fields: [], clone: undefined });
    coercions.set(e, to);
  }

  // A closure stored as a callable: it fits the function type, owns what it captures, changes
  // none of it, and can run any number of times.
  function storing(e: Expr, type: Type, to: DynType, message: string) {
    const fn = callableOf.get(to.of)!;
    if (typeof type === "string" || type.kind !== "closure") {
      // A function-typed parameter is checked when its instance knows the closure.
      if (typeof type !== "string" && (type.kind === "function" || type.kind === "param")) return;
      throw new CompileError(message, e.start, e.end);
    }
    if (!fits(type, fn)) throw new CompileError(message, e.start, e.end);
    const body = closureBody(type);
    // A call through a stored callable passes every argument, with no default to fall back on.
    if (body.body.params.some((p) => defaulted.has(p))) throw new CompileError("a closure with default parameter values can't be stored as a value yet, since calls through it pass every argument; give the parameters no defaults", e.start, e.end);
    const capture = (name: string) => `'${name}'`;
    const borrowed = type.fields.find((f) => isRefType(f.type));
    if (borrowed) throw new CompileError(`this closure borrows ${capture(borrowed.name)}, but a stored callable owns what it captures; write the closure where it is stored, so it captures by move, or as 'move (...) => ...'`, e.start, e.end);
    if (type.once) throw new CompileError(`this closure moves ${capture(type.once)} out of what it captures, so it can run only once, but a stored callable may run any number of times; clone ${capture(type.once)} inside it instead`, e.start, e.end);
    const changed = [...(body.changed ?? [])][0];
    if (changed) throw new CompileError(`this closure changes ${capture(changed.name)}, which it captures, but a stored callable can't change what it captures; keep that state in an 'Atomic' or a 'Lock'`, e.start, e.end);
    // Each call of an async callable runs on its own copy of what it captures, which would split
    // an Atomic's or a Lock's state in two.
    const pinned = (u: Type) => typeof u !== "string" && ((u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit")) || u.kind === "handle");
    const held = body.body.async ? type.fields.find((f) => holdsPart(f.type, pinned)) : undefined;
    if (held) throw new CompileError(`this async function captures ${capture(held.name)}, which holds an Atomic, a Lock, a Semaphore or a JoinHandle; each call works on its own copy of what it captures, which would split that state, so capture a shared value holding it instead, like 'shared({ count: new Atomic(0) })'`, e.start, e.end);
  }

  // What a Dyn of this type runs for each interface member. A method may not need more of its
  // object than the interface declares, since a call through a Dyn only knows the interface,
  // and one taking an interface or function has a version per argument type, so no one slot.
  function dynTable(e: Expr, type: Type, to: DynType): DynTable {
    const c = typeof type !== "string" && type.kind === "class" ? classOf(type) : undefined;
    const fixed = holdsPart(type, (u) => typeof u !== "string" && ((u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit")) || u.kind === "handle" || u.kind === "dyn"));
    // A boxed async generator's one slot is its `next()`, whose future borrows the generator in
    // the Dyn's block and is boxed in turn. A generator runs once, so it is never copied.
    if (typeof type !== "string" && type.kind === "generator") {
      dynMembers.set(`${keyOf(leafFuture("next", type))} ${keyOf(lentPromise(nextResult(type.yields)))}`, { methods: [], fields: [], clone: undefined });
      return { methods: [undefined], fields: [], clone: undefined };
    }
    if (typeof type !== "string" && type.kind === "closure") {
      const body = closureBody(type);
      futureTable(body, to.of.methods[0]!.returns, false, e);
      return { methods: [body], fields: [], clone: fixed ? undefined : "copy" };
    }
    const methods = to.of.methods.map((m) => {
      const body = inherited(c!, "methods", m.name)!;
      // A generic method has no one function for the table; calls of it through a Dyn are refused.
      if (m.generic) return undefined;
      if (body.params.some((p) => p.comptime)) throw new CompileError(`'${show(type)}' can't be a '${show(to)}': its method '${m.name}' takes a comptime parameter, so it has a version per value and no one method a Dyn could call`, e.start, e.end);
      const refuse = (does: string, declare: string) => new CompileError(`'${show(type)}' can't be a '${show(to)}': its method '${m.name}' ${does}, which '${to.of.name}' doesn't declare; declare '${declare}' on it in the interface`, e.start, e.end);
      if (body.self?.owned && !m.owned) throw refuse("takes its object over", "this: Own<this>");
      if (body.self?.mutable && !body.self.owned && !m.mutable && !m.owned) throw refuse("changes its object", "this: Mut<this>");
      // An object-typed parameter takes exactly its own type through a Dyn; an interface or a
      // function has a version per argument type, and no one to call.
      const implicit = implicitOf(body);
      if ([...implicit.values()].some((b) => b.kind !== "object")) throw new CompileError(`'${show(type)}' can't be a '${show(to)}': its method '${m.name}' takes an interface or a function, so it has a version per argument type and no one to call through a Dyn`, e.start, e.end);
      const instance = instanceOf(body, new Map([...(body.scope ?? []), ...[...implicit].map(([i, b]): [string, Type] => [`#${i}`, b])]));
      futureTable(instance, m.returns, true, e);
      return instance;
    });
    const fields = to.of.fields.map((f) => (typeof type !== "string" && field(type, f.name) ? undefined : c && instanceOf(inherited(c, "getters", f.name)!)));
    const own = c?.methods.get("clone");
    return { methods, fields, clone: own ? instanceOf(own) : fixed ? undefined : "copy" };
  }

  // A slot giving a `Promise<T>` boxes the future its method or closure makes: borrowing the
  // Dyn's value for a method, owning its captures for a closure. Its vtable is made here.
  function futureTable(target: Instance, returns: Type, lent: boolean, at: Expr) {
    const gives = promiseElement(returns);
    if (gives === undefined) return;
    const made = lower(target.future ?? returnOf(target, at));
    if (typeof made === "string" || made.kind !== "future") throw unsupported("Dyn methods giving a Promise that isn't an async function's future", at);
    if (made.throws) throw new CompileError(`'${target.body.name}' can throw '${show(made.throws)}', and a Promise given through a Dyn or a stored function can't throw yet`, at.start, at.end);
    const boxed = lent ? lentPromise(gives) : storedType(returns);
    dynMembers.set(`${keyOf(made)} ${keyOf(boxed)}`, { methods: [], fields: [], clone: undefined });
  }

  // A method call through a Dyn: the interface's method, run through its slot.
  function dynCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: DynType): { type: Type; what: string } {
    if (callableOf.has(t.of)) throw new CompileError(`a stored function is called directly, as '${placeText(callee.object)}(...)'`, callee.start, callee.end);
    const index = t.of.methods.findIndex((m) => m.name === callee.name);
    const m = t.of.methods[index];
    if (!m) {
      const hint = t.of.fields.some((f) => f.name === callee.name) ? "; it is a field, read without calling" : didYouMean(callee.name, memberNames(t));
      throw new CompileError(`property '${shownName(callee.name)}' does not exist on type '${show(t)}'${hint}`, callee.start, callee.end);
    }
    if (linked(callee)) throw unsupported("optional chains calling methods through a Dyn", callee);
    if (m.generic) throw new CompileError(`'${m.name}' is generic, a family of methods made one per call, and a Dyn's table holds one function per method, so it can't be called through a Dyn; take a type parameter bounded by '${t.of.name}' instead`, callee.start, callee.end);
    const async = promiseElement(m.returns);
    if (async !== undefined && m.owned) throw unsupported("async methods taking their object over through a Dyn", callee);
    if (typeof m.returns !== "string" && m.returns.kind === "interface" && async === undefined) {
      throw new CompileError(`'${m.name}' returns the interface type '${m.returns.name}', which each type implementing '${t.of.name}' gives its own way, so a Dyn can't call it; have it return 'Dyn<${m.returns.name}>'`, callee.start, callee.end);
    }
    if (e.typeArgs.length > 0) throw new CompileError(`'${m.name}' takes no type arguments`, e.start, e.end);
    if (e.args.length !== m.params.length) throw new CompileError(`expected ${m.params.length} argument${m.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    // A reference it gives borrows the Dyn, unless the call frees the Dyn's block.
    if (holdsRef(m.returns)) {
      if (m.owned) throw new CompileError(`'${m.name}' takes its object over and frees it, so the reference it gives would point at nothing`, callee.start, callee.end);
      borrowsFrom.set(e, [callee.object]);
    }
    // A boxed async generator's `next()` runs it on, changing it.
    const mutable = m.mutable === true || generatorElement(t.of, true) !== undefined;
    if (m.owned) takesOver(callee.object, m.name);
    else if (mutable) mutates(callee.object, m.name);
    e.args.forEach((a, i) => {
      const want = m.params[i]!;
      expect(a, want);
      const given = value(a);
      coerce(a, given, want, `argument of type '${show(given)}' is not assignable to parameter of type '${show(want)}'`);
    });
    dynCalls.set(e, { index, mutable, owned: m.owned === true });
    // An async method's future, boxed, borrows the Dyn until it is done.
    if (async !== undefined) {
      borrowsFrom.set(e, [callee.object, ...e.args.filter(lends)]);
      return { type: lentPromise(async), what: `'${m.name}'` };
    }
    return { type: m.returns, what: `'${m.name}'` };
  }

  // A call of a stored callable: whatever expression gives it, run through its one slot.
  function callableCall(e: Call, callee: Expr, t: DynType): { type: Type; what: string } {
    const fn = callableOf.get(t.of)!;
    // A field holding it is read as any field is.
    if (!types.has(callee)) value(callee);
    if (e.typeArgs.length > 0) throw new CompileError("a stored function takes no type arguments", e.start, e.end);
    if (e.args.length !== fn.params.length) throw new CompileError(`expected ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    e.args.forEach((a, i) => {
      const want = fn.params[i]!;
      expect(a, want);
      const given = value(a);
      coerce(a, given, want, `argument of type '${show(given)}' is not assignable to parameter of type '${show(want)}'`);
    });
    if (holdsRef(fn.returns)) borrowsFrom.set(e, [callee]);
    dynCalls.set(e, { index: 0, mutable: false, owned: false, callable: callee });
    if (fn.throws) raise(e, fn.throws, callee.kind === "ident" || callee.kind === "member" ? `'${callee.name}'` : "this function");
    // One returning a Promise gives its future boxed, owning what it holds.
    return { type: storedType(fn.returns), what: "this function" };
  }

  // A field read through a Dyn, through its slot: a copy of the value.
  function dynField(e: Extract<Expr, { kind: "member" }>, t: DynType): Type {
    if (linked(e)) throw unsupported("optional chains through a Dyn", e);
    const f = t.of.fields.find((x) => x.name === e.name);
    if (!f) {
      const hint = t.of.methods.some((m) => m.name === e.name) ? "; it is a method, so call it" : didYouMean(e.name, memberNames(t));
      throw new CompileError(`property '${shownName(e.name)}' does not exist on type '${show(t)}'${hint}`, e.start, e.end);
    }
    // A copy of an Atomic, a Lock or a Dyn would change apart from the original.
    if (interiorMutable(f.type) || holdsHandle(f.type)) throw new CompileError(`'${e.name}' can't be read through a Dyn, which gives a copy of it, and a copy of a '${show(f.type)}' would change apart from the one the Dyn holds; read it through a method`, e.start, e.end);
    computed.add(e);
    return f.type;
  }

  // Whether a place is inside the value a callback is passed: its parameter, or a field of it.
  function isParamPath(e: Expr): boolean {
    while (e.kind === "member" || e.kind === "index") e = e.object;
    return e.kind === "ident" && locals.get(e)?.param === true;
  }

  // Whether `this` may change here. A closure changing it changes it where it was made.
  function changesThis(path: string, action: string, target: Expr) {
    if (closing) return changesCapture(undefined, path, action, target, false);
    if (self?.mutable) return;
    throw new CompileError(`cannot ${action} 'this${path}' because 'this' is read-only here; declare 'this: Mut<this>'`, target.start, target.end);
  }

  // Whether a variable may change here, at `path` inside it, possibly through a mutable
  // reference. A closure changing what it captures changes the variable where it was made.
  function changesLocal(local: Local, path: string, action: string, target: Expr, throughMut: boolean) {
    if (captured(local)) return changesCapture(local, path, action, target, throughMut);
    if (throughMut) return;
    // A shared reference never changes what it points to; a mutable one may, whatever holds
    // it, and a method may change through it.
    if ((path || action !== "assign to") && typeof local.type !== "string" && local.type.kind === "ref") {
      if (local.type.mutable) return;
      throw new CompileError(`cannot ${action} '${local.name}${path}' because '${local.name}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
    }
    if (local.param) {
      const what = action === "assign to" ? "assigning to" : action === "mutably borrow" ? "mutably borrowing" : "calling a mutating method on";
      throw new CompileError(`${what} a parameter is not supported yet; copy it into a 'let'`, target.start, target.end);
    }
    if (!local.mutable) {
      const what = path ? `'${local.name}${path}' because '${local.name}'` : `'${local.name}' because it`;
      throw new CompileError(`cannot ${action} ${what} is a constant`, target.start, target.end);
    }
  }

  // A readonly field can't change once constructed, nor can anything inside it. Only its own
  // class's constructor may assign it, through `this`.
  function readonly(e: Extract<Expr, { kind: "member" }>, target: Expr, action: string) {
    const found = types.get(e.object);
    const object = typeof found !== "string" && found?.kind === "ref" ? found.to : found;
    if (object && stringLike(object)) throw new CompileError(`a string's '${e.name}' can't be changed; strings can't be changed, so build a new one instead`, target.start, target.end);
    // Through a mutable reference, the value written is someone else's: in an instance, its
    // field is as read-only as the field of the type it really is. A copy is the body's own.
    const locked = field(object as Exclude<Type, string>, e.name)?.readonly || (throughMutable(e.object) && concreteField(e)?.readonly);
    if (typeof object === "string" || !object || !locked) return;
    if (e === target && e.object.kind === "this" && self?.constructor && self.type.fields.some((f) => f.name === e.name)) return;
    const what = e === target ? `'${e.name}' because it is` : `'${placeText(target)}' because '${e.name}' is`;
    throw new CompileError(`cannot ${action} ${what} a read-only property`, target.start, target.end);
  }

  // Whether a place is reached through a mutable reference anywhere along its path; `this`
  // is one, to the object the method was called on.
  function throughMutable(e: Expr): boolean {
    for (let x = e; ; x = x.object) {
      const t = types.get(x);
      if (typeof t !== "string" && t?.kind === "ref" && t.mutable) return true;
      if (x.kind !== "member") return x.kind === "this" || x.kind === "super";
    }
  }

  // A field as the concrete types along its path declare it, type parameters taken as what
  // they stand for in this instance.
  function concreteField(e: Extract<Expr, { kind: "member" }>): Field | undefined {
    const holder = concreteType(e.object);
    return holder && typeof holder !== "string" ? field(holder, e.name) : undefined;
  }

  function concreteType(e: Expr): Type | undefined {
    const deref = (t: Type | undefined) => {
      const low = t && lower(t);
      return typeof low !== "string" && low?.kind === "ref" ? lower(low.to) : low;
    };
    if (e.kind !== "member") return deref(types.get(e));
    const holder = concreteType(e.object);
    return holder && typeof holder !== "string" ? deref(field(holder, e.name)?.type) : undefined;
  }

  // How a place reads in a message, like `p.inner.x`.
  function placeText(e: Expr): string {
    const rest = restText(restStarts, e, placeText);
    if (rest) return rest;
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${placeText(e.object)}[${e.name}]` : `${placeText(e.object)}.${shownName(e.name)}`;
    if (e.kind === "index") return `${placeText(e.object)}[${indexText(e.index)}]`;
    return e.kind === "ident" ? e.name : e.kind === "this" ? "this" : "(...)";
  }

  // An operator works on a literal's base type, so `1` adds like any i64.
  function operand(e: Expr): Type {
    return widen(e, read(e));
  }

  // A value that is only read, seen through a reference to it.
  function read(e: Expr): Type {
    return loaded(e, value(e));
  }

  // A checked value of `type`, loaded from where it points when it is a reference.
  function loaded(e: Expr, type: Type): Type {
    if (typeof type === "string" || type.kind !== "ref") return type;
    coercions.set(e, type.to);
    return type.to;
  }

  // An operand of an enum, a union of integer literals, works as an i64 too.
  function widen(e: Expr, type: Type): Type {
    // A pattern's value is a string, as is a union of patterns and string literals.
    if (holdsPattern(type) && lower(type) === "string") {
      coercions.set(e, "string");
      return "string";
    }
    const literals = typeof type !== "string" && type.kind === "union" ? type.members : [type];
    const bases = new Set(literals.map((t) => (typeof t !== "string" && t.kind === "literal" ? baseOf(t) : undefined)));
    const base = bases.size === 1 ? [...bases][0] : undefined;
    // A string literal keeps its type, so comparing two different ones is caught.
    if (!base || base === "string") return type;
    coercions.set(e, base);
    return base;
  }

  // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
  function condition(e: Expr) {
    const type = operand(e);
    if (isOption(type)) throw new CompileError(`condition must be a boolean, not the Option '${show(type)}'; check it with '!== null'`, e.start, e.end);
    if (type !== "boolean") {
      throw new CompileError(`condition must be a boolean, not '${show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
    }
  }
}

// A string, or a string literal that isn't an enum's member.
const isText = (t: Type) => t === "string" || (typeof t !== "string" && (t.kind === "pattern" || (t.kind === "literal" && typeof t.value === "string" && !t.owner)));

// A string enum's member, or a union of them, which joins into a string as its value.
const enumText = (t: Type): boolean => typeof t !== "string" && (t.kind === "union" ? t.members.every(enumText) : t.kind === "literal" && typeof t.value === "string" && t.owner !== undefined);

// What a string's length, index and methods work on: text, or a union of string literals.
export const stringLike = (t: Type) => isText(t) || (typeof t !== "string" && t.kind === "union" && t.members.every(isText));

// The blocking file calls std's node:fs is written over: their parameters, what each gives, and
// whether it throws an IoError.
const syncFileSignatures = ({ arrayType, tupleType }: Typing): Record<string, [Type[], Type, boolean]> => ({
  fileReadSync: [["string"], arrayType("u8"), true],
  fileWriteSync: [["string", arrayType("u8")], "void", true],
  pathExists: [["string"], "boolean", false],
  // Size, mode, modification time in milliseconds, and kind: 1 a file, 2 a directory, 3 a link.
  pathStat: [["string", "boolean"], tupleType(["i64", "i64", "f64", "i64"]), true],
  dirRead: [["string"], arrayType("string"), true],
  pathReal: [["string"], "string", true],
  dirTemp: [["string"], "string", true],
  pathRemove: [["string", "boolean", "boolean"], "void", true],
  // A command, its arguments, the working directory ("" for this one's) and stdin, giving the
  // pid, exit status (-1 for a signal), signal number, stdout and stderr.
  processSpawn: [["string", arrayType("string"), "string", arrayType("u8")], tupleType(["i64", "i64", "i64", arrayType("u8"), arrayType("u8")]), true],
});

// Each string method: its parameters, what it returns, and how many arguments it needs.
const stringMethods = ({ unionType, arrayType }: Typing): Record<string, [Type[], Type, number]> => ({
  charCodeAt: [["usize"], "u16", 1],
  at: [["i64"], unionType(["string", "null"]), 1],
  charAt: [["i64"], "string", 1],
  codePointAt: [["usize"], unionType(["u32", "null"]), 1],
  lastIndexOf: [["string", "i64"], "i64", 1],
  indexOf: [["string", "i64"], "i64", 1],
  includes: [["string", "i64"], "boolean", 1],
  startsWith: [["string", "i64"], "boolean", 1],
  endsWith: [["string", "i64"], "boolean", 1],
  split: [["string", "usize"], arrayType("string"), 0],
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

const isArray = (t: Type): t is ArrayType => typeof t !== "string" && t.kind === "array";
const isFixed = (t: Type): t is FixedType => typeof t !== "string" && t.kind === "fixed";

// The methods an array has.
// A type's name with its article, as `an 'i64'` or `a 'string'`.
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} '${name}'`;

// The methods that run a callback on each element.
const CALLBACK_METHODS = new Set(["map", "filter", "find", "some", "every", "reduce", "forEach", "flatMap", "findIndex"]);
// Generators' iterator helpers, and the std function each calls.
const GENERATOR_HELPERS: Record<string, string> = {
  map: "iter map", filter: "iter filter", take: "iter take", drop: "iter drop", flatMap: "iter flat map",
  reduce: "iter reduce", toArray: "array collect", forEach: "iter for each", some: "iter some", every: "iter every", find: "iter find",
};
// The callback methods whose callback decides yes or no.
const PREDICATES = new Set(["filter", "find", "some", "every", "findIndex"]);
// The methods that read an array's elements by value.
const READING_METHODS = new Set(["includes", "indexOf", "lastIndexOf", "join", "slice", "concat", "flat"]);
// The methods that change an array in place, beside push, pop and sort.
const CHANGING_METHODS = new Set(["shift", "unshift", "splice", "reverse", "fill", "reserve", "shrinkToFit"]);
// The methods giving an iterator over an array, as generators in the prelude.
const ITERATORS: Record<string, string> = { entries: "array entries", keys: "array keys", values: "array values" };
// `u8`'s statics decoding text into bytes, and the prelude function each calls.
const BYTE_DECODERS: Record<string, string> = { fromBase64: "array from base64", fromHex: "array from hex" };
// The methods encoding a `u8[]` as text, and the prelude function each calls.
const BYTE_METHODS: Record<string, string> = { toBase64: "array to base64", toHex: "array to hex" };
// A Map's and a Set's methods, how many arguments each takes, and those changing it.
const MAP_METHODS = new Set(["set", "get", "has", "delete", "clear", "update", "keys", "values", "entries", "forEach"]);
const SET_METHODS = new Set(["add", "has", "delete", "clear", "keys", "values", "entries", "forEach"]);
const MAP_ARGUMENTS: Record<string, number> = { set: 2, add: 1, get: 1, has: 1, delete: 1, clear: 0, update: 2, keys: 0, values: 0, entries: 0, forEach: 1 };
export const MAP_CHANGES = new Set(["set", "add", "delete", "clear", "update"]);
const ARRAY_METHODS = new Set(["push", "pop", "sort", "at", ...Object.keys(ITERATORS), ...Object.keys(BYTE_METHODS), ...CALLBACK_METHODS, ...READING_METHODS, ...CHANGING_METHODS]);

