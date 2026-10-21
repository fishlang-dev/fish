import type { Expr, Pattern } from "./parser.ts";
import { literalType, show, type LiteralType, type Type } from "./typing.ts";

// What `match` needs to know about patterns, apart from checking expressions: the names they
// bind, and which values of the matched type no arm covers.

// The names a pattern binds, in order.
export function bindings(p: Pattern): Extract<Pattern, { kind: "ident" }>[] {
  switch (p.kind) {
    case "ident":
      return [p];
    case "or":
      return bindings(p.patterns[0]!);
    case "variant":
      return (p.args ?? []).flatMap(bindings);
    case "object":
      return p.props.flatMap((prop) => bindings(prop.value));
    case "array":
      return p.elements.flatMap((e) => (e ? bindings(e) : []));
    default:
      return [];
  }
}

// The value a literal pattern stands for, as a literal type's value, or null for `null`.
export function literalOf(e: Expr): string | bigint | boolean | null {
  if (e.kind === "int") return e.value;
  if (e.kind === "unary" && e.operand.kind === "int") return -e.operand.value;
  if (e.kind === "string" || e.kind === "bool") return e.value;
  if (e.kind === "null") return null;
  // A float literal pattern can only be covered by a catch-all, so its value never matters.
  return NaN as unknown as bigint;
}

// The cases a value of a type falls into, for coverage: each literal it may be, `null`, or a
// whole type with too many values to list, which only a catch-all covers.
export function spaces(t: Type): Type[] {
  if (t === "boolean") return [literalType(true), literalType(false)];
  if (typeof t !== "string" && t.kind === "union") return t.members.flatMap(spaces);
  return [t];
}

// The message for a case no arm covers: the literal to add, or the type a catch-all covers.
export function uncovered(space: Type): string {
  const named = space === "null" ? "null" : typeof space !== "string" && space.kind === "literal" ? show(space) : undefined;
  if (named) return `this match doesn't cover ${named}; add 'case ${named} =>', or 'case _ =>' for the rest`;
  return `this match doesn't cover every '${show(space)}'; add 'case _ =>' for the rest`;
}

// Whether a literal value covers a case.
export function covers(value: string | bigint | boolean | null, space: Type): boolean {
  if (value === null) return space === "null";
  return typeof space !== "string" && space.kind === "literal" && (space as LiteralType).value === value;
}
