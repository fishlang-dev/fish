import { inherited, type Body, type ClassInfo } from "./classes.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { CompileError, indexText } from "./diag.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, ObjectProp, Param, Pattern, Span, Stmt, TypeNode } from "./parser.ts";
import { bindings, literalOf, made, missing, objectFields, uncovered, type PatternInfo, type PatternTest, type Shape } from "./match.ts";
import { channel, fields, interior, shareable, tagStrings } from "./resolve.ts";
import { infer } from "./generics.ts";
import { allFields, arrayType, elementsOf, isTuple, tupleType, baseOf, handleType, nextResult, pointerType, SLEEP, unionType, yieldsOf, YIELD_NOW, unlocks, INTEGERS, isFloat, isInteger, isNumeric, isOption, range, derives, field, fits, holdsHandle, holdsPart, functionType, keyOf, callableOf, sameCallable, promiseElement, borrowing, lentPromise, stored as storedType, type DynType, blockType, leafFuture, leafOf, type BlockType, holdsInterior, interiorMutable, interiorType, sharedCallbacks, type SharedType, holdsMut, INTERIORS, lockCallbacks, type InteriorType, holdsRef, isCopy, literalType, lower, refType, objectType, show, widenEnum, widenLet, wrapped , sameLowered, holdsPattern } from "./typing.ts";
import type { Access, ArrayType, GeneratorType, LiteralType, PointerType, VariantType, Bound, Integer, Numeric, UnionType, ClassType, ClosureType, Field, FunctionType, ObjectType, RefType, Type } from "./typing.ts";
import type { EnumInfo, EnumInstance } from "./enums.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import { STD_BASE } from "./std.ts";
import type { Instance, Local } from "./check.ts";
import { literalValue, type Facts, type Guard } from "./narrow.ts";
import { bothSides, comparable, objectsMeet, instanceofCheck, intoMember, intoUnion, literalShape, typeofComparison, unionComparison, unionField, type Union } from "./unions.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

