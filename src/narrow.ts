import type { Local } from "./check.ts";
import type { Expr } from "./parser.ts";
import { isNumeric, isPlainJs, isSubclass, refType, unfold, unionType, type Type } from "./typing.ts";

// Narrowing: what a condition proves about a variable's type, for the code it guards. A union
// narrows to the members a check leaves, and reading the variable there gives that narrower
// type, which codegen takes out of the union. Only a variable that never changes can narrow.

export type Facts = Map<Local, Type>;
export type Guard = { yes: Facts; no: Facts };

// What `typeof` says for a value of each type. Every sized number is "number", as in
// TypeScript, and every object and instance "object".
export function category(t: Type): string {
  if (isNumeric(t)) return "number";
  if (t === "null") return "undefined";
  if (typeof t === "string") return t;
  if (t.kind === "literal") return typeof t.value === "bigint" ? "number" : typeof t.value;
  if (t.kind === "pattern") return "string";
  return "object";
}

// The `instanceof Map`, `instanceof Set` and `instanceof Array` tests and the `Array.isArray`
// calls, by the kind each tests a value for.
export const kindTests = new WeakMap<Expr, Kind>();
export type Kind = "Map" | "Set" | "Array";

export function ofKind(t: Type, kind: Kind): boolean {
  const held = unfold(t);
  if (typeof held === "string") return false;
  return kind === "Array" ? held.kind === "array" : held.kind === "map" && held.set === (kind === "Set");
}

// The names a `typeof` comparison can check for, and for a JsValue, all JS gives.
export const TYPEOF = new Set(["number", "boolean", "string", "object", "undefined"]);
export const JS_TYPEOF = new Set(["number", "boolean", "string", "object", "undefined", "function", "bigint", "symbol"]);
const JS_READS: Record<string, Type> = { string: "string", number: "f64", boolean: "boolean" };

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
  const kind = kindTests.get(e);
  if (kind) return split(e.kind === "call" ? e.args[0]! : (e as Extract<Expr, { kind: "binary" }>).left, (m) => (ofKind(m, kind) ? "yes" : "no"), true);
  if (e.kind !== "binary") return nothing;
  if (e.op === "&&" || e.op === "||") {
    const [a, b] = [of(e.left), of(e.right)];
    // `a && b` is true when both are, and false when either is; `||` the other way round.
    const both = (x: Facts, y: Facts) => new Map([...x, ...y]);
    return e.op === "&&" ? { yes: both(a.yes, b.yes), no: either(a.no, b.no) } : { yes: either(a.yes, b.yes), no: both(a.no, b.no) };
  }
  if (e.op === "instanceof") {
    const c = types.get(e.right);
    return split(e.left, (m) => (c !== undefined && isSubclass(m, c) ? "yes" : "no"), true);
  }
  if (e.op !== "===" && e.op !== "!==") return nothing;
  const test = typeofTest(e);
  if (test) {
    const name = test.name.kind === "string" ? test.name.value : undefined;
    const local = test.operand.kind === "ident" ? locals.get(test.operand) : undefined;
    // A JsValue that is a string, number or boolean is read as a Fish one where that is known.
    const read = name && JS_READS[name];
    if (local && read && isPlainJs(local.type) && narrowable(local)) {
      const facts: Guard = { yes: new Map([[local, read]]), no: new Map() };
      return e.op === "===" ? facts : { yes: facts.no, no: facts.yes };
    }
    if (local && isPlainJs(local.type)) return nothing;
    return name ? split(test.operand, (m) => (category(m) === name ? "yes" : "no"), e.op === "===") : nothing;
  }
  for (const [subject, other] of [[e.left, e.right], [e.right, e.left]] as const) {
    // `x === null` leaves x's empty member, and `x !== null` the rest.
    if (isEmpty(other, locals) && subject.kind === "ident") return split(subject, (m) => (m === "null" ? "yes" : "no"), e.op === "===");
    const value = literalValue(other);
    if (value === undefined) continue;
    // `x === "up"` leaves x's member for that literal. `x.kind === "up"` leaves the members
    // whose `kind` is that literal, and any whose `kind` might be.
    if (subject.kind === "ident") return split(subject, (m) => (is(m, value) ? "yes" : "no"), e.op === "===");
    if (subject.kind === "member") {
      return split(subject.object, (m) => {
        const kind = typeof m === "string" ? undefined : m.fields.find((f) => f.name === subject.name)?.type;
        if (kind && is(kind, value)) return "yes";
        return kind && typeof kind !== "string" && kind.kind === "literal" ? "no" : "both";
      }, e.op === "===");
    }
  }
  return nothing;

  // Splits a narrowable variable's members by whether a check holds for them.
  function split(subject: Expr, check: (m: Type) => "yes" | "no" | "both", positive: boolean): Guard {
    const local = subject.kind === "ident" ? locals.get(subject) : undefined;
    const type = types.get(subject);
    if (!local || !type || !narrowable(local)) return nothing;
    // A reference narrows to a reference to fewer members; a mutable one only to a single
    // member, which it can point to inside the union.
    const ref = typeof type !== "string" && type.kind === "ref" ? type : undefined;
    const held = ref ? ref.to : type;
    // A member that holds itself stands for its own members, which the check may tell apart.
    const members = (typeof held !== "string" && held.kind === "union" ? held.members : [held]).flatMap((m) => {
      const inner = unfold(m);
      if (inner === m || typeof inner === "string" || inner.kind !== "union") return [m];
      const verdicts = new Set(inner.members.map(check));
      return verdicts.size > 1 ? inner.members : [m];
    });
    const facts = (keep: string): Facts => {
      const left = members.filter((m) => check(m) !== keep);
      if (left.length === 0) return new Map();
      // A mutable reference can point at one member inside the union, but to several only
      // through a shared copy.
      return new Map([[local, ref ? refType(unionType(left), ref.mutable && left.length === 1) : unionType(left)]]);
    };
    const [yes, no] = [facts("no"), facts("yes")];
    return positive ? { yes, no } : { yes: no, no: yes };
  }
}

// `null`, or `undefined` where no variable takes the name.
export const isEmpty = (e: Expr, locals: Map<Expr, Local>) => e.kind === "null" || (e.kind === "ident" && e.name === "undefined" && !locals.has(e));

const is = (t: Type, value: unknown) => typeof t !== "string" && t.kind === "literal" && t.value === value;

// A variable either of two branches narrowed has, after them, whichever type it had.
export function either(x: Facts, y: Facts): Facts {
  const out: Facts = new Map();
  for (const [local, t] of x) {
    const other = y.get(local);
    if (other) out.set(local, unionType([t, other]));
  }
  return out;
}
