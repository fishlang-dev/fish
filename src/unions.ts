import { CompileError } from "./diag.ts";
import type { Tables } from "./compilation.ts";
import { unsupported } from "./unsupported.ts";
import { JS_TYPEOF, literalValue, TYPEOF, typeofTest, type Kind, type Verdict } from "./narrow.ts";
import type { Expr, Span } from "./parser.ts";
import { TypeMap, TypeSet, isNumeric } from "./typing.ts";
import type { ClassType, Field, LiteralType, Type, Typing, UnionType } from "./typing.ts";
import { NodeMap } from "./nodes.ts";
import { cloneExpr, cloneOneOf2 } from "./rebuild.ts";

// The checker's rules for unions: what goes into one, and what comparing one means.

// What these rules need from expression checking.
export type UnionContext = {
  tables: Tables;
  types: NodeMap<Expr, Type>;
  coercions: NodeMap<Expr, Type>;
};
export interface Union<B extends UnionContext> {
  ctx: Mut<B>;
  /** @throws {CompileError} */
  read(this: Mut<this>, e: Ref<Expr>): Type;
  /** @throws {CompileError} */
  excess(this: Mut<this>, e: Ref<Expr>, to: Type): void;
  // The class a name declares, unless a variable shadows it.
  classNamed(this: Mut<this>, name: string): ClassType | undefined;
  // Whether a class or a base it embeds declares a method, getter or setter of this name.
  /** @throws {CompileError} */
  declares(this: Mut<this>, c: ClassType, name: string): boolean;
  // Gives an expression of only number literals the number type it meets.
  /** @throws {CompileError} */
  adapt(this: Mut<this>, e: Ref<Expr>, to: Type): boolean;
  /** @throws {CompileError} */
  coerce(this: Mut<this>, e: Ref<Expr>, type: Type, to: Type, message: string): void;
}

// The shape a fresh object literal takes when its literal-valued properties fit the literal
// fields of `to`, and what recording it writes, in order: each such property is coerced to its
// field's literal type, and the literal gets the shape. Undefined when it doesn't fit that way.
export type LiteralShape = { type: Type; writes: ShapeWrite[] };
// A coercion, a type, or a coercion made only when the node's type isn't already the one given.
type ShapeWrite = { table: "coercion" | "type" | "untyped"; node: Expr; type: Type };

export function literalShape(typing: Mut<Typing>, e: Ref<Expr>, meets: Type, types: Ref<NodeMap<Expr, Type>>): LiteralShape | undefined {
  const to = typing.unfold(meets);
  if (typeof to === "string") return undefined;
  const r = typing.rec(to);
  // Meeting a union, it takes the shape of the first member it can, as a nested literal of a
  // recursive type does.
  if ((e.kind === "object" || e.kind === "array") && r.kind === "union") {
    for (const m of r.members) {
      const shape = literalShape(typing, e, m, types);
      if (shape !== undefined) return shape;
    }
    return undefined;
  }
  // An array literal takes the shape of the array it meets, each element shaped as its element.
  if (e.kind === "array" && r.kind === "array" && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
    let writes: ShapeWrite[] = [];
    const element = r.element;
    for (const x of e.elements) {
      if (x === undefined) continue;
      const have = types.get(x)!;
      const shape = typing.fits(have, element) ? undefined : literalShape(typing, x, element, types);
      if (shape === undefined && !typing.fits(have, element)) return undefined;
      if (shape !== undefined) writes = writes.concat(shape.writes);
      writes.push({ table: "untyped", node: cloneExpr(x), type: element });
    }
    writes.push({ table: "type", node: cloneExpr(e), type: to });
    return { type: to, writes };
  }
  // A literal with spreads takes its fields' types from them, which no literal narrows.
  if (e.kind !== "object" || r.kind !== "object" || e.props.some((p) => p.kind === "spread")) return undefined;
  let fields: Field[] = [];
  let writes: ShapeWrite[] = [];
  const own = types.get(e) as Exclude<Type, string>;
  for (const p of e.props) {
    let name = "";
    if (p.kind === "shorthand") name = p.name;
    else if (p.kind !== "spread") {
      const key = cloneOneOf2(p.key);
      if (typeof key === "string") name = key;
    }
    const wanted = typing.field(to, name);
    if (wanted === undefined) return undefined;
    const want = wanted.type;
    const have = typing.field(own, name)!.type;
    const value: Ref<Expr> | undefined = p.kind === "property" ? p.value : undefined;
    // A literal's value takes the literal type wanted, alone or in a union of them.
    const w = typeof want === "string" ? undefined : typing.rec(want);
    const choices: Type[] = w !== undefined && w.kind === "union" ? w.members : [want];
    let literal: LiteralType | undefined = undefined;
    if (value !== undefined) {
      const v = literalValue(value);
      for (const c of choices) {
        const cr = typeof c === "string" ? undefined : typing.rec(c);
        if (cr !== undefined && cr.kind === "literal" && cr.owner === undefined && v === cr.value) {
          literal = c as LiteralType;
          break;
        }
      }
    }
    const nested = value !== undefined && literal === undefined && !typing.fits(have, want) ? literalShape(typing, value, want, types) : undefined;
    if (literal === undefined && nested === undefined && !typing.fits(have, want)) return undefined;
    fields.push({ name, type: literal !== undefined ? literal : nested !== undefined ? nested.type : have });
    if (literal !== undefined && value !== undefined) writes.push({ table: "coercion", node: cloneExpr(value), type: literal });
    if (nested !== undefined) writes = writes.concat(nested.writes);
  }
  // An optional field left out is filled in empty when the value meets the type.
  if (r.fields.some((f) => f.optional === undefined && !fields.some((g) => g.name === f.name))) return undefined;
  const type = typing.objectType(fields);
  writes.push({ table: "type", node: cloneExpr(e), type });
  return { type, writes };
}

