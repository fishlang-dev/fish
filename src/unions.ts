import { CompileError } from "./diag.ts";
import { unsupported } from "./unsupported.ts";
import { literalValue, TYPEOF, typeofTest } from "./narrow.ts";
import type { Expr, Span } from "./parser.ts";
import { baseOf, field, fits, membersFor, objectType, show, unionType } from "./typing.ts";
import type { ClassType, Field, LiteralType, Type, UnionType } from "./typing.ts";

// The checker's rules for unions: what goes into one, and what comparing one means.

// What these rules need from expression checking.
export type Union = {
  types: Map<Expr, Type>;
  coercions: Map<Expr, Type>;
  value(e: Expr): Type;
  excess(e: Expr, to: Type): void;
  // The class a name declares, unless a variable shadows it.
  classNamed(name: string): ClassType | undefined;
};

// The shape a fresh object literal takes when its literal-valued properties fit the literal
// fields of `to`, and how to record that: each such property is coerced to its field's
// literal type, and the literal gets the shape. Undefined when it doesn't fit that way.
export function literalShape(e: Expr, to: Type, types: Map<Expr, Type>): { type: Type; apply(coercions: Map<Expr, Type>): void } | undefined {
  if (e.kind !== "object" || typeof to === "string" || to.kind !== "object") return undefined;
  const fields: Field[] = [];
  const steps: ((coercions: Map<Expr, Type>) => void)[] = [];
  const own = types.get(e) as Exclude<Type, string>;
  for (const p of e.props) {
    const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
    const want = field(to, name)?.type;
    const have = field(own, name)!.type;
    if (!want) return undefined;
    const value = p.kind === "property" ? p.value : undefined;
    const literal = typeof want !== "string" && want.kind === "literal" && !want.owner && value && literalValue(value) === want.value;
    const nested = value && !literal && !fits(have, want) ? literalShape(value, want, types) : undefined;
    if (!literal && !nested && !fits(have, want)) return undefined;
    fields.push({ name, type: literal ? want : nested ? nested.type : have });
    if (literal) steps.push((coercions) => coercions.set(value!, want));
    if (nested) steps.push(nested.apply);
  }
  if (to.fields.some((f) => !fields.some((g) => g.name === f.name))) return undefined;
  const type = objectType(fields);
  return { type, apply: (coercions) => {
    steps.forEach((step) => step(coercions));
    types.set(e, type);
  } };
}

// A field write must reach one member: through a union, which may hold any of several, the
// field could sit anywhere, so the union has to be narrowed to one member first.
// A mutating method call likewise needs its receiver in one member.
export function intoMember(target: Expr, types: Map<Expr, Type>, action = "assign to") {
  for (let e = target; e.kind === "member"; e = e.object) {
    const found = types.get(e.object);
    const object = typeof found !== "string" && found?.kind === "ref" ? found.to : found;
    if (typeof object !== "string" && object?.kind === "union") {
      const what = action === "assign to" ? `assign to '${e.name}'` : `${action} '${e.name}'`;
      throw new CompileError(`can't ${what} through '${show(object)}'; narrow it to one member first`, target.start, target.end);
    }
  }
}

// A field every member of a union has, read without narrowing first: its type is the union
// of the members' field types. This is how a discriminant like `x.kind` is read.
export function unionField(union: UnionType, name: string, at: Span): Type | undefined {
  const found = union.members.map((m) => (typeof m === "string" ? undefined : field(m, name)));
  if (found.some((f) => !f || (f.access ?? "public") !== "public")) return undefined;
  return unionType(found.map((f) => f!.type));
}

// `x instanceof C` checks whether x holds an instance of exactly C: with embedding, an
// instance of a class that extends C is not a C.
export function instanceofCheck(e: Extract<Expr, { kind: "binary" }>, { types, value, classNamed }: Union): Type {
  value(e.left);
  const c = e.right.kind === "ident" ? classNamed(e.right.name) : undefined;
  if (!c) throw new CompileError("the right side of 'instanceof' must be a class", e.right.start, e.right.end);
  types.set(e.right, c);
  return "boolean";
}

