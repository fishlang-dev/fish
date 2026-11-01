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
  value(e: Expr): Type;
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
  const { field, unfold, fits, objectType, rec } = typing;
  to = unfold(to);
  if (typeof to === "string") return undefined;
  const r = rec(to);
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
      const shape = fits(have, element) ? undefined : literalShape(typing, x, element, types);
      if (!shape && !fits(have, element)) return undefined;
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
    const want = field(to, name)?.type;
    const have = field(own, name)!.type;
    if (!want) return undefined;
    const value = p.kind === "property" ? p.value : undefined;
    // A literal's value takes the literal type wanted, alone or in a union of them.
    const w = typeof want === "string" ? undefined : rec(want);
    const choices = w?.kind === "union" ? w.members : [want];
    const literal = value && choices.map((c) => (typeof c === "string" ? undefined : rec(c))).find((c): c is LiteralType => c?.kind === "literal" && !c.owner && literalValue(value) === c.value);
    const nested = value && !literal && !fits(have, want) ? literalShape(typing, value, want, types) : undefined;
    if (!literal && !nested && !fits(have, want)) return undefined;
    fields.push({ name, type: literal ? literal : nested ? nested.type : have });
    if (literal) steps.push((coercions) => coercions.set(value!, literal));
    if (nested) steps.push(nested.apply);
  }
  // An optional field left out is filled in empty when the value meets the type.
  if (r.fields.some((f) => !f.optional && !fields.some((g) => g.name === f.name))) return undefined;
  const type = objectType(fields);
  return { type, apply: (coercions) => {
    steps.forEach((step) => step(coercions));
    types.set(e, type);
  } };
}

// A field write must reach one member: through a union, which may hold any of several, the
// field could sit anywhere, so the union has to be narrowed to one member first.
// A mutating method call likewise needs its receiver in one member.
export function intoMember({ rec, show }: Typing, target: Expr, types: NodeMap<Expr, Type>, action = "assign to") {
  const textLiteral = (m: Type) => {
    const r = typeof m === "string" ? undefined : rec(m);
    return r?.kind === "literal" && typeof r.value === "string";
  };
  for (let e = target; e.kind === "member"; e = e.object) {
    const found = types.get(e.object);
    const f = found === undefined || typeof found === "string" ? undefined : rec(found);
    const object = f?.kind === "ref" ? f.to : found;
    const o = object === undefined || typeof object === "string" ? undefined : rec(object);
    // A union of string literals is a string, which the string rules reject writing to.
    if (o?.kind === "union" && !o.members.every(textLiteral)) {
      const what = action === "assign to" ? `assign to '${e.name}'` : `${action} '${e.name}'`;
      throw new CompileError(`can't ${what} through '${show(object!)}'; narrow it to one member first`, target.start, target.end);
    }
  }
}

// A field every member of a union has, read without narrowing first: its type is the union
// of the members' field types. This is how a discriminant like `x.kind` is read.
export function unionField({ field, unionType }: Typing, union: UnionType, name: string, at: Span): Type | undefined {
  const found = union.members.map((m) => (typeof m === "string" ? undefined : field(m, name)));
  if (found.some((f) => !f || (f.access ?? "public") !== "public")) return undefined;
  return unionType(found.map((f) => f!.type));
}

// `x instanceof C` checks whether x holds an instance of C or of a class extending it; each
// keeps its own type when narrowed, its base's fields reached through the base it embeds.
export function instanceofCheck(e: Extract<Expr, { kind: "binary" }>, { kindTests, typing: { rec, show }, types, value, classNamed }: Union): Type {
  const left = value(e.left);
  const l = typeof left === "string" ? undefined : rec(left);
  const held = l?.kind === "ref" ? l.to : left;
  const h = typeof held === "string" ? undefined : rec(held);
  if (h?.kind === "dyn") {
    throw new CompileError(`a '${show(held)}' keeps no record of its value's class, so 'instanceof' can't test it; add a method to the interface that says`, e.start, e.end);
  }
  const c = e.right.kind === "ident" ? classNamed(e.right.name) : undefined;
  // `Map`, `Set` and `Array` aren't classes in Fish; testing for one picks a union's member.
  if (!c && e.right.kind === "ident" && ["Map", "Set", "Array"].includes(e.right.name)) {
    if (h === undefined || h.kind === "literal" || h.kind === "pattern") {
      throw new CompileError(`'instanceof' tests an object, and a '${show(held)}' is never a ${e.right.name}`, e.start, e.end);
    }
    kindTests.set(e, e.right.name as Kind);
    return "boolean";
  }
  // A generic class written without its type arguments is the instance of it the value may be.
  const name = e.right.kind === "ident" ? e.right.name : undefined;
  const members = h?.kind === "union" ? h.members : [held];
  // A member may be one through its base, as `Words extends List<string>` is a `List`.
  const instances = c || !name ? [] : [...new TypeSet(members.flatMap((m) => {
    if (typeof m === "string") return [];
    const r = rec(m);
    for (let x: ClassType | undefined = r.kind === "class" ? r : undefined; x; x = x.base) if (x.generic?.name === name) return [x];
    return [];
  }))];
  if (instances.length > 1) throw new CompileError(`'${name}' is generic, and this value may be more than one instance of it, which 'instanceof' can't tell apart; test a field that says which`, e.right.start, e.right.end);
  const tested = c ?? instances[0];
  if (!tested) throw new CompileError("the right side of 'instanceof' must be a class, or a generic class this value may be an instance of", e.right.start, e.right.end);
  types.set(e.right, tested);
  return "boolean";
}