// Records a literal's shape: its coercions, and the types it and its parts take.
export function applyShape(shape: Ref<LiteralShape>, coercions: Mut<NodeMap<Expr, Type>>, types: Mut<NodeMap<Expr, Type>>): void {
  for (const w of shape.writes) {
    if (w.table === "type") types.set(cloneExpr(w.node), w.type);
    else if (w.table === "coercion" || types.get(w.node) !== w.type) coercions.set(cloneExpr(w.node), w.type);
  }
}

// A field write must reach one member: through a union, which may hold any of several, the
// field could sit anywhere, so the union has to be narrowed to one member first.
/** @throws {CompileError} */
export function intoMember(typing: Mut<Typing>, target: Ref<Expr>, types: Ref<NodeMap<Expr, Type>>, action = "assign to") {
  intoMemberAt(typing, target, target, types, action);
}

/** @throws {CompileError} */
function intoMemberAt(typing: Mut<Typing>, e: Ref<Expr>, target: Ref<Expr>, types: Ref<NodeMap<Expr, Type>>, action: string): void {
  if (e.kind === "member") {
    const found = types.get(e.object);
    const f = found === undefined || typeof found === "string" ? undefined : typing.rec(found);
    const object = f !== undefined && f.kind === "ref" ? f.to : found;
    const o = object === undefined || typeof object === "string" ? undefined : typing.rec(object);
    // A union of string literals is a string, which the string rules reject writing to.
    if (o !== undefined && o.kind === "union" && !o.members.every((m) => textLiteral(typing, m))) {
      const what = action === "assign to" ? `assign to '${e.name}'` : `${action} '${e.name}'`;
      throw new CompileError("E0109", `can't ${what} through '${typing.show(object!)}'; narrow it to one member first`, target.start, target.end);
    }
    intoMemberAt(typing, e.object, target, types, action);
  }
}

function textLiteral(typing: Ref<Typing>, m: Type): boolean {
  const r = typeof m === "string" ? undefined : typing.rec(m);
  return r !== undefined && r.kind === "literal" && typeof r.value === "string";
}

// A field every member of a union has, read without narrowing first: its type is the union
// of the members' field types. This is how a discriminant like `x.kind` is read. A member that
// holds the union again is read through the type its block holds.
export function unionField(typing: Mut<Typing>, union: UnionType, name: string, at: Ref<Span>): Type | undefined {
  const r = typing.rec(union);
  let found: Type[] = [];
  for (const m of r.members) {
    const held = typing.unfold(m);
    if (typeof held === "string") return undefined;
    if (held !== m && typing.rec(held).kind === "union") {
      const inner = unionField(typing, held as UnionType, name, at);
      if (inner === undefined) return undefined;
      found.push(inner);
      continue;
    }
    const f = typing.field(held, name);
    if (f === undefined || (f.access ?? "public") !== "public") return undefined;
    found.push(f.type);
  }
  return typing.unionType(found);
}

