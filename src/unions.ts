import { CompileError } from "./diag.ts";
import type { Tables } from "./compilation.ts";
import { unsupported } from "./unsupported.ts";
import { JS_TYPEOF, literalValue, TYPEOF, typeofTest, type Kind } from "./narrow.ts";
import type { Expr, Span } from "./parser.ts";
import { TypeSet, isNumeric } from "./typing.ts";
import type { ClassType, Field, LiteralType, Type, Typing, UnionType } from "./typing.ts";
import { NodeMap } from "./nodes.ts";

// The checker's rules for unions: what goes into one, and what comparing one means.

// What these rules need from expression checking.
export type Union = {
  kindTests: Tables["kindTests"];
  typing: Typing;
  types: NodeMap<Expr, Type>;
  coercions: NodeMap<Expr, Type>;
  read(e: Expr): Type;
  excess(e: Expr, to: Type): void;
  // The class a name declares, unless a variable shadows it.
  classNamed(name: string): ClassType | undefined;
  // Gives an expression of only number literals the number type it meets.
  adapt(e: Expr, to: Type): boolean;
};

// The shape a fresh object literal takes when its literal-valued properties fit the literal
// fields of `to`, and how to record that: each such property is coerced to its field's
// literal type, and the literal gets the shape. Undefined when it doesn't fit that way.
export function literalShape(typing: Typing, e: Expr, to: Type, types: NodeMap<Expr, Type>): { type: Type; apply(coercions: NodeMap<Expr, Type>): void } | undefined {
  to = typing.unfold(to);
  if (typeof to === "string") return undefined;
  const r = typing.rec(to);
  // Meeting a union, it takes the shape of the first member it can, as a nested literal of a
  // recursive type does.
  if ((e.kind === "object" || e.kind === "array") && r.kind === "union") {
    for (const m of r.members) {
      const shape = literalShape(typing, e, m, types);
      if (shape) return shape;
    }
    return undefined;
  }
  // An array literal takes the shape of the array it meets, each element shaped as its element.
  if (e.kind === "array" && r.kind === "array" && e.elements.every((x) => x !== undefined && x.kind !== "spread")) {
    const steps: ((coercions: NodeMap<Expr, Type>) => void)[] = [];
    const element = r.element;
    for (const x of e.elements as Expr[]) {
      const have = types.get(x)!;
      const shape = typing.fits(have, element) ? undefined : literalShape(typing, x, element, types);
      if (!shape && !typing.fits(have, element)) return undefined;
      steps.push((coercions) => {
        shape?.apply(coercions);
        if (types.get(x) !== element) coercions.set(x, element);
      });
    }
    return { type: to, apply: (coercions) => {
      steps.forEach((step) => step(coercions));
      types.set(e, to);
    } };
  }
  // A literal with spreads takes its fields' types from them, which no literal narrows.
  if (e.kind !== "object" || r.kind !== "object" || e.props.some((p) => p.kind === "spread")) return undefined;
  const fields: Field[] = [];
  const steps: ((coercions: NodeMap<Expr, Type>) => void)[] = [];
  const own = types.get(e) as Exclude<Type, string>;
  for (const p of e.props) {
    const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
    const want = typing.field(to, name)?.type;
    const have = typing.field(own, name)!.type;
    if (!want) return undefined;
    const value = p.kind === "property" ? p.value : undefined;
    // A literal's value takes the literal type wanted, alone or in a union of them.
    const w = typeof want === "string" ? undefined : typing.rec(want);
    const choices = w?.kind === "union" ? w.members : [want];
    const literal = value && choices.find((c): c is LiteralType => { const r = typeof c === "string" ? undefined : typing.rec(c); return r?.kind === "literal" && !r.owner && literalValue(value) === r.value; });
    const nested = value && !literal && !typing.fits(have, want) ? literalShape(typing, value, want, types) : undefined;
    if (!literal && !nested && !typing.fits(have, want)) return undefined;
    fields.push({ name, type: literal ? literal : nested ? nested.type : have });
    if (literal) steps.push((coercions) => coercions.set(value!, literal));
    if (nested) steps.push(nested.apply);
  }
  // An optional field left out is filled in empty when the value meets the type.
  if (r.fields.some((f) => !f.optional && !fields.some((g) => g.name === f.name))) return undefined;
  const type = typing.objectType(fields);
  return { type, apply: (coercions) => {
    steps.forEach((step) => step(coercions));
    types.set(e, type);
  } };
}

