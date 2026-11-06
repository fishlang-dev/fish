import type { CompileError } from "./diag.ts";
import { nextId, type Ids, type NodeMap } from "./nodes.ts";
import type { Expr, Pattern } from "./parser.ts";
import { clonePattern } from "./rebuild.ts";
import { unsupported } from "./unsupported.ts";
import type { ClassType, Field, LiteralType, ObjectType, ParamType, RecursiveType, Type, VariantType, Typing } from "./typing.ts";

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

export type LiteralValue = string | bigint | boolean | f64 | null;

// What an object pattern can take apart: an object, an instance, or a type parameter bounded by
// an object type or an interface, as a parameter typed with one is, or a union's member holding
// the union again, whose fields are in its block.
export type Shape = ObjectType | ClassType | ParamType | RecursiveType;

// A pattern's information with each type it holds as an instance sees it.
/** @throws {CompileError} */
export function lowerPattern(typing: Mut<Typing>, info: PatternInfo): PatternInfo {
  const type = typing.lower(info.type);
  if (info.kind === "variant") return { ...info, type, variant: typing.lower(info.variant) as VariantType };
  if (info.kind === "some") return { ...info, type, inner: typing.lower(info.inner) };
  if (info.kind === "object") {
    const shapes = info.shapes.map((t) => typing.lower(t));
    // An interface's field may be an accessor in the instance that meets it.
    for (let i: usize = 0; i < info.fields.length; i++) {
      const key = info.fields[i]![0];
      const p = clonePattern(info.fields[i]![1]);
      const getter = (s: Type) => {
        const r = typeof s === "string" ? undefined : typing.rec(s);
        return r?.kind === "class" && !objectFields(typing, s as ClassType).some((f) => f.name === key);
      };
      if (shapes.some((s) => getter(s))) throw unsupported("object patterns reading a field a getter provides", { start: p.start, end: p.end });
    }
    return { ...info, type, shapes, fields: info.fields.map(([k, p, t]): [string, Pattern, Type] => [k, clonePattern(p), typing.lower(t)]) };
  }
  if (info.kind === "array") return { ...info, type, element: typing.lower(info.element) };
  if (info.kind === "literal") return { ...info, type };
  if (info.kind === "or") return { ...info, type };
  if (info.kind === "none") return { kind: "none", type };
  return { kind: "any", type };
}

// The value a literal pattern stands for, or null for `null`.
export function literalOf(e: Ref<Expr>): LiteralValue {
  if (e.kind === "int") return e.value;
  if (e.kind === "unary" && e.operand.kind === "int") return -e.operand.value;
  if (e.kind === "string") return e.value;
  if (e.kind === "bool") return e.value;
  if (e.kind === "null") return null;
  // A float pattern is never a case that can be listed, so no case is ever this value.
  const zero: f64 = 0;
  return zero / zero;
}

// Whether an expression makes a value of its own, which a match then owns, rather than reading
// one that lives somewhere, which a match borrows.
export function made(e: Ref<Expr>): boolean {
  return ["call", "new", "object", "array", "template", "conditional", "match"].includes(e.kind) || (e.kind === "binary" && (e.op === "+" || e.op === "??"));
}

