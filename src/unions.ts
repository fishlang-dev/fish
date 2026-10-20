import { CompileError } from "./diag.ts";
import { literalValue, TYPEOF, typeofTest } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { baseOf, membersFor, show, type LiteralType, type Type, type UnionType } from "./typing.ts";

// The checker's rules for unions: what goes into one, and what comparing one means.

// What these rules need from expression checking.
export type Union = {
  types: Map<Expr, Type>;
  coercions: Map<Expr, Type>;
  value(e: Expr): Type;
  excess(e: Expr, to: Type): void;
};

// A value goes into the one union member it is or fits; a literal expression may also be a
// literal member with its value. A union goes into a wider one member by member.
export function intoUnion(e: Expr, type: Type, to: UnionType, message: string, { types, coercions, excess }: Union) {
  const sources = typeof type !== "string" && type.kind === "union" ? type.members : [type];
  for (const source of sources) {
    const value = literalValue(e);
    const literal = to.members.find((m) => typeof m !== "string" && m.kind === "literal" && m.value === value);
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
    ?? membersFor(otherType!, union).find((m) => typeof m === "string");
  if (!member) {
    throw new CompileError(`this comparison appears to be unintentional because the types '${show(left)}' and '${show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}