// The number types a union holds. In an instance, a union holding a type parameter is read as
// the union it flattens into, so a literal meeting `T | 0` with T = `i32 | string` is an i32 as
// it is meeting `i32 | string | 0`.
export function numberMembers(typing: Typing, t: Type, members: (u: UnionType) => Type[] = (u) => u.members): Type[] {
  const { lower, rec } = typing;
  if (typeof t === "string") return [];
  const r = rec(t);
  if (r.kind !== "union") return [];
  const flat = holdsArgument(typing, r) ? lower(t) : t;
  const f = typeof flat === "string" ? undefined : rec(flat);
  return (f?.kind === "union" ? members(f) : [flat]).filter(isNumeric);
}

// Whether an instance's union holds a type parameter, which stands for its type argument there.
export function holdsArgument({ rec }: Typing, t: UnionType): boolean {
  return t.members.some((m) => {
    const r = typeof m === "string" ? undefined : rec(m);
    return r?.kind === "param" && r.concrete !== undefined;
  });
}

// A `?:` whose sides have different types makes the union of both, as in TypeScript.
export function bothSides({ rec, show, unionType }: Typing, e: Extract<Expr, { kind: "conditional" }>, then: Type, otherwise: Type, coerce: Coerce): Type {
  const both = [then, otherwise];
  const kinds = both.map((t) => (typeof t === "string" ? t : rec(t).kind));
  if (kinds.includes("closure")) throw unsupported("unions holding functions", e);
  if (kinds.includes("void") || kinds.includes("interface") || kinds.includes("param")) {
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
export function intoUnion(e: Expr, type: Type, to: UnionType, message: string, { typing, types, coercions, excess, adapt }: Union) {
  const { baseOf, membersFor, rec, show, lower } = typing;
  const kindOf = (t: Type) => (typeof t === "string" ? undefined : rec(t).kind);
  // A literal goes into the one number type a union holds.
  const numbers = numberMembers(typing, to);
  if (!to.members.includes(type) && numbers.length === 1 && adapt(e, numbers[0]!)) type = numbers[0]!;
  // In an instance, a type parameter no member takes goes in as the members its type argument has.
  const unionMembers = (t: Type) => {
    const r = typeof t === "string" ? undefined : rec(t);
    return r?.kind === "union" ? r.members : [t];
  };
  const parts = (s: Type): Type[] => {
    const r = typeof s === "string" ? undefined : rec(s);
    return unionMembers(r?.kind === "param" && r.concrete && membersFor(s, to).length === 0 ? lower(s) : s);
  };
  const sources = unionMembers(type).flatMap(parts);
  if (sources.some((s) => kindOf(s) === "generator")) throw unsupported("unions holding generators", e);
  if (sources.some((s) => kindOf(s) === "future")) throw unsupported("unions holding promises", e);
  for (const source of sources) {
    // A throw expression never gives a value, so it goes nowhere in particular.
    if (source === "never") continue;
    const value = literalValue(e);
    // A plain literal expression never becomes an enum's member.
    const literal = to.members.find((m) => {
      const r = typeof m === "string" ? undefined : rec(m);
      return r?.kind === "literal" && !r.owner && r.value === value;
    });
    const r = literal === undefined || typeof literal === "string" ? undefined : rec(literal);
    if (literal && r?.kind === "literal" && sources.length === 1 && baseOf(r) === type) {
      types.set(e, literal);
      break;
    }
    let into = membersFor(source, to);
    // A fresh object literal may fit a member through its literal fields, as `{ ok: true }`
    // fits `{ ok: true }`; when exactly one member takes it that way, it becomes that shape.
    const shapes = into.length === 0 && sources.length === 1 ? to.members.map((m) => literalShape(typing, e, m, types)) : [];
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
export function typeofComparison(e: Expr, { value, typing: { isPlainJs, rec } }: Union): Type | undefined {
  const test = typeofTest(e);
  if (!test) return undefined;
  const tested = value(test.operand);
  const t = typeof tested === "string" ? undefined : rec(tested);
  const held = t?.kind === "ref" ? t.to : tested;
  const h = typeof held === "string" ? undefined : rec(held);
  if (h?.kind === "union" && h.members.some(isPlainJs)) throw new CompileError(`'typeof' can't tell what a 'JsValue' in a union holds yet; test the 'JsValue' on its own`, test.operand.start, test.operand.end);
  const names = isPlainJs(held) ? JS_TYPEOF : TYPEOF;
  if (test.name.kind !== "string" || !names.has(test.name.value)) {
    throw new CompileError(`'typeof' can only be compared with ${[...names].map((n) => `"${n}"`).join(", ")} here`, test.name.start, test.name.end);
  }
  return "boolean";
}

// `x === v` with x a union compares the member x holds with v, so it needs a member v might
// equal.
export function unionComparison(e: Extract<Expr, { kind: "binary" }>, { typing, value, coercions }: Union, adapt: (e: Expr, to: Type) => boolean): Type | undefined {
  const { lower, rec, show } = typing;
  let [left, right] = [value(e.left), value(e.right)];
  // A literal compared with a union holding one number type takes that type.
  const number = (t: Type) => numberMembers(typing, t, (u) => opened(typing, u));
  if (number(left).length === 1 && adapt(e.right, number(left)[0]!)) right = number(left)[0]!;
  if (number(right).length === 1 && adapt(e.left, number(right)[0]!)) left = number(right)[0]!;
  // A union of strings and patterns is a string once lowered, compared as one.
  const union = (t: Type) => {
    const r = typeof t === "string" ? undefined : rec(t);
    return r?.kind === "union" ? r : undefined;
  };
  const isUnion = (t: Type) => union(t) !== undefined && lower(t) !== "string";
  // In an instance, a union holding a type parameter is the union its type argument flattens into.
  const flat = (t: Type) => {
    const u = union(t);
    return u && holdsArgument(typing, u) ? lower(t) : t;
  };
  const instanced = flat(left) !== left || flat(right) !== right;
  [left, right] = [flat(left), flat(right)];
  if (!isUnion(left) && !isUnion(right)) {
    if (!instanced) return undefined;
    // What's left is a plain value, which a literal on the other side becomes to be compared.
    if (lower(left) === "string" && lower(right) !== "string") coercions.set(e.right, "string");
    if (lower(right) === "string" && lower(left) !== "string") coercions.set(e.left, "string");
    if (isNumeric(left)) adapt(e.right, left);
    if (isNumeric(right)) adapt(e.left, right);
  }
  if (objectsMeet(typing, left, right)) throw unsupported("comparisons of objects", e);
  if (!comparable(typing, left, right)) {
    throw new CompileError(`this comparison appears to be unintentional because the types '${show(left)}' and '${show(right)}' have no overlap`, e.start, e.end);
  }
  return "boolean";
}

// Objects and instances have no equality until `Eq`, so a comparison where both sides might
// hold one is rejected, whether or not they are unions. Any two object members may meet,
// since a wider object fits an unrelated narrower type.
export function objectsMeet({ rec }: Typing, a: Type, b: Type): boolean {
  const members = (t: Type) => {
    const r = typeof t === "string" ? undefined : rec(t);
    return r?.kind === "union" ? r.members : [t];
  };
  const object = (t: Type) => typeof t !== "string" && !["literal", "pattern"].includes(rec(t).kind);
  return members(a).some(object) && members(b).some(object);
}

// A type's members, a member that holds itself standing for the members it holds.
function opened({ rec, unfold }: Typing, t: Type): Type[] {
  const union = (u: Type) => {
    const r = typeof u === "string" ? undefined : rec(u);
    return r?.kind === "union" ? r : undefined;
  };
  return (union(t)?.members ?? [t]).flatMap((m) => {
    const inner = unfold(m);
    return inner !== m ? (union(inner)?.members ?? [m]) : [m];
  });
}

// Whether a value of `a` might equal one of `b`: the same primitive, a literal and its base,
// or two literals of one value, for any members of either when it is a union.
export function comparable(typing: Typing, a: Type, b: Type): boolean {
  const { rec } = typing;
  const members = (t: Type) => opened(typing, t);
  const literal = (t: Type) => {
    const r = typeof t === "string" ? undefined : rec(t);
    return r?.kind === "literal" ? r : undefined;
  };
  const base = (t: Type) => {
    const l = literal(t);
    return l ? (typing.baseOf(l) ?? t) : typeof t !== "string" && rec(t).kind === "pattern" ? "string" : t;
  };
  return members(a).some((x) => members(b).some((y) => {
    const [lx, ly] = [literal(x), literal(y)];
    if (lx && ly) return lx.value === ly.value;
    return base(x) === base(y) && typeof base(x) === "string";
  }));
}
