import type { Local } from "./check.ts";
import type { Expr } from "./parser.ts";
import { unionType, type Type } from "./typing.ts";

// Narrowing: what a condition proves about a variable's type, for the code it guards. A union
// narrows to the members a check leaves, and reading the variable there gives that narrower
// type, which codegen takes out of the union. Only a variable that never changes can narrow.

export type Facts = Map<Local, Type>;
export type Guard = { yes: Facts; no: Facts };

// What `typeof` says for a value of each type. Every sized number is "number", as in
// TypeScript, and every object and instance "object".
export function category(t: Type): string {
  if (t === "i64") return "number";
  if (typeof t === "string") return t;
  if (t.kind === "literal") return typeof t.value === "bigint" ? "number" : typeof t.value;
  return "object";
}

// The names a `typeof` comparison can check for.
export const TYPEOF = new Set(["number", "boolean", "string", "object"]);

// The operand of `typeof x === "name"` or `"name" !== typeof x`, and the name, if `e` is one.
export function typeofTest(e: Expr): { operand: Expr; name: Expr } | undefined {
  if (e.kind !== "binary" || (e.op !== "===" && e.op !== "!==")) return undefined;
  if (e.left.kind === "unary" && e.left.op === "typeof") return { operand: e.left.operand, name: e.right };
  if (e.right.kind === "unary" && e.right.op === "typeof") return { operand: e.right.operand, name: e.left };
  return undefined;
}

// The value a literal expression writes, if it is one.
export function literalValue(e: Expr): string | bigint | boolean | undefined {
  if (e.kind === "string" || e.kind === "bool" || e.kind === "int") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  return undefined;
}

// What a condition proves when it is true and when it is false. `narrowable` says which
// variables may narrow; `types` gives each expression's type as checked.
export function guard(e: Expr, types: Map<Expr, Type>, locals: Map<Expr, Local>, narrowable: (l: Local) => boolean): Guard {
  const nothing: Guard = { yes: new Map(), no: new Map() };
  const of = (x: Expr) => guard(x, types, locals, narrowable);
  if (e.kind === "unary" && e.op === "!") {
    const inner = of(e.operand);
    return { yes: inner.no, no: inner.yes };
  }
  if (e.kind !== "binary") return nothing;
  if (e.op === "&&" || e.op === "||") {
    const [a, b] = [of(e.left), of(e.right)];
    // `a && b` is true when both are, and false when either is; `||` the other way round.
    const both = (x: Facts, y: Facts) => new Map([...x, ...y]);
    return e.op === "&&" ? { yes: both(a.yes, b.yes), no: either(a.no, b.no) } : { yes: either(a.yes, b.yes), no: both(a.no, b.no) };
  }
  if (e.op !== "===" && e.op !== "!==") return nothing;
  const test = typeofTest(e);
  const [subject, check]: [Expr, (m: Type) => boolean] | [] = test
    ? test.name.kind === "string" ? [test.operand, (m) => category(m) === (test.name as { value: string }).value] : []
    : literalSide(e);
  if (!subject || subject.kind !== "ident") return nothing;
  const local = locals.get(subject);
  const type = types.get(subject);
  if (!local || !type || !narrowable(local)) return nothing;
  const members = typeof type !== "string" && type.kind === "union" ? type.members : [type];
  const yes = members.filter(check!);
  const no = members.filter((m) => !check!(m));
  const facts = (list: Type[]): Facts => new Map(list.length > 0 ? [[local, unionType(list)]] : []);
  const result = { yes: facts(yes), no: facts(no) };
  return e.op === "===" ? result : { yes: result.no, no: result.yes };

  // `x === "up"` narrows x to its member for that literal; anything else proves nothing.
  function literalSide(b: Extract<Expr, { kind: "binary" }>): [Expr, (m: Type) => boolean] | [] {
    for (const [subject, other] of [[b.left, b.right], [b.right, b.left]] as const) {
      const value = literalValue(other);
      if (value !== undefined && subject.kind === "ident") {
        return [subject, (m) => typeof m !== "string" && m.kind === "literal" && m.value === value];
      }
    }
    return [];
  }
}

// A variable either of two branches narrowed has, after them, whichever type it had.
function either(x: Facts, y: Facts): Facts {
  const out: Facts = new Map();
  for (const [local, t] of x) {
    const other = y.get(local);
    if (other) out.set(local, unionType([t, other]));
  }
  return out;
}
