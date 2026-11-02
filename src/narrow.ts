import type { LocalId } from "./arenas.ts";
import type { Local } from "./check.ts";
import type { Expr } from "./parser.ts";
import type { Tables } from "./compilation.ts";
import { isNumeric, type Type, type Typing } from "./typing.ts";
import { NodeMap } from "./nodes.ts";

// Narrowing: what a condition proves about a variable's type, for the code it guards. A union
// narrows to the members a check leaves, and reading the variable there gives that narrower
// type, which codegen takes out of the union. A field path narrows too, keyed by its root's id or
// `this` and its field names, as `3.next.value`, until something could change it.

// A binding is keyed by its id, written as a string, so both kinds of key share one table.
export type Facts = Map<string, Type>;
export const bindingKey = (id: LocalId): string => String(id);
// Whether a key is a field path's, or `this` as the root of some, rather than a binding's.
export const isPath = (key: string): boolean => !/^\d+$/.test(key);
export type Guard = { yes: Facts; no: Facts };
// That a check found an interface's optional method on a value is kept under a key below the
// value's, so a change to the value forgets it. The type stored there only marks it.
export const presentKey = (root: string, name: string): string => `${root}.${name}()`;

// What `typeof` says for a value of each type. Every sized number is "number", as in
// TypeScript, and every object and instance "object".
export function category(typing: Typing, t: Type): string {
  if (isNumeric(t)) return "number";
  if (t === "null") return "undefined";
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "literal") return typeof r.value === "bigint" ? "number" : typeof r.value;
  if (r.kind === "pattern") return "string";
  return "object";
}

export type Kind = "Map" | "Set" | "Array";

// Whether a member of `v` has key `x`, for `"x" in v`: "both" when its `x` is optional, since a
// value may have left it out.
export type Verdict = "yes" | "no" | "both";

export function ofKind(typing: Typing, t: Type, kind: Kind): boolean {
  const held = typing.unfold(t);
  if (typeof held === "string") return false;
  const r = typing.rec(held);
  return kind === "Array" ? r.kind === "array" : r.kind === "map" && r.set === (kind === "Set");
}

// The names a `typeof` comparison can check for, and for a JsValue, all JS gives.
export const TYPEOF = new Set(["number", "boolean", "string", "bigint", "object", "undefined"]);
export const JS_TYPEOF = new Set(["number", "boolean", "string", "object", "undefined", "function", "bigint", "symbol"]);
const JS_READS: Record<string, Type> = { string: "string", number: "f64", boolean: "boolean" };
// What `typeof` narrows an `unknown` to: any number reads as JavaScript's, an f64.
const UNKNOWN_READS: Record<string, Type> = { string: "string", number: "f64", boolean: "boolean", bigint: "bigint", undefined: "null" };

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
// What a call of a function with a type predicate proves: which argument is narrowed, and to what.
// `narrows` hears whether its true and its false answers narrow, which codegen then checks.
export type Predicate = (call: Extract<Expr, { kind: "call" }>) => { index: usize; type: Type; narrows(yes: boolean, no: boolean): void } | undefined;

