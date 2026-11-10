import type { LocalId } from "./arenas.ts";
import type { Local } from "./check.ts";
import type { CompileError } from "./diag.ts";
import type { Expr } from "./parser.ts";
import type { Tables } from "./compilation.ts";
import { isNumeric, type Type, type TypeMap, type Typing } from "./typing.ts";
import { NodeMap } from "./nodes.ts";
import { cloneExpr } from "./rebuild.ts";

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
export function category(typing: Ref<Typing>, t: Type): string {
  if (isNumeric(t)) return "number";
  if (t === "null") return "undefined";
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "brand") return category(typing, r.base);
  if (r.kind === "literal") return typeof r.value === "string" ? "string" : typeof r.value === "boolean" ? "boolean" : "number";
  if (r.kind === "pattern") return "string";
  return "object";
}

export type Kind = "Map" | "Set" | "Array";

// Whether a member of `v` has key `x`, for `"x" in v`: "both" when its `x` is optional, since a
// value may have left it out.
export type Verdict = "yes" | "no" | "both";

export function ofKind(typing: Ref<Typing>, t: Type, kind: Kind): boolean {
  const held = typing.unfold(t);
  if (typeof held === "string") return false;
  const r = typing.rec(held);
  return kind === "Array" ? r.kind === "array" : r.kind === "map" && r.set === (kind === "Set");
}

// The names a `typeof` comparison can check for, and for a JsValue, all JS gives.
export const TYPEOF = new Set(["number", "boolean", "string", "bigint", "object", "undefined"]);
export const JS_TYPEOF = new Set(["number", "boolean", "string", "object", "undefined", "function", "bigint", "symbol"]);

// The operand of `typeof x === "name"` or `"name" !== typeof x`, and the name, if `e` is one.
export function typeofTest(e: Ref<Expr>): { operand: Expr; name: Expr } | undefined {
  if (e.kind !== "binary" || (e.op !== "===" && e.op !== "!==")) return undefined;
  if (e.left.kind === "unary" && e.left.op === "typeof") return { operand: cloneExpr(e.left.operand), name: cloneExpr(e.right) };
  if (e.right.kind === "unary" && e.right.op === "typeof") return { operand: cloneExpr(e.right.operand), name: cloneExpr(e.left) };
  return undefined;
}

// The value a literal expression writes, if it is one.
export function literalValue(e: Ref<Expr>): string | bigint | boolean | undefined {
  if (e.kind === "string" || e.kind === "bool" || e.kind === "int") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  return undefined;
}

// What a condition's check asks of each member of the type it splits: whether it fits a type
// predicate's, a recorded `in` verdict, a collection's kind, a class, a `typeof` name, being
// empty, being a literal, or having a field of a literal.
type Test =
  | { kind: "fits"; type: Type }
  | { kind: "keyed"; verdicts: TypeMap<Type, Verdict> }
  | { kind: "of"; of: Kind }
  | { kind: "instance"; of: Type | undefined }
  | { kind: "category"; name: string }
  | { kind: "null" }
  | { kind: "literal"; value: string | bigint | boolean }
  | { kind: "field"; name: string; optional: boolean; value: string | bigint | boolean };

// What narrowing needs from the body it checks: each expression's type and binding as checked,
// which variables may narrow, the key a field path narrows under, and a type predicate's call.
export interface GuardHost {
  tables(this: Mut<this>): Mut<Tables>;
  typeChecked(e: Ref<Expr>): Type | undefined;
  localRead(e: Ref<Expr>): LocalId | undefined;
  narrowable(this: Mut<this>, l: Ref<Local>): boolean;
  /** @throws {CompileError} */
  pathKey(this: Mut<this>, e: Ref<Expr>): string | undefined;
  // What a call of a function with a type predicate proves: which argument is narrowed, and to what.
  /** @throws {CompileError} */
  predicate(this: Mut<this>, call: Ref<Extract<Expr, { kind: "call" }>>): { index: usize; type: Type } | undefined;
  // Notes whether a type predicate's true and false answers narrow, which codegen then checks.
  predicateNarrows(this: Mut<this>, call: Ref<Extract<Expr, { kind: "call" }>>, index: usize, type: Type, yes: boolean, no: boolean): void;
}