// A field write must reach one member: through a union, which may hold any of several, the
// field could sit anywhere, so the union has to be narrowed to one member first.
// A mutating method call likewise needs its receiver in one member.
export function intoMember(typing: Typing, target: Expr, types: NodeMap<Expr, Type>, action = "assign to") {
  const textLiteral = (m: Type) => {
    const r = typeof m === "string" ? undefined : typing.rec(m);
    return r?.kind === "literal" && typeof r.value === "string";
  };
  for (let e = target; e.kind === "member"; e = e.object) {
    const found = types.get(e.object);
    const f = found === undefined || typeof found === "string" ? undefined : typing.rec(found);
    const object = f?.kind === "ref" ? f.to : found;
    const o = object === undefined || typeof object === "string" ? undefined : typing.rec(object);
    // A union of string literals is a string, which the string rules reject writing to.
    if (o?.kind === "union" && !o.members.every(textLiteral)) {
      const what = action === "assign to" ? `assign to '${e.name}'` : `${action} '${e.name}'`;
      throw new CompileError("E0109", `can't ${what} through '${typing.show(object!)}'; narrow it to one member first`, target.start, target.end);
    }
  }
}

// A field every member of a union has, read without narrowing first: its type is the union
// of the members' field types. This is how a discriminant like `x.kind` is read.
export function unionField(typing: Typing, union: UnionType, name: string, at: Span): Type | undefined {
  const found = typing.rec(union).members.map((m) => (typeof m === "string" ? undefined : typing.field(m, name)));
  if (found.some((f) => !f || (f.access ?? "public") !== "public")) return undefined;
  return typing.unionType(found.map((f) => f!.type));
}

// `x instanceof C` checks whether x holds an instance of C or of a class extending it; each
// keeps its own type when narrowed, its base's fields reached through the base it embeds.
export function instanceofCheck(e: Extract<Expr, { kind: "binary" }>, host: Union): Type {
  const left = host.read(e.left);
  const l = typeof left === "string" ? undefined : host.typing.rec(left);
  const held = l?.kind === "ref" ? l.to : left;
  const h = typeof held === "string" ? undefined : host.typing.rec(held);
  if (h?.kind === "dyn") {
    throw new CompileError("E0109", `a '${host.typing.show(held)}' keeps no record of its value's class, so 'instanceof' can't test it; add a method to the interface that says`, e.start, e.end);
  }
  const c = e.right.kind === "ident" ? host.classNamed(e.right.name) : undefined;
  // `Map`, `Set` and `Array` aren't classes in Fish; testing for one picks a union's member.
  if (!c && e.right.kind === "ident" && ["Map", "Set", "Array"].includes(e.right.name)) {
    if (h === undefined || h.kind === "literal" || h.kind === "pattern") {
      throw new CompileError("E0109", `'instanceof' tests an object, and a '${host.typing.show(held)}' is never a ${e.right.name}`, e.start, e.end);
    }
    host.kindTests.set(e, e.right.name as Kind);
    return "boolean";
  }
  // A generic class written without its type arguments is the instance of it the value may be.
  const name = e.right.kind === "ident" ? e.right.name : undefined;
  const members = h?.kind === "union" ? h.members : [held];
  // A member may be one through its base, as `Words extends List<string>` is a `List`.
  const instances = c || !name ? [] : [...new TypeSet(members.flatMap((m) => {
    if (typeof m === "string") return [];
    const r = host.typing.rec(m);
    for (let x: ClassType | undefined = r.kind === "class" ? (m as ClassType) : undefined; x; x = host.typing.rec(x).base) if (host.typing.rec(x).generic?.name === name) return [x];
    return [];
  }))];
  if (instances.length > 1) throw new CompileError("E0109", `'${name}' is generic, and this value may be more than one instance of it, which 'instanceof' can't tell apart; test a field that says which`, e.right.start, e.right.end);
  const tested = c ?? instances[0];
  if (!tested) throw new CompileError("E0109", "the right side of 'instanceof' must be a class, or a generic class this value may be an instance of", e.right.start, e.right.end);
  host.types.set(e.right, tested);
  return "boolean";
}

// The number types a union holds. In an instance, a union holding a type parameter is read as
// the union it flattens into, so a literal meeting `T | 0` with T = `i32 | string` is an i32 as
// it is meeting `i32 | string | 0`.
export function numberMembers(typing: Typing, t: Type, members: (u: UnionType) => Type[] = (u) => typing.rec(u).members): Type[] {
  if (typeof t === "string") return [];
  const r = typing.rec(t);
  if (r.kind !== "union") return [];
  const flat = holdsArgument(typing, t as UnionType) ? typing.lower(t) : t;
  const f = typeof flat === "string" ? undefined : typing.rec(flat);
  return (f?.kind === "union" ? members(flat as UnionType) : [flat]).filter(isNumeric);
}