// `x instanceof C` checks whether x holds an instance of C or of a class extending it; each
// keeps its own type when narrowed, its base's fields reached through the base it embeds.
/** @throws {CompileError} */
export function instanceofCheck<B extends UnionContext, H extends Union<B>>(e: Ref<Extract<Expr, { kind: "binary" }>>, host: Mut<H>): Type {
  const left = host.read(e.left);
  const l = typeof left === "string" ? undefined : host.ctx.tables.typing.rec(left);
  const held = l !== undefined && l.kind === "ref" ? l.to : left;
  const h = typeof held === "string" ? undefined : host.ctx.tables.typing.rec(held);
  if (h !== undefined && h.kind === "dyn") {
    throw new CompileError("E0109", `a '${host.ctx.tables.typing.show(held)}' keeps no record of its value's class, so 'instanceof' can't test it; add a method to the interface that says`, e.start, e.end);
  }
  const c = e.right.kind === "ident" ? host.classNamed(e.right.name) : undefined;
  // `Map`, `Set` and `Array` aren't classes in Fish; testing for one picks a union's member.
  if (c === undefined && e.right.kind === "ident" && (e.right.name === "Map" || e.right.name === "Set" || e.right.name === "Array")) {
    if (h === undefined || h.kind === "literal" || h.kind === "pattern") {
      throw new CompileError("E0109", `'instanceof' tests an object, and a '${host.ctx.tables.typing.show(held)}' is never a ${e.right.name}`, e.start, e.end);
    }
    const kind: Kind = e.right.name === "Map" ? "Map" : e.right.name === "Set" ? "Set" : "Array";
    host.ctx.tables.kindTests.set(cloneExpr(e), kind);
    return "boolean";
  }
  // A generic class written without its type arguments is the instance of it the value may be.
  const name = e.right.kind === "ident" ? e.right.name : undefined;
  const members: Type[] = h !== undefined && h.kind === "union" ? h.members : [held];
  // A member may be one through its base, as `Words extends List<string>` is a `List`.
  let instances = new TypeSet<Type>();
  if (c === undefined && name !== undefined) {
    for (const m of members) {
      if (typeof m === "string") continue;
      const r = host.ctx.tables.typing.rec(m);
      let x: ClassType | undefined = r.kind === "class" ? (m as ClassType) : undefined;
      while (x !== undefined) {
        const xr = host.ctx.tables.typing.rec(x);
        if (xr.generic !== undefined && xr.generic.name === name) {
          instances.add(x);
          break;
        }
        x = xr.base;
      }
    }
  }
  const found = [...instances];
  if (found.length > 1) throw new CompileError("E0109", `'${name!}' is generic, and this value may be more than one instance of it, which 'instanceof' can't tell apart; test a field that says which`, e.right.start, e.right.end);
  const tested = c !== undefined ? c : found.length > 0 ? found[0] : undefined;
  if (tested === undefined) throw new CompileError("E0109", "the right side of 'instanceof' must be a class, or a generic class this value may be an instance of", e.right.start, e.right.end);
  host.ctx.types.set(cloneExpr(e.right), tested);
  return "boolean";
}

// `"x" in v` checks whether v has key x, as JavaScript sees the value: an object by its fields, an
// instance by its fields and its class's methods and accessors, known while compiling as for
// `instanceof`. Each member's answer is recorded for narrowing and codegen.
/** @throws {CompileError} */
export function keyCheck<B extends UnionContext, H extends Union<B>>(e: Ref<Extract<Expr, { kind: "binary" }>>, host: Mut<H>): Type {
  if (e.left.kind !== "string") {
    throw new CompileError("E0801", "'in' tests a key written as a string literal, as in '\"name\" in v'; for a key known only at run time, keep the keys in a Set or the values in a Map", e.left.start, e.left.end);
  }
  host.read(e.left);
  const key = e.left.value;
  const known = host.ctx.tables.keyTests.get(e);
  let verdicts = known !== undefined ? known : new TypeMap<Type, Verdict>();
  let visiting = new TypeSet<Type>();
  const right = host.read(e.right);
  keyVerdict<B, H>(host, e, key, right, verdicts, visiting);
  host.ctx.tables.keyTests.set(cloneExpr(e), verdicts);
  return "boolean";
}

