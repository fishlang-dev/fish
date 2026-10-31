import { freshId } from "./compilation.ts";
import type { Expr, Pattern } from "./parser.ts";
import { unsupported } from "./unsupported.ts";
import { literalType, lower, show, unionType, type ClassType, type Field, type LiteralType, type ObjectType, type ParamType, type Type, type VariantType } from "./typing.ts";

// What `match` knows about patterns apart from checking expressions: what each pattern tests,
// the names they bind, and which values of the matched type no arm covers.

// What the checker found a pattern to test, with the type of the value it meets:
// - `any`: everything, as `_` and a binding name do;
// - `literal`: equality with the literal in the pattern, a C-like enum member's included;
// - `variant`: a data-carrying enum's member, then its payload's patterns;
// - `some`: an Option holding a value, then the pattern for that value, of type `inner`;
// - `none`: an empty Option;
// - `or`: any of its alternatives.
export type PatternTest =
  | { kind: "any" }
  | { kind: "literal"; value: LiteralValue; member?: LiteralType }
  | { kind: "variant"; variant: VariantType; args: Pattern[] }
  | { kind: "some"; inner: Type; arg: Pattern }
  | { kind: "none" }
  | { kind: "or"; alternatives: Pattern[] }
  // An object pattern: the members of a union it can match, each holding every field it names,
  // and for each field its name, its pattern and the field's type across those members.
  | { kind: "object"; shapes: Type[]; fields: [string, Pattern, Type][] }
  // An array of exactly this many elements, each tested by its pattern.
  | { kind: "array"; element: Type; items: Pattern[] };
export type PatternInfo = { type: Type } & PatternTest;

export type LiteralValue = string | bigint | boolean | number | null;

// What an object pattern can take apart: an object, an instance, or a type parameter bounded by
// an object type or an interface, as a parameter typed with one is.
export type Shape = ObjectType | ClassType | ParamType;

// A pattern's information with each type it holds as an instance sees it.
export function lowerPattern(info: PatternInfo): PatternInfo {
  const type = lower(info.type);
  if (info.kind === "variant") return { ...info, type, variant: lower(info.variant) as VariantType };
  if (info.kind === "some") return { ...info, type, inner: lower(info.inner) };
  if (info.kind === "object") {
    const shapes = info.shapes.map(lower);
    // An interface's field may be an accessor in the instance that meets it.
    for (const [key, p] of info.fields) {
      if (shapes.some((s) => typeof s !== "string" && s.kind === "class" && !objectFields(s).some((f) => f.name === key))) throw unsupported("object patterns reading a field a getter provides", p);
    }
    return { ...info, type, shapes, fields: info.fields.map(([k, p, t]) => [k, p, lower(t)]) };
  }
  if (info.kind === "array") return { ...info, type, element: lower(info.element) };
  return { ...info, type };
}

// The value a literal pattern stands for, or null for `null`.
export function literalOf(e: Expr): LiteralValue {
  if (e.kind === "int") return e.value;
  if (e.kind === "unary" && e.operand.kind === "int") return -e.operand.value;
  if (e.kind === "string" || e.kind === "bool") return e.value;
  if (e.kind === "null") return null;
  // A float pattern is never a case that can be listed, so no case is ever this value.
  return Number.NaN;
}

// Whether an expression makes a value of its own, which a match then owns, rather than reading
// one that lives somewhere, which a match borrows.
export function made(e: Expr): boolean {
  return ["call", "new", "object", "array", "template", "conditional", "match"].includes(e.kind) || (e.kind === "binary" && (e.op === "+" || e.op === "??"));
}

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

// The kinds of value a type has, for coverage: each literal, the empty value, each variant, or
// a whole open type, which only a catch-all covers. An Option is its empty value and `Some` of
// the rest.
type Case =
  | { kind: "literal"; type: LiteralType }
  | { kind: "none" }
  | { kind: "some"; inner: Type }
  | { kind: "variant"; variant: VariantType }
  | { kind: "object"; type: Shape }
  | { kind: "open"; type: Type };

function cases(t: Type): Case[] {
  if (t === "boolean") return [literalType(true), literalType(false)].map((type) => ({ kind: "literal", type }));
  const members = typeof t !== "string" && t.kind === "union" ? t.members : [t];
  if (members.includes("null") && members.length > 1) return [{ kind: "none" }, { kind: "some", inner: unionType(members.filter((m) => m !== "null")) }];
  return members.flatMap((m): Case[] => {
    if (m === "boolean") return cases(m);
    if (m === "null") return [{ kind: "none" }];
    if (typeof m !== "string" && m.kind === "literal") return [{ kind: "literal", type: m }];
    if (typeof m !== "string" && m.kind === "variant") return [{ kind: "variant", variant: m }];
    if (typeof m !== "string" && (m.kind === "object" || m.kind === "class" || (m.kind === "param" && (m.bound?.kind === "object" || m.bound?.kind === "interface")))) return [{ kind: "object", type: m }];
    return [{ kind: "open", type: m }];
  });
}