// `path` gives the key a field path narrows under, if it may.
export function guard(tables: Tables, written: Expr, types: NodeMap<Expr, Type>, locals: NodeMap<Expr, LocalId>, narrowable: (l: Local) => boolean, path: (e: Expr) => string | undefined, predicate?: Predicate): Guard {
  const { kindTests, typing, rewrites } = tables;
  const e = rewrites.current(written);
  const nothing: Guard = { yes: new Map(), no: new Map() };
  const of = (x: Expr) => guard(tables, x, types, locals, narrowable, path, predicate);
  // `isFish(x)` with `x is Fish` leaves x's members that are a Fish, and when false the rest.
  const proved = e.kind === "call" && predicate ? predicate(e) : undefined;
  if (proved && e.kind === "call" && e.args[proved.index]) {
    const facts = split(e.args[proved.index]!, (m) => (typing.fits(m, proved.type) ? "yes" : "no"), true, proved.type);
    proved.narrows(facts.yes.size > 0, facts.no.size > 0);
    return facts;
  }
  if (e.kind === "unary" && e.op === "!") {
    const inner = of(e.operand);
    return { yes: inner.no, no: inner.yes };
  }
  const presence = tables.presenceTests.get(e);
  if (presence) {
    const root = path(presence.object);
    if (root === undefined) return nothing;
    const there: Facts = new Map([[presentKey(root, presence.name), "boolean"]]);
    return presence.when ? { yes: there, no: new Map() } : { yes: new Map(), no: there };
  }
  const keyed = tables.keyTests.get(e);
  if (keyed && e.kind === "binary") return split(e.right, (m) => keyed.get(m) ?? "both", true);
  const kind = kindTests.get(e);
  if (kind) return split(e.kind === "call" ? e.args[0]! : (e as Extract<Expr, { kind: "binary" }>).left, (m) => (ofKind(typing, m, kind) ? "yes" : "no"), true);
  if (e.kind !== "binary") return nothing;
  if (e.op === "&&" || e.op === "||") {
    const [a, b] = [of(e.left), of(e.right)];
    // `a && b` is true when both are, and false when either is; `||` the other way round.
    const both = (x: Facts, y: Facts) => new Map([...x, ...y]);
    return e.op === "&&" ? { yes: both(a.yes, b.yes), no: either(typing, a.no, b.no) } : { yes: either(typing, a.yes, b.yes), no: both(a.no, b.no) };
  }
  if (e.op === "instanceof") {
    const c = types.get(e.right);
    return split(e.left, (m) => (c !== undefined && typing.isSubclass(m, c) ? "yes" : "no"), true, c);
  }
  if (e.op !== "===" && e.op !== "!==") return nothing;
  const test = typeofTest(e);
  if (test) {
    const name = test.name.kind === "string" ? test.name.value : undefined;
    const local = test.operand.kind === "ident" ? tables.arenas.localOf(locals.get(test.operand)) : undefined;
    // A JsValue that is a string, number or boolean is read as a Fish one where that is known.
    const read = name && JS_READS[name];
    const tested = types.get(test.operand);
    if (local && read && tested && typing.holdsPlainJs(tested) && narrowable(local)) {
      const facts: Guard = { yes: new Map([[bindingKey(local.localId), read]]), no: new Map() };
      return e.op === "===" ? facts : { yes: facts.no, no: facts.yes };
    }
    if (local && tested && typing.holdsPlainJs(tested)) return nothing;
    return name ? split(test.operand, (m) => (category(typing, m) === name ? "yes" : "no"), e.op === "===", UNKNOWN_READS[name]) : nothing;
  }
  for (const [subject, other] of [[e.left, e.right], [e.right, e.left]] as const) {
    // `x === null` leaves x's empty member, and `x !== null` the rest.
    if (isEmpty(other, locals) && (subject.kind === "ident" || subject.kind === "member")) return split(subject, (m) => (m === "null" ? "yes" : "no"), e.op === "===", "null");
    const value = literalValue(other);
    if (value === undefined) continue;
    // `x === "up"` leaves x's member for that literal. `x.kind === "up"` leaves the members
    // whose `kind` is that literal, and any whose `kind` might be; a field of an object or a class
    // is a path that narrows itself. Through `?.`, an empty object has no `kind` to match.
    if (subject.kind === "ident" || (subject.kind === "member" && path(subject) !== undefined)) return split(subject, (m) => (is(m, value) ? "yes" : "no"), e.op === "===");
    if (subject.kind === "member") {
      return split(subject.object, (m) => {
        if (m === "null" && subject.optional) return "no";
        // A member holding the union again has the fields of the type its block holds.
        const held = typing.unfold(m);
        const kind = typeof held === "string" ? undefined : typing.fieldsOf(held).find((f) => f.name === subject.name)?.type;
        if (kind && is(kind, value)) return "yes";
        const r = kind === undefined || typeof kind === "string" ? undefined : typing.rec(kind);
        // A `kind` that is one of several literals is that literal only when it is among them.
        if (r?.kind === "union" && r.members.every((k) => typeof k !== "string" && typing.rec(k).kind === "literal")) {
          return r.members.some((k) => is(k, value)) ? "both" : "no";
        }
        return r?.kind === "literal" ? "no" : "both";
      }, e.op === "===");
    }
  }
  return nothing;

  function is(t: Type, value: unknown): boolean {
    if (typeof t === "string") return false;
    const r = typing.rec(t);
    return r.kind === "literal" && r.value === value;
  }

  // Splits a narrowable variable's or field path's members by whether a check holds for them. An
  // `unknown`'s members aren't known while checking, so a check that proves it holds `unknownTo`
  // narrows it to that, and its failing leaves it as it was.
  function split(subject: Expr, check: (m: Type) => "yes" | "no" | "both", positive: boolean, unknownTo?: Type): Guard {
    const local = subject.kind === "ident" ? tables.arenas.localOf(locals.get(subject)) : undefined;
    const key = local && narrowable(local) ? bindingKey(local.localId) : subject.kind === "member" ? path(subject) : undefined;
    const type = types.get(subject);
    if (key === undefined || !type) return nothing;
    // A reference narrows to a reference to fewer members; a mutable one only to a single
    // member, which it can point to inside the union.
    const t = typeof type === "string" ? undefined : typing.rec(type);
    const ref = t?.kind === "ref" ? t : undefined;
    // A type parameter bounded by a union or primitive splits as what it stands for.
    const read = ref ? ref.to : type;
    const p = typeof read === "string" ? undefined : typing.rec(read);
    const held = p?.kind === "param" && p.concrete && !p.bound ? (p.within ? p.concrete : typing.lowerKeepingBrands(read)) : read;
    const h = typeof held === "string" ? undefined : typing.rec(held);
    if (h?.kind === "unknown") {
      if (unknownTo === undefined) return nothing;
      // A number may be held as another kind, so a mutable reference to one can't point at it.
      const facts: Guard = { yes: new Map([[key, ref ? typing.refType(unknownTo, ref.mutable && unknownTo !== "f64") : unknownTo]]), no: new Map() };
      return positive ? facts : { yes: facts.no, no: facts.yes };
    }
    // A member that holds itself stands for its own members, which the check may tell apart.
    const members = (h?.kind === "union" ? h.members : [held]).flatMap((m) => {
      const inner = typing.unfold(m);
      if (inner === m || typeof inner === "string") return [m];
      const r = typing.rec(inner);
      if (r.kind !== "union") return [m];
      const verdicts = new Set(r.members.map(check));
      return verdicts.size > 1 ? r.members : [m];
    });
    const facts = (keep: string): Facts => {
      const left = members.filter((m) => check(m) !== keep);
      // An instance's argument a check rules out leaves the branch unreachable, as `never`.
      if (left.length === 0) return held !== read && p?.kind === "param" && !p.within ? new Map([[key, "never"]]) : new Map();
      // A mutable reference can point at one member inside the union, but to several only
      // through a shared copy.
      return new Map([[key, ref ? typing.refType(typing.unionType(left), ref.mutable && left.length === 1) : typing.unionType(left)]]);
    };
    const [yes, no] = [facts("no"), facts("yes")];
    return positive ? { yes, no } : { yes: no, no: yes };
  }
}

// `null`, or `undefined` where no variable takes the name.
export const isEmpty = (e: Expr, locals: NodeMap<Expr, LocalId>) => e.kind === "null" || (e.kind === "ident" && e.name === "undefined" && !locals.has(e));


// Whether a change under `changed` reaches what `key` narrows: the same binding or path, or a path
// below it.
export function covers(changed: string, key: string): boolean {
  return changed === key || (isPath(key) && (key.startsWith(`${changed}.`) || key.startsWith(`${changed}[`)));
}

// A variable either of two branches narrowed has, after them, whichever type it had.
export function either(typing: Typing, x: Facts, y: Facts): Facts {
  const out: Facts = new Map();
  for (const [local, t] of x) {
    const other = y.get(local);
    if (other) out.set(local, typing.unionType([t, other]));
  }
  return out;
}