// Whether an instance's union holds a type parameter, which stands for its type argument there.
export function holdsArgument(typing: Typing, t: UnionType): boolean {
  return typing.rec(t).members.some((m) => {
    const r = typeof m === "string" ? undefined : typing.rec(m);
    return r?.kind === "param" && r.concrete !== undefined;
  });
}

// A `?:` whose sides have different types makes the union of both, as in TypeScript.
export function bothSides(typing: Typing, e: Extract<Expr, { kind: "conditional" }>, then: Type, otherwise: Type, coerce: Coerce): Type {
  const both = [then, otherwise];
  const kinds = both.map((t) => (typeof t === "string" ? t : typing.rec(t).kind));
  if (kinds.includes("closure")) throw unsupported("unions holding functions", e);
  if (kinds.includes("void") || kinds.includes("interface") || kinds.includes("param")) {
    throw new CompileError("E0101", `both sides of '?:' must have the same type, not '${typing.show(then)}' and '${typing.show(otherwise)}'`, e.start, e.end);
  }
  const union = typing.unionType(both);
  coerce(e.then, then, union, `type '${typing.show(then)}' is not assignable to type '${typing.show(union)}'`);
  coerce(e.else, otherwise, union, `type '${typing.show(otherwise)}' is not assignable to type '${typing.show(union)}'`);
  return union;
}

type Coerce = (e: Expr, type: Type, to: Type, message: string) => void;

// A value goes into the one union member it is or fits; a literal expression may also be a
// literal member with its value. A union goes into a wider one member by member.
export function intoUnion(e: Expr, type: Type, to: UnionType, message: string, host: Union) {
  const kindOf = (t: Type) => (typeof t === "string" ? undefined : host.typing.rec(t).kind);
  // A literal goes into the one number type a union holds.
  const numbers = numberMembers(host.typing, to);
  if (!host.typing.rec(to).members.includes(type) && numbers.length === 1 && host.adapt(e, numbers[0]!)) type = numbers[0]!;
  // In an instance, a type parameter no member takes goes in as the members its type argument has.
  const unionMembers = (t: Type) => {
    const r = typeof t === "string" ? undefined : host.typing.rec(t);
    return r?.kind === "union" ? r.members : [t];
  };
  const parts = (s: Type): Type[] => {
    const r = typeof s === "string" ? undefined : host.typing.rec(s);
    return unionMembers(r?.kind === "param" && r.concrete && host.typing.membersFor(s, to).length === 0 ? host.typing.lower(s) : s);
  };
  const sources = unionMembers(type).flatMap(parts);
  if (sources.some((s) => kindOf(s) === "generator")) throw unsupported("unions holding generators", e);
  if (sources.some((s) => kindOf(s) === "future")) throw unsupported("unions holding promises", e);
  for (const source of sources) {
    // A throw expression never gives a value, so it goes nowhere in particular.
    if (source === "never") continue;
    const value = literalValue(e);
    // A plain literal expression never becomes an enum's member.
    const literal = host.typing.rec(to).members.find((m) => {
      const r = typeof m === "string" ? undefined : host.typing.rec(m);
      return r?.kind === "literal" && !r.owner && r.value === value;
    });
    const r = literal === undefined || typeof literal === "string" ? undefined : host.typing.rec(literal);
    if (literal && r?.kind === "literal" && sources.length === 1 && host.typing.baseOf(literal as LiteralType) === type) {
      host.types.set(e, literal);
      break;
    }
    let into = host.typing.membersFor(source, to);
    // A fresh object literal may fit a member through its literal fields, as `{ ok: true }`
    // fits `{ ok: true }`; when exactly one member takes it that way, it becomes that shape.
    const shapes = into.length === 0 && sources.length === 1 ? host.typing.rec(to).members.map((m) => literalShape(host.typing, e, m, host.types)) : [];
    if (shapes.filter((s) => s).length === 1) {
      const shape = shapes.find((s) => s)!;
      shape.apply(host.coercions);
      into = [host.typing.rec(to).members[shapes.indexOf(shape)]!];
    }
    if (into.length === 0) throw new CompileError("E0101", message, e.start, e.end);
    if (into.length > 1) {
      throw new CompileError("E0109", `type '${host.typing.show(source)}' fits more than one member of '${host.typing.show(to)}': ${into.map((m) => `'${host.typing.show(m)}'`).join(" and ")}`, e.start, e.end);
    }
    if (sources.length === 1) host.excess(e, into[0]!);
  }
  host.coercions.set(e, to);
}

