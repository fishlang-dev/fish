import { inherited, type Body, type ClassInfo } from "./classes.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { CompileError, indexText } from "./diag.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, ObjectProp, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { fields } from "./resolve.ts";
import { infer } from "./generics.ts";
import { allFields, arrayType, baseOf, unionType, unlocks, INTEGERS, isFloat, isInteger, isNumeric, isOption, range, derives, field, fits, holdsMut, holdsRef, isCopy, literalType, lower, refType, objectType, show, widenEnum, widenLet, wrapped } from "./typing.ts";
import type { Access, ArrayType, VariantType, Bound, Integer, Numeric, UnionType, ClassType, ClosureType, Field, FunctionType, ObjectType, RefType, Type } from "./typing.ts";
import type { EnumInfo, EnumInstance } from "./enums.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import type { Instance, Local } from "./check.ts";
import { literalValue, type Facts, type Guard } from "./narrow.ts";
import { bothSides, instanceofCheck, intoMember, intoUnion, literalShape, typeofComparison, unionComparison, unionField, type Union } from "./unions.ts";

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
  typeof t === "string" || t.kind === "literal" || (t.kind === "union" && t.members.every(printable));

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
  instanceOf(f: Body): Instance;
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
  narrowed(l: Local): Type | undefined;
  // False for a binding declared in another case of a switch, which entering this case skips.
  reachable(l: Local): boolean;
  // Records an error a call raises, and what the instance called may throw.
  raise(at: Expr, type: Type, what: string): void;
  // Checks what a `throw` raises.
  thrown(at: Expr, value: Expr): void;
  errorOf(instance: Instance): Type | undefined;
  // Whether a binding stands for a variable a closure captures, and whether this is a closure;
  // and a change to a capture, `this` when undefined, which makes it mutable.
  captured(l: Local): boolean;
  closing: boolean;
  changesCapture(l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean): void;
  // Records a whole write through a narrowed mutable reference that may change its member.
  rewritten(l: Local, at: Expr): void;
  // How deeply nested the scope declaring a binding is.
  depthOf(l: Local): number;
  // A written type, as this body sees it.
  resolveType(t: TypeNode): Type;
  // An arrow function's type, its body checked; and the instance a closure type runs.
  closure(e: Extract<Expr, { kind: "arrow" }>, expected?: FunctionType): ClosureType;
  closureBody(t: ClosureType): Instance;
  // The bounds of a body's implicit type parameters, by parameter index.
  implicitOf(f: Body): Map<number, Bound>;
  // Rejects a constructor call lending a value mutably as a type parameter that would let its
  // read-only fields be written.
  constructs(f: Body, args: Expr[], argTypes: Type[]): void;
  // Whether a variable whose type is still open takes `to`, for a use needing it.
  infer(e: Expr, to: Type): boolean;
};

