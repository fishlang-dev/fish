// The parser's own AST types read from `src/parser.fsh`, as the generators of the tree walkers
// and the macro reader read them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "../../src/diag.fsh";
import { parse, type Expr, type Stmt, type TypeNode } from "../../src/parser.fsh";

// A type as the generators read it: the parser's `TypeNode` with only what they look at, so it
// can be built, copied and compared freely. A literal keeps its value as JSON, and its text when
// it is a string; an object keeps every member, `kind` included, as a named field.
export type Ty =
  | { kind: "ref"; name: string; args: Ty[] }
  | { kind: "literal"; json: string; text: string; str: boolean; bool: boolean }
  | { kind: "array"; element: Ty }
  | { kind: "object"; fields: Field[] }
  | { kind: "union"; types: Ty[] }
  | { kind: "intersection"; types: Ty[] }
  | { kind: "other"; name: string };

export type Field = { name: string; optional: boolean; type: Ty };

// One object type a node may be: its `kind`, when it has one, the type its `kind` is written as,
// the alias it belongs to, and its fields in order.
export type Shape = { kind: string | undefined; kindType: string | undefined; owner: string | undefined; fields: Field[] };

// How a value of a type is printed.
export type Form =
  | { kind: "json" }
  | { kind: "plain" }
  | { kind: "bigint" }
  | { kind: "node"; name: string }
  | { kind: "array"; element: Ty }
  | { kind: "option"; inner: Ty }
  | { kind: "union"; members: Ty[] }
  | { kind: "object"; fields: Field[] };

// The parser's types that aren't part of a tree.
const SKIPPED = ["Span", "Id", "Parse"];

function toTy(t: Ref<TypeNode>): Ty throws Error {
  switch (t.kind) {
    case "ref": {
      let args: Ty[] = [];
      for (const a of t.args) args.push(toTy(a));
      return { kind: "ref", name: t.name, args };
    }
    case "literal": {
      const v: Ref<Expr> = t.value;
      if (v.kind === "string") return { kind: "literal", json: JSON.stringify(v.value), text: v.value, str: true, bool: false };
      if (v.kind === "bool") return { kind: "literal", json: JSON.stringify(v.value), text: "", str: false, bool: true };
      throw new Error(`the generators can't read a '${v.kind}' literal type`);
    }
    case "array":
      return { kind: "array", element: toTy(t.element) };
    case "object": {
      let fields: Field[] = [];
      for (const m of t.members) {
        if (m.kind !== "property" || typeof m.name !== "string" || m.type === undefined) throw new Error("the dumper reads only named fields");
        fields.push({ name: m.name, optional: m.optional, type: toTy(m.type!) });
      }
      return { kind: "object", fields };
    }
    case "union": {
      let types: Ty[] = [];
      for (const m of t.types) types.push(toTy(m));
      return { kind: "union", types };
    }
    case "intersection": {
      let types: Ty[] = [];
      for (const m of t.types) types.push(toTy(m));
      return { kind: "intersection", types };
    }
    default:
      return { kind: "other", name: t.kind };
  }
}

export function refTo(name: string): Ty {
  return { kind: "ref", name, args: [] };
}

export function field(name: string, type: string): Field {
  return { name, optional: false, type: refTo(type) };
}

export function ref(t: Ref<Ty>, name: string): boolean {
  return t.kind === "ref" && t.name === name;
}

// Whether `name` stands as a whole word in `line`, as `\b<name>\b` matches.
export function hasWord(line: string, name: string): boolean {
  let from: usize = 0;
  while (true) {
    const at = line.indexOf(name, from as i64);
    if (at < 0) return false;
    const start = at as usize;
    const end = start + name.length;
    const before = start === 0 ? "" : line.slice((start as i64) - 1, start as i64);
    const after = end >= line.length ? "" : line.slice(end as i64, (end as i64) + 1);
    if (!/^\w$/.test(before) && !/^\w$/.test(after)) return true;
    from = start + 1;
  }
}

// Each line of `lines` with `pad` before it.
export function indented(lines: Ref<string[]>, pad: string): string[] {
  return lines.map((l) => `${pad}${l}`);
}

export function append(out: Mut<string[]>, more: Ref<string[]>): void {
  for (const l of more) out.push(l);
}