// Whether a value of `t` has key `key`, recorded in `verdicts` for it and for it lowered.
/** @throws {CompileError} */
function keyVerdict<B extends UnionContext, H extends Union<B>>(host: Mut<H>, e: Ref<Extract<Expr, { kind: "binary" }>>, key: string, t: Type, verdicts: Mut<TypeMap<Type, Verdict>>, visiting: Mut<TypeSet<Type>>): Verdict {
  const r = typeof t === "string" ? undefined : host.ctx.tables.typing.rec(t);
  const known = verdicts.get(t);
  if (known !== undefined) return known;
  // A type that holds itself answers for its own members, which decide it.
  if (visiting.has(t)) return "both";
  visiting.add(t);
  let found: Verdict = "both";
  if (r !== undefined && r.kind === "param") {
    // An instance's type parameter is judged by its type argument, which the same parameter
    // differs in from one instance to the next, so it isn't recorded; the definition's check
    // has none, so either answer may hold.
    visiting.delete(t);
    return r.concrete === undefined ? "both" : keyVerdict<B, H>(host, e, key, r.concrete, verdicts, visiting);
  }
  if (r !== undefined && (r.kind === "union" || r.kind === "recursive")) {
    let parts = new Set<string>();
    for (const m of r.kind === "union" ? r.members : [r.of]) parts.add(keyVerdict<B, H>(host, e, key, m, verdicts, visiting));
    found = parts.size === 1 ? (parts.has("yes") ? "yes" : parts.has("no") ? "no" : "both") : "both";
  } else if (r !== undefined && (r.kind === "object" || r.kind === "class")) {
    // A string key never names a `#` member. A class's declared field is always its own
    // property in JavaScript, even an optional one left unset.
    const field = key.startsWith("#") ? undefined : host.ctx.tables.typing.field(t as Exclude<Type, string>, key);
    const method = !key.startsWith("#") && r.kind === "class" && host.declares(t as ClassType, key);
    found = field !== undefined && field.optional !== undefined && r.kind === "object" ? "both" : field !== undefined || method ? "yes" : "no";
  } else if (r !== undefined && r.kind === "dyn") {
    throw new CompileError("E0109", `a '${host.ctx.tables.typing.show(t)}' keeps no record of its value's class, so 'in' can't test it; add a method to the interface that says`, e.start, e.end);
  } else {
    const shown = host.ctx.tables.typing.show(t);
    throw new CompileError("E0109", `'in' tests an object or a class instance for a key, and ${/^[aeiou]/.test(shown) ? "an" : "a"} '${shown}' has none to test; narrow the value to an object first`, e.right.start, e.right.end);
  }
  visiting.delete(t);
  verdicts.set(t, found);
  // Codegen sees the type lowered, which drops the marks that say a field is optional.
  const lowered = host.ctx.tables.typing.lower(t);
  if (!verdicts.has(lowered)) verdicts.set(lowered, found);
  return found;
}

// The number types a union holds. In an instance, a union holding a type parameter is read as
// the union it flattens into, so a literal meeting `T | 0` with T = `i32 | string` is an i32 as
// it is meeting `i32 | string | 0`. `open` reads a member that holds the union again as the
// members it holds.
export function numberMembers(typing: Mut<Typing>, t: Type, open = false): Type[] {
  if (typeof t === "string") return [];
  const r = typing.rec(t);
  if (r.kind !== "union") return [];
  const flat = holdsArgument(typing, t as UnionType) ? typing.lower(t) : t;
  const f = typeof flat === "string" ? undefined : typing.rec(flat);
  const all = f !== undefined && f.kind === "union" ? (open ? opened(typing, flat) : f.members) : [flat];
  return all.filter((m) => isNumeric(m));
}

// Whether an instance's union holds a type parameter, which stands for its type argument there.
export function holdsArgument(typing: Ref<Typing>, t: UnionType): boolean {
  return typing.rec(t).members.some((m) => {
    const r = typeof m === "string" ? undefined : typing.rec(m);
    return r !== undefined && r.kind === "param" && r.concrete !== undefined;
  });
}