// What a condition proves when it is true and when it is false.
/** @throws {CompileError} */
export function guard<H extends GuardHost>(host: Mut<H>, written: Ref<Expr>): Guard {
  const peeked = host.tables().rewrites.getExpr(written.id);
  const e: Ref<Expr> = peeked !== undefined ? peeked : written;
  // `isFish(x)` with `x is Fish` leaves x's members that are a Fish, and when false the rest.
  const proved = e.kind === "call" ? host.predicate(e) : undefined;
  if (proved !== undefined && e.kind === "call" && proved.index < e.args.length) {
    const facts = split(host, e.args[proved.index]!, { kind: "fits", type: proved.type }, true, proved.type);
    host.predicateNarrows(e, proved.index, proved.type, facts.yes.size > 0, facts.no.size > 0);
    return facts;
  }
  if (e.kind === "unary" && e.op === "!") {
    const inner = guard(host, e.operand);
    return { yes: inner.no, no: inner.yes };
  }
  const presence = host.tables().presenceTests.get(e);
  if (presence !== undefined) {
    const root = host.pathKey(presence.object);
    if (root === undefined) return nothing();
    const there: Facts = new Map([[presentKey(root, presence.name), "boolean"]]);
    return presence.when ? { yes: there, no: new Map() } : { yes: new Map(), no: there };
  }
  const keyed = host.tables().keyTests.get(e);
  if (keyed !== undefined && e.kind === "binary") return split(host, e.right, { kind: "keyed", verdicts: keyed }, true);
  const kind = host.tables().kindTests.get(e);
  if (kind !== undefined) {
    if (e.kind === "call") return split(host, e.args[0]!, { kind: "of", of: kind }, true);
    if (e.kind === "binary") return split(host, e.left, { kind: "of", of: kind }, true);
  }
  if (e.kind !== "binary") return nothing();
  if (e.op === "&&" || e.op === "||") {
    const a = guard(host, e.left);
    const b = guard(host, e.right);
    // `a && b` is true when both are, and false when either is; `||` the other way round.
    return e.op === "&&" ? { yes: both(a.yes, b.yes), no: either(host.tables().typing, a.no, b.no) } : { yes: either(host.tables().typing, a.yes, b.yes), no: both(a.no, b.no) };
  }
  if (e.op === "instanceof") {
    const c = host.typeChecked(e.right);
    return split(host, e.left, { kind: "instance", of: c }, true, c);
  }
  if (e.op !== "===" && e.op !== "!==") return nothing();
  const test = typeofTest(e);
  if (test !== undefined) {
    const name = test.name.kind === "string" ? test.name.value : undefined;
    const local = test.operand.kind === "ident" ? host.tables().arenas.localOf(host.localRead(test.operand)) : undefined;
    // A JsValue that is a string, number or boolean is read as a Fish one where that is known.
    const read = name !== undefined ? jsRead(name) : undefined;
    const tested = host.typeChecked(test.operand);
    const plainJs = tested !== undefined && host.tables().typing.holdsPlainJs(tested);
    if (local !== undefined && read !== undefined && plainJs && host.narrowable(local)) {
      const facts: Guard = { yes: new Map([[bindingKey(local.localId), read]]), no: new Map() };
      return e.op === "===" ? facts : { yes: facts.no, no: facts.yes };
    }
    if (local !== undefined && plainJs) return nothing();
    return name !== undefined && name !== "" ? split(host, test.operand, { kind: "category", name }, e.op === "===", unknownRead(name)) : nothing();
  }
  const fromLeft = compared(host, e.left, e.right, e.op === "===");
  if (fromLeft !== undefined) return fromLeft;
  const fromRight = compared(host, e.right, e.left, e.op === "===");
  if (fromRight !== undefined) return fromRight;
  return nothing();
}