export function expressions(ctx: Context) {
  const { types, locals, coercions, calls, setters, byName, classes, enums, construct, members, returnOf, resultOf, sourcesOf, borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup } = ctx;
  const { self, owner, superCall, thisReady, proves, assume, narrowed, reachable, captured, closing, changesCapture, noteThis, raise, errorOf, thrown, rewritten, depthOf, closure, closureBody, implicitOf, resolveType, constructs } = ctx;
  // The function type each arrow is given to, which types the parameters it leaves unwritten.
  const expecting = new Map<Expr, FunctionType>();
  // The type each generic enum's member is expected to have, by the member expression.
  const wanted = new Map<Expr, Type>();
  const oversized: Extract<Expr, { kind: "int" }>[] = [];
  // Literals found to fit the type they were given, `-9223372036854775808` among them.
  const fitted = new Set<Expr>();
  // Powers of literals whose exponent no u32 holds, unless they became floats.
  const powers: [Expr, Expr][] = [];
  const unions: Union = {
    types, coercions, value: (e) => read(e), excess: (e, to) => excess(e, to),
    classNamed: (name) => (lookup(name) ? undefined : classes.get(name)?.type),
    adapt: (e, to) => adapt(e, to),
  };
  return { value, read, condition, effect, coerce, result, expect, changesLocal, changesThis, adapt, finish, literalOnly };

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
    if (!literalOnly(e, isFloat(to))) return ctx.infer(e, to);
    retype(e, to, false);
    return true;
  }

  function literalOnly(e: Expr, floats: boolean): boolean {
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
    // An array literal's elements are expected to be its element type, and an object literal's
    // properties their fields'.
    if (e.kind === "array" && isArray(t)) for (const x of e.elements) if (x) expect(x, t.element);
    if (e.kind === "conditional") {
      expect(e.then, t);
      expect(e.else, t);
    }
    if (e.kind === "object" && typeof t !== "string" && (t.kind === "object" || t.kind === "class")) {
      for (const p of e.props) if (p.kind === "property" && typeof p.key === "string" && field(t, p.key)) expect(p.value, field(t, p.key)!.type);
    }
    const built = e.kind === "call" ? e.callee : e;
    if (built.kind === "member" && built.object.kind === "ident" && !lookup(built.object.name) && enums.get(built.object.name)?.data) wanted.set(built, t);
  }

  // A call's type, `void` included, or any other expression's.
  function result(e: Expr): Type {
    if (e.kind !== "call") return value(e);
    // A call returning a value records it, as reading any other value does.
    const { type } = call(e);
    if (type !== "void") types.set(e, type);
    return type;
  }

  // Only a statement may call a function that returns nothing.
  function effect(e: Expr) {
    if (e.kind === "call") call(e);
    else value(e);
  }

  // Checks a call: what it returns, and how a message names what it calls. A method called in
  // an optional chain gives an Option.
  function call(e: Call): { type: Type; what: string } {
    const result = callee(e);
    return e.callee.kind === "member" && linked(e.callee) && result.type !== "void" ? { ...result, type: optional(result.type, e) } : result;
  }

  function callee(e: Call): { type: Type; what: string } {
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
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? receiverType(callee) : undefined;
    if (callee.kind === "member" && callee.name === "clone" && receiver && copies(receiver)) return cloned(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && stringLike(receiver)) return stringCall(e, callee, receiver);
    if (callee.kind === "member" && receiver !== undefined && isArray(receiver)) return arrayCall(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && (receiver?.kind === "param" || receiver?.kind === "interface")) {
      return traitCall(e, callee, receiver);
    }
    if (callee.kind === "ident" && lookup(callee.name)) return closureCall(e, callee);
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
    // `String(x)`: a string, number or boolean written as JavaScript writes it.
    if (callee.kind === "ident" && callee.name === "String" && !byName.has("String")) {
      if (e.args.length !== 1) throw new CompileError("'String' takes 1 argument", e.start, e.end);
      joined(e.args[0]!, operand(e.args[0]!), "'String'");
      return { type: "string", what: "'String'" };
    }
    const target = callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee, receiver) : undefined;
    if (!target) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
    }
    expectFrom(target, e.args);
    const argTypes = e.args.map(value);
    const instance = instantiate(target, e.typeArgs, e.args, argTypes, e);
    args(e.args, argTypes, instance, e);
    calls.set(e, instance);
    const error = errorOf(instance);
    if (error) raise(e, error, `'${target.name}'`);
    const type = resultOf(instance, e);
    const object = callee.kind === "member" && instance.body.self ? callee.object : undefined;
    // A returned reference borrows what its lifetime says; a value holding references, what
    // was lent to the call, its receiver included.
    if (holdsRef(type)) borrowsFrom.set(e, sourcesOf(instance, e.args, object, e, lends));
    return { type, what: `'${target.name}'` };
  }

  // An arrow passed where a function type is declared takes its parameter types from it.
  function expectFrom(target: Body, list: Expr[]) {
    const bounds = implicitOf(target);
    const generic = (target.typeParams?.length ?? 0) > 0 || (target.scope?.size ?? 0) > 0 || bounds.size > 0;
    const known = generic ? undefined : paramTypes(instanceOf(target));
    list.forEach((a, i) => {
      const t = bounds.get(i);
      if (t?.kind === "function") expect(a, t);
      // A parameter of a function that isn't generic has its type before the call.
      if (a.kind !== "arrow" && known) expect(a, known[i]!);
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
  function closureCall(e: Call, callee: Extract<Expr, { kind: "ident" }>): { type: Type; what: string } {
    const held = value(callee);
    // A parameter of a function type calls it through its signature; its instance, the
    // closure it was given.
    const type = typeof held !== "string" && held.kind === "param" && held.bound?.kind === "function" ? held.bound : held;
    if (typeof type === "string" || (type.kind !== "closure" && type.kind !== "function")) {
      throw new CompileError(`this expression is not callable: type '${show(type)}' has no call signatures`, callee.start, callee.end);
    }
    if (e.typeArgs.length > 0) throw new CompileError(`'${callee.name}' takes no type arguments`, e.start, e.end);
    const written = type.kind === "closure" ? closureBody(type).body.params : undefined;
    if (written) arity(e.args.length, written, e);
    else if (e.args.length !== type.params.length) {
      throw new CompileError(`expected ${type.params.length} argument${type.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => coerce(a, value(a), type.params[i]!, `argument of type '${show(types.get(a)!)}' is not assignable to parameter of type '${show(type.params[i]!)}'`));
    const given = lower(held);
    if (typeof given !== "string" && given.kind === "closure") calls.set(e, closureBody(given));
    return { type: type.returns, what: `'${callee.name}'` };
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
    if (typeof t === "string" || t.kind === "literal") return true;
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
    // Two mutable references to one thing can't be.
    if (holdsMut(receiver)) throw new CompileError("can't clone a value holding a mutable reference ('Mut'), since the copy would change the same thing", e.start, e.end);
    return { type: receiver, what: "'clone'" };
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  function receiverType(callee: Extract<Expr, { kind: "member" }>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !lookup(object.name) && (classes.has(object.name) || enums.has(object.name)))) return undefined;
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
    // A reference an interface's method returns borrows from its receiver.
    if (holdsRef(found.returns)) borrowsFrom.set(e, [callee.object]);
    const stored = receiver.kind === "param" ? receiver.concrete : undefined;
    if (typeof stored !== "string" && stored?.kind === "class") return { type: concreteMethod(e, callee, stored, found.returns), what: `'${callee.name}'` };
    return { type: found.returns, what: `'${callee.name}'` };
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
        return narrowed(local) ?? local.type;
      }
      // Its literal type, which a string takes it as.
      case "string":
        return literalType(e.value);
      // A string's one-unit string at a `usize` index.
      case "index": {
        // An enum's reverse mapping, `Color[0]`, has no meaning yet.
        if (e.object.kind === "ident" && !lookup(e.object.name) && enums.has(e.object.name)) throw unsupported(EXPRESSION_FORMS.index, e);
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
        const through = linked(e) ? unwrapped(e.object, e.optional) : value(e.object);
        const object = typeof through !== "string" && through.kind === "ref" ? through.to : through;
        // A field read through a reference loads what it points to; a getter gets the pointer.
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
      case "object":
        return objectType(fields(e.props.map(property), e.props));
      // An array literal holds its elements' types, each widened as a `let` widens; with none, a
      // declared type has to say what it holds.
      case "array": {
        if (e.elements.some((x) => x === undefined)) throw unsupported("holes in array literals", e);
        const elements = e.elements as Expr[];
        const spread = elements.find((x) => x.kind === "spread");
        if (spread) throw unsupported("spread elements", spread);
        const given = elements.map((x) => {
          const t = value(x);
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
        return closure(e, expecting.get(e));
      // `as` converts between numbers as Rust's does; a boolean or an enum member converts to
      // an integer.
      case "as": {
        const to = resolveType(e.type);
        const from = operand(e.expr);
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
      case "call": {
        const { type, what } = call(e);
        if (type === "void") throw new CompileError(`${what} does not return a value`, e.start, e.end);
        return type;
      }
      case "unary": {
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
          if (isText(left) || isText(right)) return join(e.left, left, e.right, right);
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
    if (isText(type)) {
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
    // A mutable reference lent on must be reachable only through mutable references.
    if (isRefType(to) && to.mutable && isRefType(type) && type.mutable && rooted(e) && place(e)) changeable(e, "mutably borrow");
    if (type === to || lower(type) === lower(to)) return;
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
    const exact = lower(type) === lower(to.to);
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
    return typeof type !== "string" && type.kind === "ref" ? fits(type, to) : lower(type) === lower(to.to);
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
    if (typeof field.type !== "string" && field.type.kind === "closure") throw unsupported("functions stored in objects", p);
    return field;
  }

  function propertyField(p: ObjectProp): Field {
    if (p.kind === "property") {
      if (typeof p.key !== "string") throw unsupported("computed property names", p.key);
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
    if (!place(target)) throw new CompileError("can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      const read = value(target);
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
    return (typeof object !== "string" && field(object, target.name)?.type) || types.get(target)!;
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
      if (typeof holder !== "string" && holder?.kind === "ref" && holder.mutable) throughMut = true;
      else if (typeof holder !== "string" && holder?.kind === "ref") {
        throw new CompileError(`cannot ${action} '${placeText(target)}' because '${placeText(root.object)}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
      }
      path = `${root.kind === "member" ? `.${root.name}` : "[...]"}${path}`;
      root = root.object;
    }
    if (root.kind === "this" || root.kind === "super") return changesThis(path, action, target);
    changesLocal(locals.get(root)!, path, action, target, throughMut);
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
    if (e.kind === "member") return `${placeText(e.object)}.${e.name}`;
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
const isText = (t: Type) => t === "string" || (typeof t !== "string" && t.kind === "literal" && typeof t.value === "string" && !t.owner);

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
const ARRAY_METHODS = new Set(["push", "pop"]);

// Whether a type is a data-carrying enum, or one of its variants.
const holdsVariant = (t: Type): boolean => typeof t !== "string" && (t.kind === "variant" || (t.kind === "union" && t.members.some(holdsVariant)));