// A `?:` whose sides have different types makes the union of both, as in TypeScript.
/** @throws {CompileError} */
export function bothSides<B extends UnionContext, H extends Union<B>>(host: Mut<H>, e: Ref<Extract<Expr, { kind: "conditional" }>>, then: Type, otherwise: Type): Type {
  const kinds = [then, otherwise].map((t) => (typeof t === "string" ? t : host.ctx.tables.typing.rec(t).kind));
  if (kinds.includes("closure")) throw unsupported("unions holding functions", { start: e.start, end: e.end });
  if (kinds.includes("void") || kinds.includes("interface") || kinds.includes("param")) {
    throw new CompileError("E0101", `both sides of '?:' must have the same type, not '${host.ctx.tables.typing.show(then)}' and '${host.ctx.tables.typing.show(otherwise)}'`, e.start, e.end);
  }
  const union = host.ctx.tables.typing.unionType([then, otherwise]);
  const intoThen = `type '${host.ctx.tables.typing.show(then)}' is not assignable to type '${host.ctx.tables.typing.show(union)}'`;
  host.coerce(e.then, then, union, intoThen);
  const intoElse = `type '${host.ctx.tables.typing.show(otherwise)}' is not assignable to type '${host.ctx.tables.typing.show(union)}'`;
  host.coerce(e.else, otherwise, union, intoElse);
  return union;
}

// A value goes into the one union member it is or fits; a literal expression may also be a
// literal member with its value. A union goes into a wider one member by member.
/** @throws {CompileError} */
export function intoUnion<B extends UnionContext, H extends Union<B>>(e: Ref<Expr>, given: Type, to: UnionType, message: string, host: Mut<H>) {
  let type = given;
  // A literal goes into the one number type a union holds.
  const numbers = numberMembers(host.ctx.tables.typing, to);
  if (!host.ctx.tables.typing.rec(to).members.includes(type) && numbers.length === 1 && host.adapt(e, numbers[0]!)) type = numbers[0]!;
  // In an instance, a type parameter no member takes goes in as the members its type argument has.
  let sources: Type[] = [];
  for (const m of unionMembers(host.ctx.tables.typing, type)) for (const s of sourceParts(host.ctx.tables.typing, m, to)) sources.push(s);
  if (sources.some((s) => kindOf(host.ctx.tables.typing, s) === "generator")) throw unsupported("unions holding generators", { start: e.start, end: e.end });
  if (sources.some((s) => kindOf(host.ctx.tables.typing, s) === "future")) throw unsupported("unions holding promises", { start: e.start, end: e.end });
  const targets = host.ctx.tables.typing.rec(to).members;
  for (const source of sources) {
    // A throw expression never gives a value, so it goes nowhere in particular.
    if (source === "never") continue;
    const value = literalValue(e);
    // A plain literal expression never becomes an enum's member.
    const literal = targets.find((m) => {
      const r = typeof m === "string" ? undefined : host.ctx.tables.typing.rec(m);
      return r !== undefined && r.kind === "literal" && r.owner === undefined && r.value === value;
    });
    const r = literal === undefined || typeof literal === "string" ? undefined : host.ctx.tables.typing.rec(literal);
    if (literal !== undefined && r !== undefined && r.kind === "literal" && sources.length === 1 && host.ctx.tables.typing.baseOf(literal as LiteralType) === type) {
      host.ctx.types.set(cloneExpr(e), literal);
      break;
    }
    let into = host.ctx.tables.typing.membersFor(source, to);
    // A fresh object literal may fit a member through its literal fields, as `{ ok: true }`
    // fits `{ ok: true }`; when exactly one member takes it that way, it becomes that shape.
    if (into.length === 0 && sources.length === 1) {
      let shaped: LiteralShape | undefined = undefined;
      let at: usize = 0;
      let count = 0;
      for (let i: usize = 0; i < targets.length; i++) {
        const shape = literalShape(host.ctx.tables.typing, e, targets[i]!, host.ctx.types);
        if (shape === undefined) continue;
        count++;
        if (shaped === undefined) {
          shaped = shape;
          at = i;
        }
      }
      if (count === 1 && shaped !== undefined) {
        applyShape(shaped, host.ctx.coercions, host.ctx.types);
        into = [targets[at]!];
      }
    }
    if (into.length === 0) throw new CompileError("E0101", message, e.start, e.end);
    if (into.length > 1) {
      throw new CompileError("E0109", `type '${host.ctx.tables.typing.show(source)}' fits more than one member of '${host.ctx.tables.typing.show(to)}': ${into.map((m) => `'${host.ctx.tables.typing.show(m)}'`).join(" and ")}`, e.start, e.end);
    }
    if (sources.length === 1) host.excess(e, into[0]!);
  }
  host.ctx.coercions.set(cloneExpr(e), to);
}