// The names a pattern binds, in order.
export function bindings(p: Ref<Pattern>): Extract<Pattern, { kind: "ident" }>[] {
  switch (p.kind) {
    case "ident":
      return [{ ...p }];
    case "or":
      return bindings(p.patterns[0]!);
    case "variant":
      return p.args === undefined ? [] : p.args.flatMap((a) => bindings(a));
    case "object":
      return p.props.flatMap((prop) => bindings(prop.value));
    case "array":
      return p.elements.flatMap((e): Extract<Pattern, { kind: "ident" }>[] => (e !== undefined ? bindings(e) : []));
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

function cases(typing: Mut<Typing>, t: Type): Case[] {
  if (t === "boolean") return [typing.literalType(true), typing.literalType(false)].map((type): Case => ({ kind: "literal", type }));
  const r = typeof t === "string" ? undefined : typing.rec(t);
  const members: Type[] = r?.kind === "union" ? r.members : [t];
  if (members.some((m) => m === "null") && members.length > 1) return [{ kind: "none" }, { kind: "some", inner: typing.unionType(members.filter((m) => m !== "null")) }];
  let out: Case[] = [];
  for (const m of members) {
    if (m === "boolean") {
      out.push({ kind: "literal", type: typing.literalType(true) });
      out.push({ kind: "literal", type: typing.literalType(false) });
      continue;
    }
    if (m === "null") {
      out.push({ kind: "none" });
      continue;
    }
    if (typeof m === "string") {
      out.push({ kind: "open", type: m });
      continue;
    }
    const r = typing.rec(m);
    if (r.kind === "literal") {
      out.push({ kind: "literal", type: m as LiteralType });
      continue;
    }
    if (r.kind === "variant") {
      out.push({ kind: "variant", variant: m as VariantType });
      continue;
    }
    if (r.kind === "object" || r.kind === "class" || (r.kind === "param" && (typing.recOf(r.bound)?.kind === "object" || typing.recOf(r.bound)?.kind === "interface"))) {
      out.push({ kind: "object", type: m as Shape });
      continue;
    }
    const boxed = r.kind === "recursive" ? typing.recOf(r.of)?.kind : undefined;
    if (boxed === "object" || boxed === "class") {
      out.push({ kind: "object", type: m as Shape });
      continue;
    }
    out.push({ kind: "open", type: m });
  }
  return out;
}

// One row of patterns still to try, and the types of the values they meet.
type Row = Pattern[];

// A value no row covers, as it reads in a message, or undefined when every value is covered.
// This is the usefulness check Rust's compiler uses: the first column is split by the case each
// value of its type falls into, keeping the rows whose first pattern can match that case.
// `recorded` is the table rather than a callback reading it: each recursion handing on a closure
// of its own would make another instance of these functions, without end, under Fish.
export function uncovered(typing: Mut<Typing>, ids: Mut<Ids>, rows: Row[], types: Type[], recorded: Ref<NodeMap<Pattern, PatternInfo>>): string[] | undefined {
  if (types.length === 0) return rows.length === 0 ? [] : undefined;
  const type = types[0]!;
  const rest = types.slice(1);
  let expanded: Row[] = [];
  for (const row of rows) {
    const tail = row.slice(1);
    for (const p of alternatives(row[0]!, recorded)) expanded.push([clonePattern(p), ...tail]);
  }
  const all = cases(typing, type);
  // A member holding the union again splits into fields of the union, without end; where no row
  // takes the column apart, every value of it is covered alike, so it needs no split.
  if (expanded.every((row) => info(recorded, row[0]!).kind === "any") && all.some((c) => c.kind === "object" && typing.rec(c.type).kind === "recursive")) {
    const missing = uncovered(typing, ids, expanded.map((row) => row.slice(1)), rest, recorded);
    return missing !== undefined ? ["_", ...missing] : undefined;
  }
  for (const c of all) {
    const fields = fieldTypes(typing, c);
    let kept: Row[] = [];
    for (const row of expanded) {
      const p = clonePattern(row[0]!);
      const tail = row.slice(1);
      const parts = specialize(typing, ids, p, c, fields.length, recorded);
      if (parts !== undefined) kept.push([...parts, ...tail]);
    }
    const missing = uncovered(typing, ids, kept, [...fields, ...rest], recorded);
    if (missing !== undefined) return [render(typing, c, missing.slice(0, fields.length as i64)), ...missing.slice(fields.length as i64)];
  }
  return undefined;
}

// What checking recorded for `p`; the wildcards made while splitting columns were never checked,
// and match anything.
function info(recorded: Ref<NodeMap<Pattern, PatternInfo>>, p: Ref<Pattern>): PatternInfo {
  const found = recorded.get(p);
  return found !== undefined ? found : { kind: "any", type: "void" };
}

function alternatives(p: Ref<Pattern>, recorded: Ref<NodeMap<Pattern, PatternInfo>>): Pattern[] {
  const found = info(recorded, p);
  if (found.kind !== "or") return [clonePattern(p)];
  let out: Pattern[] = [];
  for (const a of found.alternatives) for (const alt of alternatives(a, recorded)) out.push(clonePattern(alt));
  return out;
}

function fieldTypes(typing: Ref<Typing>, c: Ref<Case>): Type[] {
  if (c.kind === "variant") return typing.rec(c.variant).fields.map((f) => f.type);
  if (c.kind === "object") return objectFields(typing, c.type).map((f) => f.type);
  if (c.kind === "some") return [c.inner];
  return [];
}

// The patterns for a case's fields when `p` can match a value of that case, or undefined.
function specialize(typing: Ref<Typing>, ids: Mut<Ids>, p: Pattern, c: Ref<Case>, arity: usize, recorded: Ref<NodeMap<Pattern, PatternInfo>>): Pattern[] | undefined {
  const found = info(recorded, p);
  const start = p.start;
  const end = p.end;
  const wild: Pattern[] = Array.from({ length: arity }, (): Pattern => ({ id: nextId(ids), kind: "wildcard", start, end }));
  // On an Option, a pattern for a value is a pattern for what `Some` holds.
  if (c.kind === "some" && found.kind !== "some" && found.kind !== "none" && found.kind !== "any") return [p];
  switch (found.kind) {
    case "any":
      return wild;
    case "literal":
      return c.kind === "literal" && ((found.member !== undefined && c.type === found.member) || typing.rec(c.type).value === found.value) ? [] : undefined;
    case "none":
      return c.kind === "none" ? [] : undefined;
    case "some":
      return c.kind === "some" ? [found.arg] : undefined;
    case "variant":
      return c.kind === "variant" && c.variant === found.variant ? found.args : undefined;
    case "object": {
      // A field the pattern leaves out matches anything.
      if (c.kind !== "object" || !found.shapes.some((s) => s === c.type)) return undefined;
      return objectFields(typing, c.type).map((f): Pattern => {
        const pair = found.fields.find(([k]) => k === f.name);
        return pair !== undefined ? pair[1] : { id: nextId(ids), kind: "wildcard", start, end };
      });
    }
    default:
      return undefined;
  }
}

// The fields an object pattern can test: an object's, or an instance's public ones, its bases'
// included.
export function objectFields(typing: Ref<Typing>, t: Shape): Field[] {
  const r = typing.rec(t);
  if (r.kind === "recursive") return typing.recOf(r.of)?.kind === "object" || typing.recOf(r.of)?.kind === "class" ? objectFields(typing, r.of as Shape) : [];
  if (r.kind === "param" || r.kind === "object") return typing.fieldsOf(t);
  const baseFields: Field[] = r.base !== undefined ? objectFields(typing, r.base) : [];
  return [...baseFields, ...r.fields].filter((f) => (f.access ?? "public") === "public");
}

function render(typing: Mut<Typing>, c: Ref<Case>, fields: string[]): string {
  switch (c.kind) {
    case "literal":
      return typing.show(c.type);
    case "none":
      return "null";
    case "some":
      return fields[0]!;
    case "variant":
      return fields.length > 0 ? `${typing.rec(c.variant).name}(${fields.join(", ")})` : typing.rec(c.variant).name;
    case "object": {
      // A field left out of an object pattern matches anything, so only the telling ones show.
      const shown = objectFields(typing, c.type).flatMap((f, i): string[] => (fields[i as usize] === "_" ? [] : [`${f.name}: ${fields[i as usize]}`]));
      return shown.length > 0 ? `{ ${shown.join(", ")} }` : "_";
    }
    default:
      return "_";
  }
}

// The message for a value no arm covers: the case to add, or the catch-all.
export function missing(typing: Mut<Typing>, example: string, type: Type): string {
  if (example === "_") return `this match doesn't cover every '${typing.show(type)}'; add 'case _ =>' for the rest`;
  return `this match doesn't cover ${example}; add 'case ${example} =>', or 'case _ =>' for the rest`;
}
