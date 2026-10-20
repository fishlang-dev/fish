import { CompileError } from "./diag.ts";
import { literalValue, TYPEOF, typeofTest } from "./narrow.ts";
import type { Expr, Span } from "./parser.ts";
import { baseOf, field, membersFor, show, unionType, type ClassType, type LiteralType, type Type, type UnionType } from "./typing.ts";

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

// Whether a `switch` over a union may compare it with a case of this type.
export function caseFits(union: UnionType, test: Expr, type: Type): boolean {
  const literal = literalValue(test);
  return union.members.some((m) => typeof m !== "string" && m.kind === "literal" && m.value === literal)
    || membersFor(type, union).some((m) => typeof m === "string" || m.kind === "literal");
}

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
    const into = membersFor(source, to);
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

// `x === v` with x a union is true when x holds v: its member for a literal, or the member
// v's type goes into holding the same primitive value.
export function unionComparison(e: Extract<Expr, { kind: "binary" }>, { value }: Union): Type | undefined {
  const [left, right] = [value(e.left), value(e.right)];
  const [union, other, otherType] = typeof left !== "string" && left.kind === "union" ? [left, e.right, right]
    : typeof right !== "string" && right.kind === "union" ? [right, e.left, left] : [];
  if (!union) return undefined;
  const literal = literalValue(other!);
  const member = union.members.find((m) => typeof m !== "string" && m.kind === "literal" && m.value === literal)
    ?? membersFor(otherType!, union).find((m) => typeof m === "string" || m.kind === "literal");
  if (!member) {
    throw new CompileError(`this comparison appears to be unintentional because the types '${show(left)}' and '${show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}