function kindOf(typing: Ref<Typing>, t: Type): string | undefined {
  return typeof t === "string" ? undefined : typing.rec(t).kind;
}

function unionMembers(typing: Ref<Typing>, t: Type): Type[] {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r !== undefined && r.kind === "union" ? r.members : [t];
}

// What a source member goes into a union as: itself, or, for a type parameter no member takes, the
// members of what it stands for.
function sourceParts(typing: Mut<Typing>, s: Type, to: UnionType): Type[] {
  const r = typeof s === "string" ? undefined : typing.rec(s);
  if (r === undefined || r.kind !== "param" || r.concrete === undefined || typing.membersFor(s, to).length > 0) return unionMembers(typing, s);
  let out: Type[] = [];
  for (const m of unionMembers(typing, r.concrete)) for (const p of sourceParts(typing, m, to)) out.push(p);
  return out;
}

// `typeof x === "number"` checks which kind of value x holds, which for a union is its tag.
/** @throws {CompileError} */
export function typeofComparison<B extends UnionContext, H extends Union<B>>(e: Ref<Expr>, host: Mut<H>): Type | undefined {
  const test = typeofTest(e);
  if (test === undefined) return undefined;
  const tested = host.read(test.operand);
  const t = typeof tested === "string" ? undefined : host.ctx.tables.typing.rec(tested);
  const held = t !== undefined && t.kind === "ref" ? t.to : tested;
  const h = typeof held === "string" ? undefined : host.ctx.tables.typing.rec(held);
  if (h !== undefined && h.kind === "union" && h.members.some((m) => host.ctx.tables.typing.isPlainJs(m))) throw new CompileError("E1005", `'typeof' can't tell what a 'JsValue' in a union holds yet; test the 'JsValue' on its own`, test.operand.start, test.operand.end);
  const names = host.ctx.tables.typing.isPlainJs(held) ? JS_TYPEOF : TYPEOF;
  if (test.name.kind !== "string" || !names.has(test.name.value)) {
    throw new CompileError("E0109", `'typeof' can only be compared with ${[...names].map((n) => `"${n}"`).join(", ")} here`, test.name.start, test.name.end);
  }
  return "boolean";
}