// One row of patterns still to try, and the types of the values they meet.
type Row = Pattern[];

// A value no row covers, as it reads in a message, or undefined when every value is covered.
// This is the usefulness check Rust's compiler uses: the first column is split by the case each
// value of its type falls into, keeping the rows whose first pattern can match that case.
export function uncovered(rows: Row[], types: Type[], recorded: (p: Pattern) => PatternInfo | undefined): string[] | undefined {
  // The wildcards made while splitting columns were never checked, and match anything.
  const info = (p: Pattern): PatternInfo => recorded(p) ?? { kind: "any", type: "void" };
  if (types.length === 0) return rows.length === 0 ? [] : undefined;
  const [type, ...rest] = types as [Type, ...Type[]];
  const expanded = rows.flatMap((row) => alternatives(row[0]!, info).map((p) => [p, ...row.slice(1)]));
  for (const c of cases(type)) {
    const fields = fieldTypes(c);
    const kept: Row[] = [];
    for (const [p, ...tail] of expanded) {
      const parts = specialize(p!, c, fields.length, info);
      if (parts) kept.push([...parts, ...tail]);
    }
    const missing = uncovered(kept, [...fields, ...rest], recorded);
    if (missing) return [render(c, missing.slice(0, fields.length)), ...missing.slice(fields.length)];
  }
  return undefined;
}

function alternatives(p: Pattern, info: (p: Pattern) => PatternInfo): Pattern[] {
  const found = info(p);
  return found.kind === "or" ? found.alternatives.flatMap((a) => alternatives(a, info)) : [p];
}

function fieldTypes(c: Case): Type[] {
  if (c.kind === "variant") return c.variant.fields.map((f) => f.type);
  if (c.kind === "object") return objectFields(c.type).map((f) => f.type);
  if (c.kind === "some") return [c.inner];
  return [];
}

// The patterns for a case's fields when `p` can match a value of that case, or undefined.
function specialize(p: Pattern, c: Case, arity: number, info: (p: Pattern) => PatternInfo): Pattern[] | undefined {
  const found = info(p);
  const wild: Pattern[] = Array.from({ length: arity }, (): Pattern => ({ id: freshId(), kind: "wildcard", start: p.start, end: p.end }));
  // On an Option, a pattern for a value is a pattern for what `Some` holds.
  if (c.kind === "some" && found.kind !== "some" && found.kind !== "none" && found.kind !== "any") return [p];
  switch (found.kind) {
    case "any":
      return wild;
    case "literal":
      return c.kind === "literal" && (c.type === found.member || c.type.value === found.value) ? [] : undefined;
    case "none":
      return c.kind === "none" ? [] : undefined;
    case "some":
      return c.kind === "some" ? [found.arg] : undefined;
    case "variant":
      return c.kind === "variant" && c.variant === found.variant ? found.args : undefined;
    case "object": {
      // A field the pattern leaves out matches anything.
      if (c.kind !== "object" || !found.shapes.includes(c.type)) return undefined;
      return objectFields(c.type).map((f) => found.fields.find(([k]) => k === f.name)?.[1] ?? { id: freshId(), kind: "wildcard", start: p.start, end: p.end });
    }
    default:
      return undefined;
  }
}

// The fields an object pattern can test: an object's, or an instance's public ones, its bases'
// included.
export function objectFields(t: Shape): Field[] {
  if (t.kind === "object" || t.kind === "param") return t.fields;
  return [...(t.base ? objectFields(t.base) : []), ...t.fields].filter((f) => (f.access ?? "public") === "public");
}

function render(c: Case, fields: string[]): string {
  switch (c.kind) {
    case "literal":
      return show(c.type);
    case "none":
      return "null";
    case "some":
      return fields[0]!;
    case "variant":
      return fields.length > 0 ? `${c.variant.name}(${fields.join(", ")})` : c.variant.name;
    case "object": {
      // A field left out of an object pattern matches anything, so only the telling ones show.
      const shown = objectFields(c.type).flatMap((f, i) => (fields[i] === "_" ? [] : [`${f.name}: ${fields[i]}`]));
      return shown.length > 0 ? `{ ${shown.join(", ")} }` : "_";
    }
    case "open":
      return "_";
  }
}

// The message for a value no arm covers: the case to add, or the catch-all.
export function missing(example: string, type: Type): string {
  if (example === "_") return `this match doesn't cover every '${show(type)}'; add 'case _ =>' for the rest`;
  return `this match doesn't cover ${example}; add 'case ${example} =>', or 'case _ =>' for the rest`;
}