// A `?:` whose sides have different types makes the union of both, as in TypeScript.
export function bothSides(e: Extract<Expr, { kind: "conditional" }>, then: Type, otherwise: Type, coerce: Coerce): Type {
  const both = [then, otherwise];
  if (both.some((t) => t === "void" || (typeof t !== "string" && (t.kind === "interface" || t.kind === "param")))) {
    throw new CompileError(`both sides of '?:' must have the same type, not '${show(then)}' and '${show(otherwise)}'`, e.start, e.end);
  }
  const union = unionType(both);
  coerce(e.then, then, union, `type '${show(then)}' is not assignable to type '${show(union)}'`);
  coerce(e.else, otherwise, union, `type '${show(otherwise)}' is not assignable to type '${show(union)}'`);
  return union;
}

type Coerce = (e: Expr, type: Type, to: Type, message: string) => void;

// A value goes into the one union member it is or fits; a literal expression may also be a
// literal member with its value. A union goes into a wider one member by member.
export function intoUnion(e: Expr, type: Type, to: UnionType, message: string, { types, coercions, excess }: Union) {
  const sources = typeof type !== "string" && type.kind === "union" ? type.members : [type];
  for (const source of sources) {
    const value = literalValue(e);
    // A plain literal expression never becomes an enum's member.
    const literal = to.members.find((m) => typeof m !== "string" && m.kind === "literal" && !m.owner && m.value === value);
    if (literal && sources.length === 1 && baseOf(literal as LiteralType) === type) {
      types.set(e, literal);
      break;
    }
    let into = membersFor(source, to);
    // A fresh object literal may fit a member through its literal fields, as `{ ok: true }`
    // fits `{ ok: true }`; when exactly one member takes it that way, it becomes that shape.
    const shapes = into.length === 0 && sources.length === 1 ? to.members.map((m) => literalShape(e, m, types)) : [];
    if (shapes.filter((s) => s).length === 1) {
      const shape = shapes.find((s) => s)!;
      shape.apply(coercions);
      into = [to.members[shapes.indexOf(shape)]!];
    }
    if (into.length === 0) throw new CompileError(message, e.start, e.end);
    if (into.length > 1) {
      throw new CompileError(`type '${show(source)}' fits more than one member of '${show(to)}': ${into.map((m) => `'${show(m)}'`).join(" and ")}`, e.start, e.end);
    }
    if (sources.length === 1) excess(e, into[0]!);
  }
  coercions.set(e, to);
}

// `typeof x === "number"` checks which kind of value x holds, which for a union is its tag.
export function typeofComparison(e: Expr, { value }: Union): Type | undefined {
  const test = typeofTest(e);
  if (!test) return undefined;
  value(test.operand);
  if (test.name.kind !== "string" || !TYPEOF.has(test.name.value)) {
    throw new CompileError(`'typeof' can only be compared with ${[...TYPEOF].map((n) => `"${n}"`).join(", ")} here`, test.name.start, test.name.end);
  }
  return "boolean";
}

// `x === v` with x a union compares the member x holds with v, so it needs a member v might
// equal.
export function unionComparison(e: Extract<Expr, { kind: "binary" }>, { value }: Union): Type | undefined {
  const [left, right] = [value(e.left), value(e.right)];
  const isUnion = (t: Type) => typeof t !== "string" && t.kind === "union";
  if (!isUnion(left) && !isUnion(right)) return undefined;
  if (objectsMeet(left, right)) throw unsupported("comparisons of objects", e);
  if (!comparable(left, right)) {
    throw new CompileError(`this comparison appears to be unintentional because the types '${show(left)}' and '${show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}

// Objects and instances have no equality until `Eq`, so a comparison where both sides might
// hold one is rejected, whether or not they are unions. Any two object members may meet,
// since a wider object fits an unrelated narrower type.
export function objectsMeet(a: Type, b: Type): boolean {
  const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
  const object = (t: Type) => typeof t !== "string" && t.kind !== "literal";
  return members(a).some(object) && members(b).some(object);
}

// Whether a value of `a` might equal one of `b`: the same primitive, a literal and its base,
// or two literals of one value, for any members of either when it is a union.
export function comparable(a: Type, b: Type): boolean {
  const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
  const base = (t: Type) => (typeof t !== "string" && t.kind === "literal" ? (baseOf(t) ?? t) : t);
  return members(a).some((x) => members(b).some((y) => {
    if (typeof x !== "string" && x.kind === "literal" && typeof y !== "string" && y.kind === "literal") return x.value === y.value;
    return base(x) === base(y) && typeof base(x) === "string";
  }));
}