// `x === v` with x a union compares the member x holds with v, so it needs a member v might
// equal.
/** @throws {CompileError} */
export function unionComparison<B extends UnionContext, H extends Union<B>>(e: Ref<Extract<Expr, { kind: "binary" }>>, host: Mut<H>): Type | undefined {
  let left = host.read(e.left);
  let right = host.read(e.right);
  // An `unknown` equals a value of the type it holds, compared as that type.
  if (host.ctx.tables.typing.isUnknown(left) || host.ctx.tables.typing.isUnknown(right)) return "boolean";
  // A literal compared with a union holding one number type takes that type.
  const leftNumbers = numberMembers(host.ctx.tables.typing, left, true);
  if (leftNumbers.length === 1 && host.adapt(e.right, leftNumbers[0]!)) right = leftNumbers[0]!;
  const rightNumbers = numberMembers(host.ctx.tables.typing, right, true);
  if (rightNumbers.length === 1 && host.adapt(e.left, rightNumbers[0]!)) left = rightNumbers[0]!;
  // In an instance, a union holding a type parameter is the union its type argument flattens into.
  // So is a type parameter the type it stands for.
  const flatLeft = flat(host.ctx.tables.typing, left);
  const flatRight = flat(host.ctx.tables.typing, right);
  const instanced = flatLeft !== left || flatRight !== right;
  left = flatLeft;
  right = flatRight;
  if (!isUnion(host.ctx.tables.typing, left) && !isUnion(host.ctx.tables.typing, right)) {
    if (!instanced) return undefined;
    // What's left is a plain value, which a literal on the other side becomes to be compared.
    if (host.ctx.tables.typing.lower(left) === "string" && host.ctx.tables.typing.lower(right) !== "string" && host.ctx.tables.typing.widenLet(right) === "string") host.ctx.coercions.set(cloneExpr(e.right), "string");
    if (host.ctx.tables.typing.lower(right) === "string" && host.ctx.tables.typing.lower(left) !== "string" && host.ctx.tables.typing.widenLet(left) === "string") host.ctx.coercions.set(cloneExpr(e.left), "string");
    if (isNumeric(left)) host.adapt(e.right, left);
    if (isNumeric(right)) host.adapt(e.left, right);
  }
  if (objectsMeet(host.ctx.tables.typing, left, right)) throw unsupported("comparisons of objects", { start: e.start, end: e.end });
  // A type parameter's argument may miss a value its bound has, which the definition compared.
  if (!comparable(host.ctx.tables.typing, left, right) && !isParam(host.ctx.tables.typing, host.read(e.left)) && !isParam(host.ctx.tables.typing, host.read(e.right))) {
    throw new CompileError("E0112", `this comparison appears to be unintentional because the types '${host.ctx.tables.typing.show(left)}' and '${host.ctx.tables.typing.show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}

function unionOf(typing: Ref<Typing>, t: Type): UnionType | undefined {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r !== undefined && r.kind === "union" ? (t as UnionType) : undefined;
}

// A union of strings and patterns is a string once lowered, compared as one.
function isUnion(typing: Mut<Typing>, t: Type): boolean {
  return unionOf(typing, t) !== undefined && typing.lower(t) !== "string";
}

function flat(typing: Mut<Typing>, t: Type): Type {
  const u = unionOf(typing, t);
  const r = typeof t === "string" ? undefined : typing.rec(t);
  if (r !== undefined && r.kind === "param" && r.concrete !== undefined) return typing.lower(r.concrete);
  return u !== undefined && holdsArgument(typing, u) ? typing.lower(t) : t;
}

function isParam(typing: Ref<Typing>, t: Type): boolean {
  return typeof t !== "string" && typing.rec(t).kind === "param";
}

// Objects and instances have no equality until `Eq`, so a comparison where both sides might
// hold one is rejected, whether or not they are unions. Any two object members may meet,
// since a wider object fits an unrelated narrower type.
export function objectsMeet(typing: Ref<Typing>, a: Type, b: Type): boolean {
  return unionMembers(typing, a).some((t) => isObject(typing, t)) && unionMembers(typing, b).some((t) => isObject(typing, t));
}

function isObject(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string") return false;
  const kind = typing.rec(t).kind;
  return kind !== "literal" && kind !== "pattern" && kind !== "brand";
}

// A type's members, a member that holds itself standing for the members it holds.
function opened(typing: Mut<Typing>, t: Type): Type[] {
  let out: Type[] = [];
  const u = unionOf(typing, t);
  const ur = u !== undefined ? typing.rec(u) : undefined;
  for (const m of ur !== undefined && ur.kind === "union" ? ur.members : [t]) {
    const inner = typing.unfold(m);
    const held = inner !== m ? unionOf(typing, inner) : undefined;
    if (held !== undefined) {
      const hr = typing.rec(held);
      for (const x of hr.members) out.push(x);
    } else out.push(m);
  }
  return out;
}

// Whether a value of `a` might equal one of `b`: the same primitive, a literal and its base,
// or two literals of one value, for any members of either when it is a union.
export function comparable(typing: Mut<Typing>, a: Type, b: Type): boolean {
  const xs = opened(typing, a);
  const ys = opened(typing, b);
  for (const x of xs) for (const y of ys) if (memberComparable(typing, x, y)) return true;
  return false;
}

function memberComparable(typing: Mut<Typing>, x: Type, y: Type): boolean {
  const lx = literalOf(typing, x);
  const ly = literalOf(typing, y);
  if (lx !== undefined && ly !== undefined) return lx.value === ly.value;
  const bx = typeof x !== "string" && typing.rec(x).kind === "brand";
  const by = typeof y !== "string" && typing.rec(y).kind === "brand";
  if (x === y && bx) return true;
  const ux = bx !== by ? typing.unbranded(x) : x;
  const uy = bx !== by ? typing.unbranded(y) : y;
  const base = baseOf(typing, ux);
  return base === baseOf(typing, uy) && typeof base === "string";
}

function literalOf(typing: Ref<Typing>, t: Type): { value: string | bigint | boolean } | undefined {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r !== undefined && r.kind === "literal" ? { value: r.value } : undefined;
}

function baseOf(typing: Ref<Typing>, t: Type): Type {
  if (literalOf(typing, t) !== undefined) return typing.baseOf(t as LiteralType);
  return typeof t !== "string" && typing.rec(t).kind === "pattern" ? "string" : t;
}