// What comparing `subject` with `other` proves, if `other` is empty or a literal.
/** @throws {CompileError} */
function compared<H extends GuardHost>(host: Mut<H>, subject: Ref<Expr>, other: Ref<Expr>, positive: boolean): Guard | undefined {
  // `x === null` leaves x's empty member, and `x !== null` the rest.
  const empty = other.kind === "null" || (other.kind === "ident" && other.name === "undefined" && host.localRead(other) === undefined);
  if (empty && (subject.kind === "ident" || subject.kind === "member")) return split(host, subject, { kind: "null" }, positive, "null");
  const value = literalValue(other);
  if (value === undefined) return undefined;
  // `x === "up"` leaves x's member for that literal. `x.kind === "up"` leaves the members
  // whose `kind` is that literal, and any whose `kind` might be; a field of an object or a class
  // is a path that narrows itself. Through `?.`, an empty object has no `kind` to match.
  if (subject.kind === "ident" || (subject.kind === "member" && host.pathKey(subject) !== undefined)) return split(host, subject, { kind: "literal", value }, positive);
  if (subject.kind === "member") return split(host, subject.object, { kind: "field", name: subject.name, optional: subject.optional, value }, positive);
  return undefined;
}



// Splits a narrowable variable's or field path's members by whether a check holds for them. An
// `unknown`'s members aren't known while checking, so a check that proves it holds `unknownTo`
// narrows it to that, and its failing leaves it as it was.
/** @throws {CompileError} */
function split<H extends GuardHost>(host: Mut<H>, subject: Ref<Expr>, test: Test, positive: boolean, unknownTo?: Type): Guard {
  const local = subject.kind === "ident" ? host.tables().arenas.localOf(host.localRead(subject)) : undefined;
  const key = local !== undefined && host.narrowable(local) ? bindingKey(local.localId) : subject.kind === "member" ? host.pathKey(subject) : undefined;
  const type = host.typeChecked(subject);
  if (key === undefined || type === undefined) return nothing();
  // A reference narrows to a reference to fewer members; a mutable one only to a single
  // member, which it can point to inside the union.
  const t = typeof type === "string" ? undefined : host.tables().typing.rec(type);
  const ref = t !== undefined && t.kind === "ref" ? t : undefined;
  // A type parameter bounded by a union or primitive splits as what it stands for.
  const read = ref !== undefined ? ref.to : type;
  const p = typeof read === "string" ? undefined : host.tables().typing.rec(read);
  const held = p !== undefined && p.kind === "param" && p.concrete !== undefined && p.bound === undefined ? (p.within === true ? p.concrete : host.tables().typing.lowerKeepingBrands(read)) : read;
  const h = typeof held === "string" ? undefined : host.tables().typing.rec(held);
  if (h !== undefined && h.kind === "unknown") {
    if (unknownTo === undefined) return nothing();
    // A number may be held as another kind, so a mutable reference to one can't point at it.
    const facts: Guard = { yes: new Map([[key, ref !== undefined ? host.tables().typing.refType(unknownTo, ref.mutable && unknownTo !== "f64") : unknownTo]]), no: new Map() };
    return positive ? facts : { yes: facts.no, no: facts.yes };
  }
  // A member that holds itself stands for its own members, which the check may tell apart.
  let members: Type[] = [];
  for (const m of h !== undefined && h.kind === "union" ? h.members : [held]) {
    const inner = host.tables().typing.unfold(m);
    const r = inner === m || typeof inner === "string" ? undefined : host.tables().typing.rec(inner);
    if (r === undefined || r.kind !== "union") {
      members.push(m);
      continue;
    }
    let verdicts = new Set<string>();
    for (const x of r.members) verdicts.add(verdict(host.tables().typing, test, x));
    if (verdicts.size > 1) for (const x of r.members) members.push(x);
    else members.push(m);
  }
  // An instance's argument a check rules out leaves the branch unreachable, as `never`.
  const ruledOut = held !== read && p !== undefined && p.kind === "param" && p.within !== true;
  const yes = kept(host.tables().typing, members, test, "no", key, ref !== undefined ? ref.mutable : undefined, ruledOut);
  const no = kept(host.tables().typing, members, test, "yes", key, ref !== undefined ? ref.mutable : undefined, ruledOut);
  return positive ? { yes, no } : { yes: no, no: yes };
}