// The parser's AST types read from its source: the aliases a tree is made of, in order, the object
// shapes each is the union of, and how a value of each type is held.
export class NodeTypes {
  readonly names: string[];
  readonly types: Ty[];
  readonly index: Map<string, usize>;

  constructor(names: string[], types: Ty[], index: Map<string, usize>) {
    this.names = names;
    this.types = types;
    this.index = index;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  at(name: string): usize {
    return this.index.get(name)!;
  }

  // Literal strings, and aliases of nothing else, print as JSON.
  isWord(t: Ref<Ty>): boolean {
    if (t.kind === "literal") return t.str;
    if (t.kind === "union") {
      for (const m of t.types) if (!this.isWord(m)) return false;
      return true;
    }
    if (t.kind === "ref" && this.has(t.name)) return this.isWord(this.types[this.at(t.name)]!);
    return false;
  }

  // A string or a node, as `PropertyName` is.
  membersOf(t: Ref<Ty>): Ty[] {
    if (t.kind === "union") return t.types.clone();
    return [t.clone()];
  }

  isNode(name: string): boolean {
    if (!this.has(name)) return false;
    const t: Ref<Ty> = this.types[this.at(name)]!;
    if (this.isWord(t)) return false;
    if (t.kind === "union") {
      for (const m of t.types) if (ref(m, "string")) return false;
      return true;
    }
    return !ref(t, "string");
  }

  // A union's member, with an alias of a union that isn't a node type, as `PropertyName`, opened.
  expand(m: Ref<Ty>): Ty[] {
    if (m.kind === "ref" && this.has(m.name) && !this.isNode(m.name) && !this.isWord(m)) return this.membersOf(this.types[this.at(m.name)]!);
    return [m.clone()];
  }

  expandAll(members: Ref<Ty[]>): Ty[] {
    let out: Ty[] = [];
    for (const m of members) {
      let some = this.expand(m);
      while (some.length > 0) out.push(some.shift()!);
    }
    return out;
  }

  kindOf(t: Ref<Ty>): string | undefined {
    if (t.kind !== "object") return undefined;
    for (const f of t.fields) {
      if (f.name !== "kind") continue;
      const k: Ref<Ty> = f.type;
      return k.kind === "literal" ? k.text : undefined;
    }
    return undefined;
  }

  shapes(t: Ref<Ty>): Shape[] throws Error {
    if (ref(t, "Span")) return [{ kind: undefined, kindType: undefined, owner: undefined, fields: [field("start", "usize"), field("end", "usize")] }];
    if (ref(t, "Id")) return [{ kind: undefined, kindType: undefined, owner: undefined, fields: [field("id", "usize")] }];
    if (t.kind === "ref" && t.name === "Extract") {
      const want = this.kindOf(t.args[1]!);
      return this.shapes(t.args[0]!).filter((s) => s.kind === want);
    }
    if (t.kind === "ref" && this.has(t.name)) {
      const name = t.name;
      return this.shapes(this.types[this.at(name)]!).map((s): Shape => ({ kind: s.kind, kindType: s.kindType, owner: s.owner ?? name, fields: s.fields.clone() }));
    }
    if (t.kind === "union") {
      let all: Shape[] = [];
      for (const m of t.types) {
        let some = this.shapes(m);
        while (some.length > 0) all.push(some.shift()!);
      }
      return all;
    }
    if (t.kind === "intersection") {
      let all: Shape[] = [];
      let first = true;
      for (const m of t.types) {
        const next = this.shapes(m);
        if (first) {
          all = next;
          first = false;
          continue;
        }
        let merged: Shape[] = [];
        for (const a of all) {
          for (const b of next) {
            let fields: Field[] = a.fields.filter((f) => !b.fields.some((g) => g.name === f.name));
            for (const f of b.fields) fields.push(f.clone());
            // A node belongs to the alias its `kind` was written in, as `ClassNode & { kind: "class" }`
            // is an `Expr` and not a `ClassNode`.
            merged.push({ kind: a.kind ?? b.kind, kindType: a.kindType ?? b.kindType, owner: a.kind !== undefined ? a.owner : b.owner, fields });
          }
        }
        all = merged;
      }
      return all;
    }
    if (t.kind !== "object") throw new Error(`the dumper can't read a '${t.kind === "ref" ? t.name : t.kind === "other" ? t.name : t.kind}' type as a node`);
    let kindType: string | undefined = undefined;
    let kinds: (string | undefined)[] = [undefined];
    for (const f of t.fields) {
      if (f.name !== "kind") continue;
      kindType = this.show(f.type);
      const k: Ref<Ty> = f.type;
      kinds = [];
      if (k.kind === "union") {
        for (const m of k.types) kinds.push(m.kind === "literal" ? m.text : undefined);
      } else kinds.push(k.kind === "literal" ? k.text : undefined);
      break;
    }
    const fields = t.fields.filter((f) => f.name !== "kind");
    return kinds.map((k): Shape => ({ kind: k, kindType, owner: undefined, fields: fields.clone() }));
  }

  formOf(t: Ref<Ty>): Form throws Error {
    if (this.isWord(t)) return { kind: "json" };
    switch (t.kind) {
      case "literal":
        return { kind: "plain" };
      case "array":
        return { kind: "array", element: t.element.clone() };
      case "object":
        return { kind: "object", fields: t.fields.clone() };
      case "union": {
        const rest = t.types.filter((m) => !ref(m, "undefined"));
        if (rest.length < t.types.length) {
          if (rest.length === 1) return { kind: "option", inner: rest[0]!.clone() };
          return { kind: "option", inner: { kind: "union", types: rest } };
        }
        return { kind: "union", members: t.types.clone() };
      }
      case "ref": {
        if (t.name === "string") return { kind: "json" };
        if (t.name === "bigint") return { kind: "bigint" };
        if (t.name === "boolean" || t.name === "f64" || /^[iu](8|16|32|64|128|size)$/.test(t.name)) return { kind: "plain" };
        if (t.name === "Extract" || (this.has(t.name) && !this.isNode(t.name))) return { kind: "union", members: [t.clone()] };
        if (this.isNode(t.name)) return { kind: "node", name: t.name };
        throw new Error(`the dumper has no form for '${t.name}'`);
      }
      default:
        throw new Error(`the dumper has no form for a '${t.kind === "other" ? t.name : t.kind}' type`);
    }
  }

  show(t: Ref<Ty>): string throws Error {
    switch (t.kind) {
      case "ref":
        return t.args.length > 0 ? `${t.name}<${this.showAll(t.args, ", ")}>` : t.name;
      case "array":
        return t.element.kind === "union" ? `(${this.show(t.element)})[]` : `${this.show(t.element)}[]`;
      case "union":
        return this.showAll(t.types, " | ");
      case "literal":
        return t.json;
      case "object": {
        let parts: string[] = [];
        for (const f of t.fields) parts.push(`${f.name}${f.optional ? "?" : ""}: ${this.show(f.type)}`);
        return `{ ${parts.join("; ")} }`;
      }
      default:
        throw new Error(`the dumper can't write a '${t.kind === "other" ? t.name : t.kind}' type`);
    }
  }

  showAll(ts: Ref<Ty[]>, separator: string): string throws Error {
    let parts: string[] = [];
    for (const t of ts) parts.push(this.show(t));
    return parts.join(separator);
  }
}

function aliasOf(s: Ref<Stmt>, names: Mut<string[]>, types: Mut<Ty[]>, index: Mut<Map<string, usize>>): void throws Error {
  if (s.kind === "export") {
    aliasOf(s.body, names, types, index);
    return;
  }
  if (s.kind !== "typeAlias" || SKIPPED.includes(s.name)) return;
  const ty = toTy(s.type);
  const at = index.get(s.name);
  if (at !== undefined) {
    types[at] = ty;
    return;
  }
  index.set(s.name, names.length);
  names.push(s.name);
  types.push(ty);
}

export function nodeTypes(parserSource: string): NodeTypes throws Error | CompileError {
  let names: string[] = [];
  let types: Ty[] = [];
  let index = new Map<string, usize>();
  const program = parse(parserSource, { last: 0 });
  for (const s of program) aliasOf(s, names, types, index);
  return new NodeTypes(names, types, index);
}

export function parserSource(): string throws IoError {
  return readFileSync(join(import.meta.dir, "..", "..", "src", "parser.fsh"), "utf8");
}