// `typeof x === "number"` checks which kind of value x holds, which for a union is its tag.
export function typeofComparison(e: Expr, host: Union): Type | undefined {
  const test = typeofTest(e);
  if (!test) return undefined;
  const tested = host.read(test.operand);
  const t = typeof tested === "string" ? undefined : host.typing.rec(tested);
  const held = t?.kind === "ref" ? t.to : tested;
  const h = typeof held === "string" ? undefined : host.typing.rec(held);
  if (h?.kind === "union" && h.members.some((t) => host.typing.isPlainJs(t))) throw new CompileError("E1005", `'typeof' can't tell what a 'JsValue' in a union holds yet; test the 'JsValue' on its own`, test.operand.start, test.operand.end);
  const names = host.typing.isPlainJs(held) ? JS_TYPEOF : TYPEOF;
  if (test.name.kind !== "string" || !names.has(test.name.value)) {
    throw new CompileError("E0109", `'typeof' can only be compared with ${[...names].map((n) => `"${n}"`).join(", ")} here`, test.name.start, test.name.end);
  }
  return "boolean";
}

// `x === v` with x a union compares the member x holds with v, so it needs a member v might
// equal.
export function unionComparison(e: Extract<Expr, { kind: "binary" }>, host: Union, adapt: (e: Expr, to: Type) => boolean): Type | undefined {
  let [left, right] = [host.read(e.left), host.read(e.right)];
  // A literal compared with a union holding one number type takes that type.
  const number = (t: Type) => numberMembers(host.typing, t, (u) => opened(host.typing, u));
  if (number(left).length === 1 && adapt(e.right, number(left)[0]!)) right = number(left)[0]!;
  if (number(right).length === 1 && adapt(e.left, number(right)[0]!)) left = number(right)[0]!;
  // A union of strings and patterns is a string once lowered, compared as one.
  const union = (t: Type) => {
    const r = typeof t === "string" ? undefined : host.typing.rec(t);
    return r?.kind === "union" ? (t as UnionType) : undefined;
  };
  const isUnion = (t: Type) => union(t) !== undefined && host.typing.lower(t) !== "string";
  // In an instance, a union holding a type parameter is the union its type argument flattens into.
  const flat = (t: Type) => {
    const u = union(t);
    return u && holdsArgument(host.typing, u) ? host.typing.lower(t) : t;
  };
  const instanced = flat(left) !== left || flat(right) !== right;
  [left, right] = [flat(left), flat(right)];
  if (!isUnion(left) && !isUnion(right)) {
    if (!instanced) return undefined;
    // What's left is a plain value, which a literal on the other side becomes to be compared.
    if (host.typing.lower(left) === "string" && host.typing.lower(right) !== "string") host.coercions.set(e.right, "string");
    if (host.typing.lower(right) === "string" && host.typing.lower(left) !== "string") host.coercions.set(e.left, "string");
    if (isNumeric(left)) adapt(e.right, left);
    if (isNumeric(right)) adapt(e.left, right);
  }
  if (objectsMeet(host.typing, left, right)) throw unsupported("comparisons of objects", e);
  if (!comparable(host.typing, left, right)) {
    throw new CompileError("E0112", `this comparison appears to be unintentional because the types '${host.typing.show(left)}' and '${host.typing.show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}

// Objects and instances have no equality until `Eq`, so a comparison where both sides might
// hold one is rejected, whether or not they are unions. Any two object members may meet,
// since a wider object fits an unrelated narrower type.
export function objectsMeet(typing: Typing, a: Type, b: Type): boolean {
  const members = (t: Type) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "union" ? r.members : [t];
  };
  const object = (t: Type) => typeof t !== "string" && !["literal", "pattern"].includes(typing.rec(t).kind);
  return members(a).some(object) && members(b).some(object);
}

// A type's members, a member that holds itself standing for the members it holds.
function opened(typing: Typing, t: Type): Type[] {
  const union = (u: Type) => {
    const r = typeof u === "string" ? undefined : typing.rec(u);
    return r?.kind === "union" ? r : undefined;
  };
  return (union(t)?.members ?? [t]).flatMap((m) => {
    const inner = typing.unfold(m);
    return inner !== m ? (union(inner)?.members ?? [m]) : [m];
  });
}

// Whether a value of `a` might equal one of `b`: the same primitive, a literal and its base,
// or two literals of one value, for any members of either when it is a union.
export function comparable(typing: Typing, a: Type, b: Type): boolean {
  const members = (t: Type) => opened(typing, t);
  const literal = (t: Type) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "literal" ? r : undefined;
  };
  const base = (t: Type) => (literal(t) ? (typing.baseOf(t as LiteralType) ?? t) : typeof t !== "string" && typing.rec(t).kind === "pattern" ? "string" : t);
  return members(a).some((x) => members(b).some((y) => {
    const [lx, ly] = [literal(x), literal(y)];
    if (lx && ly) return lx.value === ly.value;
    return base(x) === base(y) && typeof base(x) === "string";
  }));
}