// The operators an expression of only literals may use and still take its type from context.
const LITERAL_OPERATORS = new Set<string>(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"]);
const BITWISE_OPERATORS = new Set<string>(["&", "|", "^", "<<", ">>", ">>>"]);

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && callee.name === "log" &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

const isRefType = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

const printable = (t: Type): boolean =>
  typeof t === "string" || t.kind === "literal" || t.kind === "pattern" || (t.kind === "union" && t.members.every(printable));

// What expression checking needs from the program and the function it is in.
export type Context = {
  types: Map<Expr, Type>;
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  coercions: Map<Expr, Type>;
  calls: Map<Expr, Instance>;
  setters: Map<Expr, Instance>;
  byName: Map<string, Body>;
  classes: Map<string, ClassInfo>;
  enums: Map<string, EnumInfo>;
  // A data-carrying enum made with these type arguments.
  enumInstance(info: EnumInfo, args: Type[], at: Span): EnumInstance;
  construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined;
  members: Members;
  returnOf(instance: Instance, at: Span): Type;
  // What a call returns as the calling body sees it: in terms of the calling instance's own
  // type parameters, where it passed them.
  resultOf(instance: Instance, at: Span): Type;
  // What a call's returned reference borrows from, and the record of it for each call.
  sourcesOf(instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[];
  borrowsFrom: Map<Expr, Expr[]>;
  classOf(t: ClassType): ClassInfo;
  instanceOf(f: Body, bindings?: Map<string, Type>): Instance;
  instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance;
  paramTypes(instance: Instance): Type[];
  // The binding a name refers to; `at`, the use, is where a closure first captures it.
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  // Notes a closure's use of `this`, which it captures.
  noteThis(e: Expr): void;
  self: Body["self"];
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  // A derived constructor's `super(...)`, the one place a base constructor may be called.
  superCall: Expr | undefined;
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
  patterns: Map<Pattern, PatternInfo>;
  copiesOut: Set<Expr>;
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
  awaitable: Set<Expr>;
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
  closureBody(t: ClosureType): Instance;
  // The bounds of a body's implicit type parameters, by parameter index.
  implicitOf(f: Body): Map<number, Bound>;
  // Rejects a constructor call lending a value mutably as a type parameter that would let its
  // read-only fields be written.
  constructs(f: Body, args: Expr[], argTypes: Type[]): void;
  // Whether a variable whose type is still open takes `to`, for a use needing it.
  infer(e: Expr, to: Type): boolean;
};

// The member reads a pipe wrote in for its topic. A generic body is checked once, so whether one
// is a stored field or a getter's is only known for each instance.
export const substituted = new WeakSet<Expr>();

// The calls a tagged template became, the only calls yet that fill a rest parameter.
const tagCalls = new WeakSet<Expr>();

// The array literals that became tuples, as objects of fields `0`, `1` and on, which a generic
// body's next instance checks again as tuples.
const tupleLiterals = new WeakSet<Expr>();

const isCallable = (t: Type) => typeof t !== "string" && t.kind === "dyn" && callableOf.has(t.of);

// Member reads the runtime computes, like `c.signal` and `signal.aborted`, and fields read
// through a Dyn: values, not places.
export const computed = new WeakSet<Expr>();

// For each concrete type boxed into a Dyn, by the keys of the type and the Dyn: the instance
// each interface method runs, then for each field the getter supplying it, or none when it is
// a field. And each method call through a Dyn, with the receiver its interface declares.
export const dynMembers = new Map<string, DynTable>();

// What a type's Dyn runs: each method's instance, each field's getter (none for a field), and
// what '.clone()' runs: the class's own `clone`, the compiler's copy, or nothing when the type
// can't be cloned.
export type DynTable = { methods: Instance[]; fields: (Instance | undefined)[]; clone: Instance | "copy" | undefined };
export const dynCalls = new WeakMap<Expr, { index: number; mutable: boolean; owned: boolean; callable?: Expr }>();

export function expressions(ctx: Context) {
  const { types, locals, coercions, calls, setters, byName, classes, enums, construct, members, returnOf, resultOf, sourcesOf, borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup } = ctx;
  const { self, owner, superCall, thisReady, proves, assume, narrowed, reachable, captured, closing, changesCapture, noteThis, raise, errorOf, thrown, rewritten, depthOf, closure, closureBody, implicitOf, resolveType, constructs } = ctx;
  // The function type each arrow is given to, which types the parameters it leaves unwritten.
  const expecting = new Map<Expr, FunctionType>();
  // The type each generic enum's member is expected to have, by the member expression.
  const wanted = new Map<Expr, Type>();
  // Arrows checked to own what they capture, being stored.
  const owning = new WeakSet<Expr>();
  // Array literals written where a tuple is expected, which are that tuple, and those passed where
  // a generic function takes a tuple, which are a tuple of their own elements' types.
  const tuples = new Map<Expr, ObjectType>();
  const shaped = new WeakSet<Expr>();
  // Objects of index expressions already checked, which their next read takes as checked.
  const once = new WeakSet<Expr>();
  // Names used as the object of a field read, an index or a method call.
  const objects = new WeakSet<Expr>();
  const oversized: Extract<Expr, { kind: "int" }>[] = [];
  // How many \`unsafe\` blocks enclose the code being checked.
  let unsafeDepth = ctx.unsafe ? 1 : 0;
  // Literals found to fit the type they were given, `-9223372036854775808` among them.
  const fitted = new Set<Expr>();
  // Powers of literals whose exponent no u32 holds, unless they became floats.
  const powers: [Expr, Expr][] = [];
  const unions: Union = {
    types, coercions, value: (e) => read(e), excess: (e, to) => excess(e, to),
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
    if (e.kind === "arrow" && typeof t !== "string" && t.kind === "function") expecting.set(e, t);
    // An arrow for a union holding one callable, like an optional callback, is stored as that
    // callable.
    const callables = e.kind === "arrow" && typeof t !== "string" && t?.kind === "union" ? t.members.filter(isCallable) : [];
    if (callables.length === 1) t = callables[0]!;
    // An arrow written where a callable is stored captures by move: the callable owns it all.
    if (e.kind === "arrow" && typeof t !== "string" && t.kind === "dyn" && callableOf.has(t.of)) {
      expecting.set(e, callableOf.get(t.of)!);
      owning.add(e);
      wanted.set(e, t);
    }
    // An array literal's elements are expected to be its element type, and an object literal's
    // properties their fields'.
    if (e.kind === "array" && isArray(t)) {
      wanted.set(e, t.element);
      for (const x of e.elements) if (x) expect(x, t.element);
    }
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
    if (e.kind === "object" && typeof t !== "string" && (t.kind === "object" || t.kind === "class")) {
      for (const p of e.props) if (p.kind === "property" && typeof p.key === "string" && field(t, p.key)) expect(p.value, field(t, p.key)!.type);
    }
    if (e.kind === "new" && typeof t !== "string" && (t.kind === "interior" || t.kind === "block")) wanted.set(e, t);
    if (e.kind === "call" && e.callee.kind === "ident" && e.callee.name === "shared" && typeof t !== "string" && t.kind === "shared") wanted.set(e, t);
    const built = e.kind === "call" ? e.callee : e;
    if (built.kind === "member" && built.object.kind === "ident" && !lookup(built.object.name) && enums.get(built.object.name)?.data) wanted.set(built, t);
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
    if (e.kind === "tagged") untag(e);
    if (e.kind !== "call") return value(e);
    // A call returning a value records it, as reading any other value does.
    const { type } = call(e);
    if (type !== "void") types.set(e, type);
    return type;
  }

  // Only a statement may call a function that returns nothing.
  function effect(e: Expr) {
    if (e.kind === "tagged") untag(e);
    if (e.kind === "call") {
      const { type } = call(e);
      if (typeof type !== "string" && type.kind === "future" && leafOf.has(type)) {
        throw new CompileError("this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'", e.start, e.end);
      }
    } else if (e.kind === "match") match(e, false);
    else if (e.kind === "pipe") pipe(e, false);
    else if (e.kind === "unary" && e.op === "await") {
      const gives = awaited(e);
      if (gives !== "void") types.set(e, gives);
    }
    else value(e);
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
    const example = uncovered(e.arms.filter((a) => !a.guard).map((a) => [a.pattern]), [subject], (p) => ctx.patterns.get(p));
    if (example) throw new CompileError(missing(example[0]!, subject), e.start, e.subject.end + 1);
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
        e.body = topics(e.body, (at) => ({ kind: "ident", name: "%", start: at.start, end: at.end }));
        if (!wanted) return effect(e.body), "void";
        const given = value(e.body);
        if (holdsRef(given)) throw new CompileError("a pipe over a value can't give a reference yet, since the value is dropped once the pipe ends; give a copy with '.clone()'", e.start, e.end);
        return given;
      });
    }
    const place = e.value;
    const body = topics(e.body, (at) => {
      const copy = spanned(structuredClone(place), at);
      for (let m: Expr = copy; m.kind === "member" || m.kind === "index"; m = m.object) if (m.kind === "member") substituted.add(m);
      return copy;
    });
    for (const key of Object.keys(e)) delete (e as Record<string, unknown>)[key];
    Object.assign(e, body);
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
    const result = callee(e);
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
      const argTypes = e.args.map(value);
      const instance = instantiate(base.constructor, [], e.args, argTypes, e);
      args(e.args, argTypes, instance, e);
      calls.set(e, instance);
      return { type: "void", what: "'super'" };
    }
    if (isPrint(callee)) {
      for (const a of e.args) {
        const type = a.kind === "string" ? "void" : read(a);
        if (printable(type)) continue;
        throw new CompileError(typeof type !== "string" && type.kind === "param" ? `a value of type '${type.name}' can't be printed`
          : isArray(type) ? "printing an array is not supported yet; print its elements"
          : holdsVariant(type) ? "printing an enum that holds data is not supported yet"
          : "printing an object is not supported yet; print its fields", a.start, a.end);
      }
      return { type: "void", what: "printing" };
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "AbortSignal" && !lookup("AbortSignal") && !classes.has("AbortSignal")) {
      return signalTimeout(e, callee);
    }
    if (callee.kind === "member" && callee.object.kind === "ident" && (callee.object.name === "TcpListener" || callee.object.name === "TcpStream") && !lookup(callee.object.name) && !classes.has(callee.object.name)) {
      return tcpStatic(e, callee, callee.object.name);
    }
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? receiverType(callee) : undefined;
    if (callee.kind === "member" && callee.name === "clone" && receiver && copies(receiver)) return cloned(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && stringLike(receiver)) return stringCall(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && isArray(receiver)) return arrayCall(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && yieldsOf(receiver) !== undefined) return generatorCall(e, callee, receiver, yieldsOf(receiver)!);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "pointer") return pointerCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "interior") return interiorCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "shared") return sharedCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "block") return blockCall(e, callee, receiver);
    if (callee.kind === "member" && callee.name !== "clone" && typeof receiver !== "string" && receiver?.kind === "dyn") return dynCall(e, callee, receiver);
    if (callee.kind === "ident" && callee.name === "shared" && !lookup(callee.name) && !byName.has("shared")) return sharedNew(e);
    // A field holding a stored callable, through an object-typed parameter's bound too.
    if (callee.kind === "member" && typeof receiver !== "string" && receiver?.kind === "param" && receiver.bound?.kind === "object") {
      const stored = field(receiver.bound, callee.name);
      const held = stored && lower(isRefType(stored.type) ? stored.type.to : stored.type);
      if (held && isCallable(held)) return callableCall(e, callee, held as DynType);
    }
    if (callee.kind === "member" && typeof receiver !== "string" && (receiver?.kind === "param" || receiver?.kind === "interface")) {
      return traitCall(e, callee, receiver);
    }
    if (callee.kind === "ident" && lookup(callee.name)) return closureCall(e, callee);
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
    if (callee.kind === "ident" && callee.name === "spawn" && (!byName.has("spawn") || inStd)) {
      if (!ctx.async) throw new CompileError("'spawn' can only be used inside an 'async' function, where the runtime is running", callee.start, callee.end);
      if (e.args.length !== 1) throw new CompileError("'spawn' takes the Promise to run, like 'spawn(save(user))'", e.start, e.end);
      // `spawn(async () => ...)` runs the arrow's body as the task: its call is what is spawned.
      const given = e.args[0]!;
      if (given.kind === "arrow" && given.async && given.params.length === 0) {
        e.args[0] = { kind: "call", callee: given, typeArgs: [], args: [], optional: false, start: given.start, end: given.end };
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
    // `String(x)`: a string, number or boolean written as JavaScript writes it.
    if (callee.kind === "ident" && callee.name === "String" && (!byName.has("String") || inStd)) {
      if (e.args.length !== 1) throw new CompileError("'String' takes 1 argument", e.start, e.end);
      joined(e.args[0]!, operand(e.args[0]!), "'String'");
      return { type: "string", what: "'String'" };
    }
    const target = callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee, receiver) : undefined;
    if (!target) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
    }
    if (target.foreign) needsUnsafe(`calling the C function '${target.name}'`, callee, "the compiler can't check what C code does");
    if (target.params.at(-1)?.rest && !tagCalls.has(e)) {
      throw new CompileError(`'${target.name}' takes a rest parameter, which so far only a tag's values fill; call it as a tag, as in ${target.name}\`text \${value}\``, e.start, e.end);
    }
    expectFrom(target, e.args);
    const argTypes = e.args.map(value);
    const instance = instantiate(target, e.typeArgs, e.args, argTypes, e);
    args(e.args, argTypes, instance, e);
    calls.set(e, instance);
    // An async function's call only makes its future; its error comes at the `await`.
    const error = errorOf(instance);
    if (error && !target.async) raise(e, error, `'${target.name}'`);
    const type = resultOf(instance, e);
    const object = callee.kind === "member" && instance.body.self ? callee.object : undefined;
    // A returned reference borrows what its lifetime says; a value holding references, what
    // was lent to the call, its receiver included.
    if (holdsRef(type)) borrowsFrom.set(e, sourcesOf(instance, e.args, object, e, lends));
    return { type, what: `'${target.name}'` };
  }

  // `` tag`a ${x} b` `` calls the tag with the template's text, known while compiling, then an
  // array of its values for the tag's rest parameter.
  function untag(e: Extract<Expr, { kind: "tagged" }>) {
    const { tag, template } = e;
    const target = tag.kind === "ident" && !lookup(tag.name) ? byName.get(tag.name) : undefined;
    if (tag.kind === "ident" && !target && !lookup(tag.name)) throw new CompileError(`unknown function '${tag.name}'`, tag.start, tag.end);
    if (!target || tag.kind !== "ident") throw new CompileError("a tag has to be the name of a top-level function; methods, closures and other values as tags aren't supported yet", tag.start, tag.end);
    const shape = `'comptime strings: TemplateStringsArray, ...values: T[]'`;
    if (!tagStrings(target.params[0])) {
      throw new CompileError(`'${tag.name}' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray', so the template's text is known while compiling; tags that run on the text at run time aren't supported yet`, tag.start, tag.end);
    }
    if (target.params.length !== 2 || !target.params[1]!.rest) throw new CompileError(`'${tag.name}' can't be a tag: a tag takes ${shape}`, tag.start, tag.end);
    if (template.kind !== "template") throw new CompileError("a tag is followed by a template literal", template.start, template.end);
    const at = { start: template.start, end: template.end };
    const strings: Expr = { kind: "array", elements: template.quasis.map((value) => ({ kind: "string", value, ...at })), ...at };
    const values: Expr = { kind: "array", elements: template.exprs, ...at };
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
      if (t?.kind === "function") expect(a, t);
      // An arrow in an object literal given for an object-typed parameter takes its field's type.
      if (t?.kind === "object" && a.kind === "object") {
        for (const p of a.props) {
          const want = p.kind === "property" && p.value.kind === "arrow" ? field(t, p.key as string)?.type : undefined;
          if (want && p.kind === "property") expect(p.value, want);
        }
      }
      // A parameter of a function that isn't generic has its type before the call.
      if (a.kind !== "arrow" && known) expect(a, known[i]!);
      if (!known && (a.kind === "array" || tupleLiterals.has(a)) && target.params[i]?.type?.kind === "tuple") shaped.add(a);
    });
  }

  // A call gives every parameter but the optional ones it leaves out, which come last.
  function arity(given: number, params: Param[], at: Span) {
    const required = params.filter((p) => !p.optional).length;
    if (given >= required && given <= params.length) return;
    const expected = required === params.length ? `${required}` : `${required}-${params.length}`;
    throw new CompileError(`expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${given}`, at.start, at.end);
  }

  // A call of a closure held by a variable runs the closure's body.
  function closureCall(e: Call, callee: Expr, known?: Type): { type: Type; what: string } {
    const held = known ?? value(callee);
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this function";
    const through = lower(isRefType(held) ? held.to : held);
    if (isCallable(through)) return callableCall(e, callee, through as DynType);
    // A parameter of a function type calls it through its signature; its instance, the
    // closure it was given.
    const type = typeof held !== "string" && held.kind === "param" && held.bound?.kind === "function" ? held.bound : held;
    if (typeof type === "string" || (type.kind !== "closure" && type.kind !== "function")) {
      throw new CompileError(`this expression is not callable: type '${show(type)}' has no call signatures`, callee.start, callee.end);
    }
    if (e.typeArgs.length > 0) throw new CompileError(`${name} takes no type arguments`, e.start, e.end);
    const written = type.kind === "closure" ? closureBody(type).body.params : undefined;
    if (written) arity(e.args.length, written, e);
    else if (e.args.length !== type.params.length) {
      throw new CompileError(`expected ${type.params.length} argument${type.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      if (a.kind !== "arrow") expect(a, type.params[i]!);
      coerce(a, value(a), type.params[i]!, `argument of type '${show(types.get(a)!)}' is not assignable to parameter of type '${show(type.params[i]!)}'`);
    });
    const given = lower(held);
    if (typeof given !== "string" && given.kind === "closure") calls.set(e, closureBody(given));
    // Where the signature says `Promise<T>`, the call gives the future of the closure it was given.
    const returns = typeof given !== "string" && given.kind === "closure" && promiseElement(type.returns) !== undefined ? given.returns : type.returns;
    // An async arrow's future holds a copy of what it captured, references too.
    if (typeof returns !== "string" && returns.kind === "future" && holdsRef(returns)) borrowsFrom.set(e, [callee]);
    return { type: returns, what: name };
  }

  // A call of one of a string's methods, which takes its arguments as the method's parameters.
  function stringCall(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    text(callee.object, receiver, linked(callee));
    const method = STRING_METHODS[callee.name];
    if (!method) throw new CompileError(`strings have no method '${callee.name}' yet`, callee.start, callee.end);
    const [params, returns, required] = method;
    if (e.args.length < required || e.args.length > params.length) {
      const count = required === params.length ? `${required}` : `${required} or ${params.length}`;
      throw new CompileError(`'${callee.name}' takes ${count} argument${params.length === 1 ? "" : "s"}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const t = value(a);
      coerce(a, t, params[i]!, `argument of type '${show(t)}' is not assignable to parameter of type '${show(params[i]!)}'`);
    });
    return { type: returns, what: `'${callee.name}'` };
  }

  // An array's method: `push` moves a value in at the end; `pop` takes the last one out, or
  // gives an empty Option. Both change the array.
  function arrayCall(e: Call, callee: Extract<Expr, { kind: "member" }>, array: ArrayType): { type: Type; what: string } {
    if (!ARRAY_METHODS.has(callee.name)) throw new CompileError(`arrays have no method '${callee.name}' yet`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling array methods", callee);
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, array);
    if (CALLBACK_METHODS.has(callee.name)) return callbackCall(e, callee, array);
    if (READING_METHODS.has(callee.name)) return readingCall(e, callee, array);
    if (callee.name === "sort") return sortCall(e, callee, array);
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
    if (callback.kind !== "arrow") throw new CompileError(`'${name}' takes an arrow function written in place; passing a function by name isn't supported yet`, callback.start, callback.end);
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
      if (!fits(params[i]!, p)) throw new CompileError(`'${name}' passes its callback ${article(show(params[i]!))} here, not ${article(show(p))}`, at.start, at.end);
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
    if (compare.kind !== "arrow") throw new CompileError("'sort' takes a comparator written in place, like '(a, b) => a - b'; passing a function by name isn't supported yet", compare.start, compare.end);
    if (compare.params.length > 2) throw new CompileError("'sort' passes its comparator two elements", compare.params[2]!.start, compare.params[2]!.end);
    const element = isCopy(array.element) ? array.element : refType(array.element, false);
    expect(compare, functionType(["a", "b"], [element, element], "void"));
    const c = value(compare);
    if (typeof c === "string" || c.kind !== "closure") throw new CompileError("'sort' takes a comparator like '(a, b) => a - b'", compare.start, compare.end);
    runsOften(c, "sort", "its comparator many times", compare);
    c.params.forEach((p) => {
      if (!fits(element, p)) throw new CompileError(`'sort' passes its comparator a '${show(element)}' here, not a '${show(p)}'`, compare.start, compare.end);
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
    };
    const [least, most, takes] = counts[name]!;
    if (e.args.length < least || e.args.length > most) throw new CompileError(`'${name}' takes ${takes}`, e.start, e.end);
    if (name === "unshift") e.args.forEach(element);
    if (name === "splice") e.args.forEach((a, i) => (i < 2 ? position(a) : element(a)));
    if (name === "fill") e.args.forEach((a, i) => (i === 0 ? element(a) : position(a)));
    const what = `'${name}', which changes its array in place,`;
    if (name === "shift") return { type: unionType([array.element, "null"]), what: "'shift'" };
    if (name === "splice") return { type: array, what: "'splice'" };
    return { type: "void", what };
  }

  // `[a, b]` written where a tuple is expected: each element checked against its own type, then
  // the literal becomes the object of fields `0`, `1` and on that the tuple is laid out as.
  function tupleLiteral(e: Expr, tuple: ObjectType): Type {
    const elements = elementsOf(tuple);
    const given = tupleParts(e) as Expr[];
    if (given.length !== elements.length) {
      throw new CompileError(`type '${show(tuple)}' has ${elements.length} element${elements.length === 1 ? "" : "s"}, but this literal has ${given.length}`, e.start, e.end);
    }
    const spread = given.find((x) => x.kind === "spread");
    if (spread) throw unsupported("spread elements in tuple literals", spread);
    given.forEach((x, i) => {
      const t = value(x);
      coerce(x, t, elements[i]!, `type '${show(t)}' is not assignable to type '${show(elements[i]!)}'`);
    });
    if (e.kind === "array") {
      Object.assign(e, { kind: "object", props: given.map((value, i) => ({ kind: "property", key: String(i), value, start: value.start, end: value.end })) });
      delete (e as { elements?: unknown }).elements;
      tupleLiterals.add(e);
    }
    return tuple;
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
    const count = (object as ObjectType).fields.length;
    if (e.index.kind !== "int") throw new CompileError(`a tuple's element is named by a number written in place, like '[0]'; '${show(object)}' has no element for a computed index`, e.index.start, e.index.end);
    const n = e.index.value;
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
    const given = e.typeArgs[0] ? resolveType(e.typeArgs[0]) : typeof expected !== "string" && expected?.kind === "interior" && expected.which === which ? expected.of : undefined;
    if (given) expect(list[0]!, given);
    const t = value(list[0]!);
    const of = given ?? widenLet(t);
    coerce(list[0]!, t, of, `argument of type '${show(t)}' is not assignable to parameter of type '${show(of)}'`);
    return interior(which, of, e);
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
    return channel(of, e);
  }

  // A Semaphore's `acquire()` and `available()`, and a Channel's `send(v)`, `receive()` and
  // `close()`. A Permit has no methods: dropping it gives its slot back.
  function blockCall(e: Call, callee: Extract<Expr, { kind: "member" }>, t: BlockType): { type: Type; what: string } {
    // A wait may also take an AbortSignal, as its last argument.
    const sockets = ["accept", "read", "write"].includes(callee.name);
    const waits = callee.name === "acquire" || callee.name === "send" || callee.name === "receive" || sockets;
    const methods: Record<string, number> = t.which === "Semaphore" ? { acquire: 0, available: 0 } : t.which === "Channel" ? { send: 1, receive: 0, close: 0 }
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
    if (callee.name === "send") {
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
    if (callee.name === "close") return { type: "void", what: "'close'" };
    return { type: leafFuture(callee.name as "acquire" | "send" | "receive", lower(t.of), signalled ? abortError() : undefined, signalled), what: `'${callee.name}'` };
  }

  // `AbortSignal.timeout(ms)`: a new signal that aborts itself after ms milliseconds.
  function signalTimeout(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    if (callee.name !== "timeout") throw new CompileError(`'AbortSignal' has no static method '${callee.name}'; it has 'timeout'`, callee.start, callee.end);
    // The std library's own code is compiled whatever main is; a sync main never reaches it.
    if (!ctx.runtime && e.start < STD_BASE) throw new CompileError("'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function", e.start, e.end);
    if (e.args.length !== 1) throw new CompileError("'AbortSignal.timeout' takes how many milliseconds until it aborts, like 'AbortSignal.timeout(5000)'", e.start, e.end);
    expect(e.args[0]!, "i64");
    const t = value(e.args[0]!);
    coerce(e.args[0]!, t, "i64", `'AbortSignal.timeout' takes milliseconds as an 'i64', not '${show(t)}'`);
    return { type: blockType("AbortSignal"), what: "'AbortSignal.timeout'" };
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

  // The std `AbortError` class, which aborted work throws.
  function abortError(): Type {
    return classes.get("AbortError")!.type;
  }

  // `c.signal` on a controller, another handle to its signal, and `signal.aborted`, whether
  // its controller has aborted: values computed by the runtime, not fields.
  function blockProperty(e: Extract<Expr, { kind: "member" }>, t: BlockType): Type {
    if (linked(e)) throw unsupported(`optional chains through '${t.which}' values`, e);
    computed.add(e);
    if (t.which === "AbortController" && e.name === "signal") return blockType("AbortSignal");
    if (t.which === "AbortSignal" && e.name === "aborted") return "boolean";
    if (t.which === "TcpListener" && e.name === "port") return "i64";
    throw new CompileError(`property '${e.name}' does not exist on type '${show(t)}'`, e.start, e.end);
  }

  // `shared(v)`: v moved into a new counted block, of its type argument, the type expected of
  // it, or else v's own type.
  function sharedNew(e: Call): { type: Type; what: string } {
    if (e.args.length !== 1 || e.typeArgs.length > 1) throw new CompileError("'shared' takes the value it starts with, as in 'shared({ hits: 0 })'", e.start, e.end);
    const expected = wanted.get(e);
    const given = e.typeArgs[0] ? resolveType(e.typeArgs[0]) : typeof expected !== "string" && expected?.kind === "shared" ? expected.of : undefined;
    const a = e.args[0]!;
    if (given) expect(a, given);
    const t = value(a);
    const of = given ?? widenLet(t);
    coerce(a, t, of, `argument of type '${show(t)}' is not assignable to parameter of type '${show(of)}'`);
    return { type: shareable(of, e), what: "'shared'" };
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
    if (!found) throw new CompileError(`property '${e.name}' does not exist on type '${show(t)}'`, e.start, e.end);
    if (typeof inner !== "string" && inner.kind === "class") visible(found.access, declaring(inner, e.name), e.name, e);
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
    if (typeof c === "string" || c.kind !== "closure" || c.params.length > 1 || (c.params[0] !== undefined && !fits(held, c.params[0]))) {
      throw new CompileError(`'update' passes its callback a '${show(held)}'`, callback.start, callback.end);
    }
    return { type: c.returns, what: "'update'" };
  }

  // `await p`: the future runs to completion, the async function stopping while it is pending,
  // and gives its value, or raises its error as a call would. It moves into the await.
  function awaited(e: Extract<Expr, { kind: "unary" }>): Type {
    if (ctx.locked) throw new CompileError("'update' holds its lock while the callback runs, so the callback can't 'await': every task needing the lock would wait too; finish the update, then await", e.start, e.end);
    if (!ctx.async) throw new CompileError("'await' can only be used inside an 'async' function", e.start, e.end);
    if (!ctx.awaitable.has(e)) throw new CompileError("'await' inside an expression isn't supported yet; give its value a name first, as in 'const x = await ...;'", e.start, e.end);
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

  // What keeps a value from moving to another thread: a reference, which borrows from the
  // thread that made it, a raw pointer, which nothing checks, or a Cell, which changes unlocked.
  function unsent(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    if (t.kind === "ref" || t.kind === "pointer" || (t.kind === "interior" && t.which === "Cell") || (t.kind === "dyn" && borrowing.has(t.of))) return t;
    const parts = t.kind === "interior" ? [t.of] : t.kind === "future" || t.kind === "generator" ? t.params.map((f) => f.type)
      : t.kind === "union" ? t.members : t.kind === "array" ? [t.element] : t.kind === "class" && t.base ? [t.base, ...t.fields.map((f) => f.type)] : t.fields.map((f) => f.type);
    for (const part of parts) {
      const found = unsent(part);
      if (found) return found;
    }
    return undefined;
  }

  // `g.next()` runs a generator to its next `yield`, changing it, so it needs a place.
  function generatorCall(e: Call, callee: Extract<Expr, { kind: "member" }>, generator: Type, yields: Type): { type: Type; what: string } {
    if (callee.name !== "next") throw new CompileError(`generators have no method '${callee.name}' yet; 'next' is the one they have`, callee.start, callee.end);
    if (linked(callee)) throw unsupported("optional chains calling generator methods", callee);
    if (e.args.length > 0) throw unsupported("values sent into 'next'", e.args[0]!);
    const held = types.get(callee.object)!;
    if (isRefType(held)) coercions.set(callee.object, generator);
    if (!place(callee.object)) throw new CompileError("'next' changes its generator, so call it on a variable or a field", callee.start, callee.end);
    changeable(callee.object, "advance");
    return { type: nextResult(yields), what: "'next'" };
  }

  // Whether an expression is an index into an array, a place inside it.
  function element(e: Expr): e is Extract<Expr, { kind: "index" }> {
    if (e.kind !== "index") return false;
    const object = types.get(e.object);
    return object !== undefined && isArray(isRefType(object) ? object.to : object);
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
    if (!member) throw new CompileError(`property '${e.name}' does not exist on enum '${data.name}'`, e.start, e.end);
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
      (member.payload ?? []).forEach((node, i) => given[i] && infer(node, widenLet(given[i]!), names, bindings, e));
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
    // A copy of a value holding references borrows what it does.
    if (holdsRef(receiver)) borrowsFrom.set(e, [callee.object]);
    if (stored !== receiver && typeof stored !== "string" && stored.kind === "class" && classOf(stored).methods.has("clone")) {
      return { type: concreteMethod(e, callee, stored, receiver), what: "'clone'" };
    }
    const permit = holdsPart(stored, (u) => typeof u !== "string" && u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit"));
    if (permit) throw new CompileError("can't clone a 'Semaphore' or a 'Permit', or a value holding one: a semaphore's slots are counted, so share it inside a shared value or a class instead", e.start, e.end);
    if ((typeof stored === "string" || stored.kind !== "dyn") && holdsPart(stored, (u) => typeof u !== "string" && u.kind === "dyn")) throw new CompileError("can't clone a value holding a Dyn, whose clone may fail at run time; clone its Dyns one by one", e.start, e.end);
    const inner = holdsInterior(stored);
    if (inner) throw new CompileError(`can't clone ${inner === stored ? "an" : "a value holding an"} '${inner.which}', which is changed in place wherever it is shared; make a new one from what it holds`, e.start, e.end);
    if (holdsHandle(stored)) throw new CompileError("can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself", e.start, e.end);
    // Two mutable references to one thing can't be.
    if (holdsMut(receiver)) throw new CompileError("can't clone a value holding a mutable reference ('Mut'), since the copy would change the same thing", e.start, e.end);
    return { type: receiver, what: "'clone'" };
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  function receiverType(callee: Extract<Expr, { kind: "member" }>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !lookup(object.name) && (classes.has(object.name) || enums.has(object.name)))) return undefined;
    if (object.kind === "ident") objects.add(object);
    const type = linked(callee) ? unwrapped(object, callee.optional) : value(object);
    // A method called through a reference gets the pointer itself.
    return typeof type !== "string" && type.kind === "ref" ? type.to : type;
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
    if (holdsRef(t)) throw unsupported("Options holding references", at);
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
    if (!found) throw new CompileError(`property '${callee.name}' does not exist on type '${receiver.name}'`, callee.start, callee.end);
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
    const stored = receiver.kind === "param" ? receiver.concrete : undefined;
    if (typeof stored !== "string" && stored?.kind === "class") return { type: concreteMethod(e, callee, stored, found.returns), what: `'${callee.name}'` };
    return { type: promised !== undefined ? lentPromise(promised) : found.returns, what: `'${callee.name}'` };
  }

  // In an instance, a call through a type parameter runs its concrete class's method. An
  // interface it returns is, as for any call, the one concrete type the method returns.
  function concreteMethod(e: Call, callee: Extract<Expr, { kind: "member" }>, c: ClassType, returns: Type): Type {
    const target = inherited(classOf(c), "methods", callee.name)!;
    if (target.self!.owned) takesOver(callee.object, callee.name);
    else if (target.self!.mutable) mutates(callee.object, callee.name);
    const instance = instantiate(target, [], e.args, e.args.map((a) => coercions.get(a) ?? types.get(a)!), e);
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
    intoMember(object, types, `call '${name}' on`);
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

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  function method(callee: Extract<Expr, { kind: "member" }>, receiver: Type | undefined): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !lookup(object.name) ? classes.get(object.name) : undefined;
    if (named) {
      const found = inherited(named, "statics", name);
      if (!found) throw new CompileError(`property '${name}' does not exist on type 'typeof ${named.type.name}'`, callee.start, callee.end);
      visible(found.access, found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return superMethod(callee);
    const type = receiver!;
    const found = typeof type !== "string" && type.kind === "class" ? inherited(classOf(type), "methods", name) : undefined;
    if (!found) throw new CompileError(`'${show(type)}' has no method '${name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, name, callee);
    if (found.self!.owned) takesOver(object, name);
    else if (found.self!.mutable) mutates(object, name);
    return found;
  }

  // `super.m()` runs the base's `m` on the embedded base.
  function superMethod(callee: Extract<Expr, { kind: "member" }>): Body {
    const base = self?.type.base;
    if (!base) throw new CompileError("'super' can only be used in a class that extends another", callee.start, callee.end);
    if (!thisReady(callee.object)) throw new CompileError("'super' can't be used until every field is assigned", callee.object.start, callee.object.end);
    const found = inherited(classOf(base), "methods", callee.name);
    if (!found) throw new CompileError(`'${base.name}' has no method '${callee.name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, callee.name, callee);
    if (found.self!.mutable && !self!.mutable) {
      throw new CompileError(`cannot call '${callee.name}' on 'super' because 'this' is read-only here; declare 'this: Mut<this>'`, callee.start, callee.end);
    }
    types.set(callee.object, base);
    if (found.self!.owned) takesOver(callee.object, callee.name);
    return found;
  }

  // TypeScript's access rules: a private member is reachable only from inside its class, and
  // a protected one also from the classes that embed it.
  function visible(access: Access | undefined, declaring: ClassType, name: string, at: Span) {
    if (!access || access === "public" || owner === declaring) return;
    if (access === "protected" && owner && derives(owner, declaring)) return;
    const message = name.startsWith("#")
      ? `property '${name}' is not accessible outside class '${declaring.name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${declaring.name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError(message, at.start, at.end);
  }

  // The class whose own fields include `name`: `t` itself or a base it embeds.
  function declaring(t: ClassType, name: string): ClassType {
    return t.fields.some((f) => f.name === name) || !t.base ? t : declaring(t.base, name);
  }

  function args(list: Expr[], argTypes: Type[], target: Instance, at: Span) {
    const params = paramTypes(target);
    arity(list.length, target.body.params, at);
    list.forEach((a, i) => {
      const [type, expected] = [argTypes[i]!, params[i]!];
      coerce(a, type, expected, `argument of type '${show(type)}' is not assignable to parameter of type '${show(expected)}'`);
    });
  }

  function value(e: Expr): Type {
    if (once.delete(e)) return types.get(e)!;
    const type = typeOf(e);
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
      case "null":
        return "null";
      // A throw expression never gives a value, so it fits wherever it is.
      case "throw":
        thrown(e, e.value);
        return "never";
      // `x!` is what an Option holds; it panics when there is nothing.
      case "nonNull": {
        const option = read(e.expr);
        if (!isOption(option)) throw new CompileError(`'!' takes the value out of an Option, and this is a '${show(option)}', which is never empty`, e.start, e.end);
        return held(option);
      }
      case "bool":
        return "boolean";
      case "ident": {
        const local = lookup(e.name, e);
        if (!local && e.name === "undefined") return "null";
        // A top-level const: its value, computed while compiling. An aggregate is read where it
        // lives, through a reference, as a const can't change.
        const constant = local ? undefined : byName.get(`const ${e.name}`);
        if (constant) {
          const instance = ctx.instanceOf(constant);
          calls.set(e, instance);
          const type = ctx.returnOf(instance, e);
          return isCopy(type) || type === "string" ? type : refType(type, false);
        }
        if (!local) {
          const message = byName.has(e.name) ? "functions can't be used as values yet"
            : classes.has(e.name) ? "classes can't be used as values yet; construct one with 'new'"
            : enums.has(e.name) ? "an enum can't be used as a value; name one of its members"
            : `cannot find name '${e.name}'`;
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
        return narrowed(local) ?? local.type;
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
        const array = isArray(object);
        if (!stringLike(object) && !array) throw unsupported(EXPRESSION_FORMS.index, e);
        if (e.optional) throw unsupported("optional index expressions", e);
        if (array && object !== through) coercions.set(e.object, object);
        if (!array) text(e.object, object, false);
        const index = value(e.index);
        coerce(e.index, index, "usize", `${array ? "an array" : "a string"}'s index is a 'usize', not '${show(index)}'`);
        return array ? object.element : "string";
      }
      // Text alone is a literal; with substitutions, a new string.
      case "template":
        if (e.exprs.length === 0) return literalType(e.quasis[0]!);
        for (const x of e.exprs) joined(x, operand(x), "a template");
        return "string";
      case "member": {
        // `Color.Red` names an enum member, whose value is known; the enum's name is no value.
        const named = e.object.kind === "ident" && !lookup(e.object.name) ? enums.get(e.object.name) : undefined;
        if (named?.data) return variant(e, named, true);
        if (named) {
          const found = named.members.get(e.name);
          if (!found) throw new CompileError(`property '${e.name}' does not exist on enum '${(e.object as { name: string }).name}'`, e.start, e.end);
          return found;
        }
        if (e.object.kind === "ident") objects.add(e.object);
        const through = linked(e) ? unwrapped(e.object, e.optional) : value(e.object);
        const object = typeof through !== "string" && through.kind === "ref" ? through.to : through;
        // A field read through a reference loads what it points to; a getter gets the pointer.
        if (typeof object !== "string" && object.kind === "shared") return sharedField(e, object);
        if (typeof object !== "string" && object.kind === "block") return blockProperty(e, object);
        if (typeof object !== "string" && object.kind === "dyn") return dynField(e, object);
        const load = () => object !== through && coercions.set(e.object, object);
        const shared = typeof object !== "string" && object.kind === "union" ? unionField(object, e.name, e) : undefined;
        if (shared) {
          load();
          return linked(e) ? optional(shared, e) : shared;
        }
        if (typeof object !== "string" && object.kind === "class") classOf(object);
        // An array's one property is its length.
        if (isArray(object)) {
          if (ARRAY_METHODS.has(e.name)) throw new CompileError(`array methods can only be called, like 'a.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "length") throw new CompileError(`property '${e.name}' does not exist on type '${show(object)}'`, e.start, e.end);
          load();
          return linked(e) ? optional("usize", e) : "usize";
        }
        // A string's one property is its length in UTF-16 code units.
        if (stringLike(object)) {
          if (STRING_METHODS[e.name]) throw new CompileError(`string methods can only be called, like 's.${e.name}(...)'`, e.start, e.end);
          if (e.name !== "length") throw new CompileError(`property '${e.name}' does not exist on type 'string'`, e.start, e.end);
          text(e.object, object, linked(e));
          return linked(e) ? optional("usize", e) : "usize";
        }
        const found = typeof object === "string" || object.kind === "closure" ? undefined : field(object, e.name);
        const c = typeof object !== "string" && object.kind === "class" ? classOf(object) : undefined;
        const getter = !found && c ? inherited(c, "getters", e.name) : undefined;
        if (getter) {
          visible(getter.access, getter.owner!, e.name, e);
          calls.set(e, instanceOf(getter));
          const returns = returnOf(instanceOf(getter), e);
          // A getter's reference borrows from its object.
          if (holdsRef(returns)) borrowsFrom.set(e, [e.object]);
          return linked(e) ? optional(returns, e) : returns;
        }
        if (!found && c && inherited(c, "methods", e.name)) throw new CompileError("methods can't be used as values yet; call it", e.start, e.end);
        if (!found && c && inherited(c, "setters", e.name)) throw new CompileError(`property '${e.name}' has a setter but no getter`, e.start, e.end);
        if (!found) throw new CompileError(`property '${e.name}' does not exist on type '${show(object)}'`, e.start, e.end);
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
        return linked(e) ? optional(found.type, e) : found.type;
      }
      case "object": {
        const tuple = tuples.get(e);
        if (tuple) return tupleLiteral(e, tuple);
        if (shaped.has(e) && tupleLiterals.has(e)) return tupleLiteral(e, tupleType(tupleParts(e).map((x) => widenLet(value(x!)))));
        return objectType(fields(e.props.map(property), e.props));
      }
      // An array literal holds its elements' types, each widened as a `let` widens; with none, a
      // declared type has to say what it holds.
      case "array": {
        if (e.elements.some((x) => x === undefined)) throw unsupported("holes in array literals", e);
        const tuple = tuples.get(e);
        if (tuple) return tupleLiteral(e, tuple);
        if (shaped.has(e) && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
          return tupleLiteral(e, tupleType((e.elements as Expr[]).map((x) => widenLet(value(x)))));
        }
        const elements = e.elements as Expr[];
        const spread = elements.find((x) => x.kind === "spread");
        if (spread) throw unsupported("spread elements", spread);
        // Closures meeting the callable an annotation expects of each element are boxed into it.
        const want = wanted.get(e);
        const callable = typeof want !== "string" && want?.kind === "dyn" && callableOf.has(want.of) ? want : undefined;
        const promise = typeof want !== "string" && want?.kind === "dyn" && promiseElement(want.of) !== undefined ? want : undefined;
        const given = elements.map((x) => {
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
        const element = given.length === 0 ? "never" : unionType(given);
        elements.forEach((x, i) => given[i] !== element && coerce(x, given[i]!, element, ""));
        return arrayType(element);
      }
      case "arrow":
        return closure(e, expecting.get(e), unsafeDepth > 0, owning.has(e));
      // `as` converts between numbers as Rust's does; a boolean or an enum member converts to
      // an integer.
      case "as": {
        const to = resolveType(e.type);
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
        if (!isNumeric(to) || !(isNumeric(from) || (from === "boolean" && isInteger(to)))) {
          throw unsupported("'as' conversions other than between numbers", e);
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
        if (e.callee.kind === "ident" && e.callee.name === "AbortController" && !lookup(e.callee.name) && !classes.has(e.callee.name)) {
          if (list.length > 0 || e.typeArgs.length > 0) throw new CompileError("'AbortController' takes no arguments", e.start, e.end);
          return blockType("AbortController");
        }
        const named = e.callee.kind === "ident" && !lookup(e.callee.name) ? classes.get(e.callee.name) : undefined;
        if (named) expectFrom(named.constructor, list);
        const argTypes = list.map(value);
        const c = e.callee.kind === "ident" ? construct(e.callee.name, e.typeArgs, argTypes, e) : undefined;
        if (!c) throw new CompileError("only a class can be constructed with 'new'", e.callee.start, e.callee.end);
        constructs(c.constructor, list, argTypes);
        const constructor = instantiate(c.constructor, [], list, argTypes, e);
        args(list, argTypes, constructor, e);
        calls.set(e, constructor);
        // An instance holding references borrows from what it was built from.
        if (holdsRef(c.type)) borrowsFrom.set(e, list.filter(lends));
        return c.type;
      }
      case "tagged":
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
        if (e.op === "!" ? type !== "boolean" : e.op === "~" ? !isInteger(type) : !isNumeric(type)) {
          throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(type)}'`, e.start, e.end);
        }
        if (e.op === "-" && isInteger(type) && !INTEGERS[type].signed) {
          throw new CompileError(`'${show(type)}' is unsigned, so it can't be negated; convert it to a signed type with 'as' first`, e.start, e.end);
        }
        return type;
      }
      case "assign": {
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
          : binaryType(op, ...sameNumbers(e.target, target, e.value, widen(e.value, assigned)), e);
        coerce(e.value, type, target, `type '${show(type)}' is not assignable to type '${show(target)}'`);
        const local = e.target.kind === "ident" ? locals.get(e.target) : undefined;
        if (local && typeof local.type !== "string" && local.type.kind === "ref" && !coercions.has(e.target)) rebind(local, e.value);
        const narrow = local && narrowed(local);
        if (local && op === "=" && coercions.has(e.target) && narrow && isRefType(narrow) && !fits(type, narrow.to)) rewritten(local, e);
        return target;
      }
      case "update": {
        const target = assignable(e.operand, true);
        if (!isNumeric(target)) throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(target)}'`, e.start, e.end);
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
        if (isRef(then) || isRef(otherwise)) [then, otherwise] = [loaded(e.then, then), loaded(e.else, otherwise)];
        if (then === otherwise) return then;
        return bothSides(e, then, otherwise, coerce);
      }
      case "binary":
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError(`'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (e.op === "&&" || e.op === "||") {
          // The right side runs only when the left is true, for `&&`, or false, for `||`.
          const left = operand(e.left);
          const proven = proves(e.left);
          return binaryType(e.op, left, assume(e.op === "&&" ? proven.yes : proven.no, () => operand(e.right)), e);
        }
        if (e.op === "===" || e.op === "!==") {
          const special = typeofComparison(e, unions) ?? unionComparison(e, unions, adapt);
          if (special) return special;
        }
        if (e.op === "instanceof") return instanceofCheck(e, unions);
        if (e.op === "**") return power(e.left, operand(e.left), e.right, operand(e.right), e);
        if (e.op === "??") return orElse(e);
        if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        if (e.op === "+") {
          const [left, right] = [operand(e.left), operand(e.right)];
          if (stringLike(left) || stringLike(right)) return join(e.left, left, e.right, right);
        }
        return binaryType(e.op, ...sameNumbers(e.left, operand(e.left), e.right, operand(e.right), e.op === "===" || e.op === "!=="), e);
      default:
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
    }
  }

  // A fresh object literal's literal properties take the number types of the fields they meet,
  // in nested literals too; the literal's type is then made again from its properties.
  function adaptFields(e: Expr, type: Type, to: Type): Type {
    if (e.kind !== "object" || typeof to === "string" || (to.kind !== "object" && to.kind !== "class")) return type;
    let changed = false;
    for (const p of e.props) {
      if (p.kind !== "property" || typeof p.key !== "string") continue;
      const want = field(to, p.key)?.type;
      const have = types.get(p.value)!;
      // A string literal widened for the object keeps its literal type where one is wanted.
      if (want && want !== "string" && coercions.get(p.value) === "string" && fits(have, want)) {
        coercions.delete(p.value);
        changed = true;
        continue;
      }
      if (!want || have === want) continue;
      const adapted = adapt(p.value, want) || literalArray(p.value, have, want) ? want : adaptFields(p.value, have, want);
      if (adapted !== have) {
        types.set(p.value, adapted);
        changed = true;
      }
    }
    if (!changed) return type;
    const remade = objectType((type as ObjectType).fields.map((f) => {
      const p = e.props.find((q) => q.kind === "property" && q.key === f.name) as { value: Expr } | undefined;
      return p ? { ...f, type: coercions.get(p.value) ?? types.get(p.value)! } : f;
    }));
    types.set(e, remade);
    return remade;
  }

  // `**` raises an integer to a `u32` power, like Rust's `pow`, and a float to a float power of
  // its own type, like `powf`. A literal base takes its type from the exponent's only when that
  // is a float.
  function power(base: Expr, left: Type, exponent: Expr, right: Type, at: Expr): Type {
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
    const option = read(e.left);
    if (!isOption(option)) throw new CompileError(`the left side of '??' is a '${show(option)}', which is never empty; '??' gives a default for an Option`, e.left.start, e.left.end);
    const inner = held(option);
    const fallback = value(e.right);
    const to = fits(fallback, inner) || adaptable(e.right, inner) ? inner : option;
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

  // `+` with a string on either side joins the two into a new string.
  function join(a: Expr, left: Type, b: Expr, right: Type): Type {
    joined(a, left, "'+'");
    joined(b, right, "'+'");
    return "string";
  }

  // A value written into a string: text, or a number or boolean written as JavaScript would.
  function joined(e: Expr, type: Type, into: string) {
    if (stringLike(type)) {
      if (type !== "string") coerce(e, type, "string", "");
      return;
    }
    if (isNumeric(type) || type === "boolean") return;
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
    // A mutable reference lent on must be reachable only through mutable references.
    if (isRefType(to) && to.mutable && isRefType(type) && type.mutable && rooted(e) && place(e)) changeable(e, "mutably borrow");
    if (type === to || sameLowered(type, to) || sameCallable(type, to)) return;
    if (adapt(e, to)) return;
    type = adaptFields(e, type, to);
    if (type === to) return;
    if (literalArray(e, type, to)) return;
    if (isNumeric(type) && isNumeric(to)) throw new CompileError(`${message}; convert it with 'as ${show(to)}'`, e.start, e.end);
    if (typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) {
      borrow(e, type, to, message);
      return;
    }
    // A reference gives its value where one is wanted only by copying it: nothing moves out of
    // a borrow.
    if (typeof type !== "string" && type.kind === "ref" && (typeof to === "string" || to.kind !== "ref")) {
      if (!isCopy(type.to) && fits(type.to, to)) {
        throw new CompileError(`can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy`, e.start, e.end);
      }
      coercions.set(e, type.to);
      coerce(e, type.to, to, message);
      return;
    }
    if (typeof to !== "string" && to.kind === "union") {
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
    const shape = !fits(type, to) ? literalShape(e, to, types) : undefined;
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
    const exact = sameLowered(type, to.to);
    if (!exact && !fits(type, to.to)) throw new CompileError(message, e.start, e.end);
    const unlocked = to.mutable ? unlocks(type, to.to) : undefined;
    if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, so it can't be lent mutably as '${show(to.to)}', which could change it`, e.start, e.end);
    const through = to.mutable ? copied(e) : undefined;
    if (through) throw new CompileError(`can't lend this mutably through '${through}', which would lend a copy; check '!== null' first and lend the variable`, e.start, e.end);
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
    return typeof type !== "string" && type.kind === "ref" ? fits(type, to) : sameLowered(type, to.to) && sameLowered(to.to, type);
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
      const p = e.props.find((p) => (p.kind === "property" && p.key === f.name) || (p.kind === "shorthand" && p.name === f.name));
      if (!want || !p || !holdsRef(want) || fits(f.type, want)) return f;
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
    if (e.kind !== "object" || typeof to === "string") return;
    for (const p of e.props) {
      const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
      const found = field(to, name);
      if (!found) {
        throw new CompileError(`object literal may only specify known properties, and '${name}' does not exist in type '${show(to)}'`, p.start, p.end);
      }
      if (p.kind === "property") excess(p.value, found.type);
    }
  }

  // Properties are checked in source order, which is the order they run in.
  function property(p: ObjectProp): Field {
    const field = propertyField(p);
    // An arrow written for a field the object's type stores a callable in is boxed into it.
    const want = p.kind === "property" ? wanted.get(p.value) : undefined;
    if (typeof field.type !== "string" && field.type.kind === "closure" && want && isCallable(want)) {
      coerce((p as Extract<ObjectProp, { kind: "property" }>).value, field.type, want, `type '${show(field.type)}' is not assignable to type '${show(want)}'`);
      return { ...field, type: want };
    }
    // With no type to say which, a sync arrow is stored as a callable of its own signature.
    if (typeof field.type !== "string" && field.type.kind === "closure" && p.kind === "property" && !(typeof field.type.returns !== "string" && field.type.returns.kind === "future")) {
      const own = storedType({ kind: "function", name: field.type.name, params: field.type.params, returns: field.type.returns, fields: [] });
      coerce(p.value, field.type, own, `type '${show(field.type)}' is not assignable to type '${show(own)}'`);
      return { ...field, type: own };
    }
    if (typeof field.type !== "string" && field.type.kind === "closure") throw unsupported("functions stored in objects", p);
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
    if (!local) throw new CompileError(`cannot find name '${p.name}'`, p.start, p.end);
    if (!reachable(local)) {
      throw new CompileError(`'${p.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, p.start, p.end);
    }
    locals.set(p, local);
    return { name: p.name, type: widenEnum(narrowed(local) ?? local.type) };
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  function assignable(target: Expr, reads: boolean): Type {
    untuple(target);
    if ((target.kind === "member" || target.kind === "index") && target.object.kind === "ident") objects.add(target.object);
    const setter = target.kind === "member" ? accessor(target) : undefined;
    intoMember(target, types);
    if (target.kind === "index" && stringLike(read(target.object))) {
      throw new CompileError("strings can't be changed; build a new one instead, joining parts with '+'", target.start, target.end);
    }
    const holder = target.kind === "member" ? types.get(target.object) : undefined;
    if (holder && isArray(isRefType(holder) ? holder.to : holder)) {
      throw new CompileError("an array's 'length' can't be set; use 'pop()' to remove elements, or 'push' to add them", target.start, target.end);
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
      if (computed.has(target)) {
        const holder = types.get((target as Extract<Expr, { kind: "member" }>).object);
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
      intoMember(target, types);
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
    if (setter) visible(setter.access, setter.owner!, target.name, target);
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
      path = `${root.kind === "member" ? (/^\d+$/.test(root.name) ? `[${root.name}]` : `.${root.name}`) : "[...]"}${path}`;
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
    if (callableOf.has(to.of)) storing(e, lower(type), to, message);
    else if (isRefType(types.get(e)!)) throw new CompileError("can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy", e.start, e.end);
    const held = lower(type);
    if (typeof held !== "string" && held.kind === "dyn") throw new CompileError(`a '${show(held)}' can't become a '${show(to)}' yet; box the value it was made from`, e.start, e.end);
    const reason = callableOf.has(to.of) ? undefined : unsatisfied(type, to.of, members, e);
    if (reason) throw new CompileError(`${message}: ${reason}`, e.start, e.end);
    const blocker = unsent(held);
    if (blocker) {
      const why = typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from where it was made";
      throw new CompileError(`a '${show(to)}' may cross to another thread, so it can't hold a '${show(blocker)}', which ${why}`, e.start, e.end);
    }
    if (typeof held === "string" || held.kind !== "param") dynMembers.set(`${keyOf(held)} ${keyOf(to)}`, dynTable(e, held, to));
    coercions.set(e, to);
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
    if (typeof type !== "string" && type.kind === "closure") {
      const body = closureBody(type);
      futureTable(body, to.of.methods[0]!.returns, false, e);
      return { methods: [body], fields: [], clone: fixed ? undefined : "copy" };
    }
    const methods = to.of.methods.map((m) => {
      const body = inherited(c!, "methods", m.name)!;
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
      const hint = t.of.fields.some((f) => f.name === callee.name) ? "; it is a field, read without calling" : "";
      throw new CompileError(`property '${callee.name}' does not exist on type '${show(t)}'${hint}`, callee.start, callee.end);
    }
    if (linked(callee)) throw unsupported("optional chains calling methods through a Dyn", callee);
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
    if (m.owned) takesOver(callee.object, m.name);
    else if (m.mutable) mutates(callee.object, m.name);
    e.args.forEach((a, i) => {
      const want = m.params[i]!;
      expect(a, want);
      const given = value(a);
      coerce(a, given, want, `argument of type '${show(given)}' is not assignable to parameter of type '${show(want)}'`);
    });
    dynCalls.set(e, { index, mutable: m.mutable === true, owned: m.owned === true });
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
    // One returning a Promise gives its future boxed, owning what it holds.
    return { type: storedType(fn.returns), what: "this function" };
  }

  // A field read through a Dyn, through its slot: a copy of the value.
  function dynField(e: Extract<Expr, { kind: "member" }>, t: DynType): Type {
    if (linked(e)) throw unsupported("optional chains through a Dyn", e);
    const f = t.of.fields.find((x) => x.name === e.name);
    if (!f) {
      const hint = t.of.methods.some((m) => m.name === e.name) ? "; it is a method, so call it" : "";
      throw new CompileError(`property '${e.name}' does not exist on type '${show(t)}'${hint}`, e.start, e.end);
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
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${placeText(e.object)}[${e.name}]` : `${placeText(e.object)}.${e.name}`;
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

// What a string's length, index and methods work on: text, or a union of string literals.
const stringLike = (t: Type) => isText(t) || (typeof t !== "string" && t.kind === "union" && t.members.every(isText));

// Each string method: its parameters, what it returns, and how many arguments it needs.
const STRING_METHODS: Record<string, [Type[], Type, number]> = {
  charCodeAt: [["usize"], "u16", 1],
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
  padStart: [["usize", "string"], "string", 1],
  padEnd: [["usize", "string"], "string", 1],
  repeat: [["usize"], "string", 1],
  slice: [["i64", "i64"], "string", 1],
  substring: [["i64", "i64"], "string", 1],
};

const isArray = (t: Type): t is ArrayType => typeof t !== "string" && t.kind === "array";

// The methods an array has.
// A type's name with its article, as `an 'i64'` or `a 'string'`.
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} '${name}'`;

// Whether a value holds a future, which an array element or a sort's order can't be.
const holdsFuture = (t: Type): boolean => typeof t !== "string" && (t.kind === "future" || promiseElement(t) !== undefined);

// The methods that run a callback on each element.
const CALLBACK_METHODS = new Set(["map", "filter", "find", "some", "every", "reduce", "forEach", "flatMap", "findIndex"]);
// The callback methods whose callback decides yes or no.
const PREDICATES = new Set(["filter", "find", "some", "every", "findIndex"]);
// The methods that read an array's elements by value.
const READING_METHODS = new Set(["includes", "indexOf", "lastIndexOf", "join", "slice", "concat", "flat"]);
// The methods that change an array in place, beside push, pop and sort.
const CHANGING_METHODS = new Set(["shift", "unshift", "splice", "reverse", "fill"]);
const ARRAY_METHODS = new Set(["push", "pop", "sort", ...CALLBACK_METHODS, ...READING_METHODS, ...CHANGING_METHODS]);

// Whether a type is a data-carrying enum, or one of its variants.
const holdsVariant = (t: Type): boolean => typeof t !== "string" && (t.kind === "variant" || (t.kind === "union" && t.members.some(holdsVariant)));