// The facts for the members whose verdict isn't `drop`, under `key`. A mutable reference can
// point at one member inside the union, but to several only through a shared copy.
function kept(typing: Mut<Typing>, members: Ref<Type[]>, test: Ref<Test>, drop: Verdict, key: string, mutable: boolean | undefined, ruledOut: boolean): Facts {
  let left: Type[] = [];
  for (const m of members) if (verdict(typing, test, m) !== drop) left.push(m);
  if (left.length === 0) return ruledOut ? new Map([[key, "never"]]) : new Map();
  const single = left.length === 1;
  const union = typing.unionType(left);
  return new Map([[key, mutable !== undefined ? typing.refType(union, mutable && single) : union]]);
}

// Whether `test` holds for a member `m`: always, never, or for some of its values.
function verdict(typing: Mut<Typing>, test: Ref<Test>, m: Type): Verdict {
  switch (test.kind) {
    case "fits":
      return typing.fits(m, test.type) ? "yes" : "no";
    case "keyed":
      return test.verdicts.get(m) ?? "both";
    case "of":
      return ofKind(typing, m, test.of) ? "yes" : "no";
    case "instance":
      return test.of !== undefined && typing.isSubclass(m, test.of) ? "yes" : "no";
    case "category":
      return category(typing, m) === test.name ? "yes" : "no";
    case "null":
      return m === "null" ? "yes" : "no";
    case "literal":
      return is(typing, m, test.value) ? "yes" : "no";
    case "field": {
      if (m === "null" && test.optional) return "no";
      // A member holding the union again has the fields of the type its block holds.
      const held = typing.unfold(m);
      const found = typeof held === "string" ? undefined : typing.fieldsOf(held).find((f) => f.name === test.name);
      const kind = found !== undefined ? found.type : undefined;
      if (kind !== undefined && is(typing, kind, test.value)) return "yes";
      const r = kind === undefined || typeof kind === "string" ? undefined : typing.rec(kind);
      // A `kind` that is one of several literals is that literal only when it is among them.
      if (r !== undefined && r.kind === "union" && r.members.every((k) => typeof k !== "string" && typing.rec(k).kind === "literal")) {
        return r.members.some((k) => is(typing, k, test.value)) ? "both" : "no";
      }
      return r !== undefined && r.kind === "literal" ? "no" : "both";
    }
  }
  return "both";
}

function nothing(): Guard {
  return { yes: new Map(), no: new Map() };
}

function both(x: Ref<Facts>, y: Ref<Facts>): Facts {
  return new Map([...x, ...y]);
}

function is(typing: Ref<Typing>, t: Type, value: string | bigint | boolean): boolean {
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  return r.kind === "literal" && r.value === value;
}

// A JsValue that is a string, number or boolean is read as this Fish type where that is known.
function jsRead(name: string): Type | undefined {
  return name === "string" ? "string" : name === "number" ? "f64" : name === "boolean" ? "boolean" : undefined;
}

// What `typeof` narrows an `unknown` to: any number reads as JavaScript's, an f64.
function unknownRead(name: string): Type | undefined {
  return name === "string" ? "string" : name === "number" ? "f64" : name === "boolean" ? "boolean" : name === "bigint" ? "bigint" : name === "undefined" ? "null" : undefined;
}

// `null`, or `undefined` where no variable takes the name.
export const isEmpty = (e: Expr, locals: NodeMap<Expr, LocalId>) => e.kind === "null" || (e.kind === "ident" && e.name === "undefined" && !locals.has(e));


// Whether a change under `changed` reaches what `key` narrows: the same binding or path, or a path
// below it.
export function covers(changed: string, key: string): boolean {
  return changed === key || (isPath(key) && (key.startsWith(`${changed}.`) || key.startsWith(`${changed}[`)));
}

// A variable either of two branches narrowed has, after them, whichever type it had.
export function either(typing: Mut<Typing>, x: Ref<Facts>, y: Ref<Facts>): Facts {
  let out: Facts = new Map();
  for (const [local, t] of x) {
    const other = y.get(local);
    if (other === undefined) continue;
    const tr = typing.recOf(t);
    const or = typing.recOf(other);
    if (tr !== undefined && tr.kind === "ref" && or !== undefined && or.kind === "ref") {
      const to = typing.unionType([tr.to, or.to]);
      out.set(local, typing.refType(to, tr.mutable && or.mutable && tr.to === or.to, tr.life === or.life ? tr.life : undefined));
    } else out.set(local, typing.unionType([t, other]));
  }
  return out;
}
