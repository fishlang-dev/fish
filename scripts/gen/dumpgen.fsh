// Writes `tests/selfhost/dump.ts`, which prints a parsed tree in full, from the parser's own AST
// types in `src/parser.ts`, so it prints every field of every node kind. The printer is plain
// enough to be valid TypeScript and valid Fish, so the parser built by fishc and run by Bun can
// print the same trees. `tests/selfhost_parser.test.ts` fails when the file is stale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "../../tests/compiler/diag.fsh";
import { parse, type Expr, type Stmt, type TypeNode } from "../../tests/compiler/parser.fsh";

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
  return readFileSync(join(import.meta.dir, "..", "..", "src", "parser.ts"), "utf8");
}

class Dumper {
  readonly nt: NodeTypes;
  unionIndex: Map<string, usize>;
  unionNames: string[];
  unionMembers: Ty[][];
  kindIndex: Map<string, usize>;
  kindLines: string[][];
  loops: usize;

  constructor(nt: NodeTypes) {
    this.nt = nt;
    this.unionIndex = new Map<string, usize>();
    this.unionNames = [];
    this.unionMembers = [];
    this.kindIndex = new Map<string, usize>();
    this.kindLines = [];
    this.loops = 0;
  }

  unionName(this: Mut<this>, members: Ref<Ty[]>): string throws Error {
    const key = this.nt.showAll(members, " | ");
    const at = this.unionIndex.get(key);
    if (at !== undefined) return this.unionNames[at]!;
    const name = `dumpUnion${this.unionNames.length}`;
    this.unionIndex.set(key, this.unionNames.length);
    this.unionNames.push(name);
    this.unionMembers.push(members.clone());
    return name;
  }

  // Statements printing `v`, of type `t`, under `label` at `indent`, both expressions.
  value(this: Mut<this>, t: Ref<Ty>, v: string, indent: string, label: string): string[] throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "json":
        return [`console.log(${indent} + ${label} + " " + JSON.stringify(${v}));`];
      case "bigint":
        return [`console.log(${indent} + ${label} + " " + \`\${${v}}n\`);`];
      case "plain":
        return [`console.log(${indent} + ${label} + " " + \`\${${v}}\`);`];
      case "node":
        return [`dump${f.name}(${indent}, ${label}, ${v});`];
      case "union":
        return [`${this.unionName(f.members)}(${indent}, ${label}, ${v});`];
      case "array": {
        this.loops += 1;
        const x = `x${this.loops}`;
        const inner = this.value(f.element, x, `${indent} + "  "`, `"-"`);
        return [`console.log(${indent} + ${label} + \` [\${${v}.length}]\`);`, `for (const ${x} of ${v}) {`, ...indented(inner, "  "), `}`];
      }
      case "option": {
        const inner = this.value(f.inner, `${v}!`, indent, label);
        return [`if (${v} === undefined) console.log(${indent} + ${label} + " undefined");`, `else {`, ...indented(inner, "  "), `}`];
      }
      case "object": {
        const inner = this.fields(f.fields, v, `${indent} + "  "`);
        return [`console.log(${indent} + ${label});`, ...inner];
      }
    }
    throw new Error("unreachable");
  }

  // Every field of `v` in order: those printed as text on one line, then the rest below it.
  fields(this: Mut<this>, all: Ref<Field[]>, v: string, indent: string): string[] throws Error {
    let out: string[] = [];
    for (const f of all) {
      if (f.optional) {
        const t: Ty = { kind: "union", types: [f.type.clone(), refTo("undefined")] };
        append(out, this.value(t, `${v}.${f.name}`, indent, JSON.stringify(f.name)));
      } else append(out, this.value(f.type, `${v}.${f.name}`, indent, JSON.stringify(f.name)));
    }
    return out;
  }

  // A switch over the node kinds of `all`, each kind printed by a function of its own, which
  // keeps each printer's stack frame small enough to recurse through deep trees.
  cases(this: Mut<this>, all: Ref<Shape[]>, v: string): string[] throws Error {
    let out: string[] = [];
    let seen = new Set<string>();
    for (const s of all) {
      const kind = s.kind;
      if (kind === undefined) {
        const inner = this.fields(s.fields, v, `indent + "  "`);
        return [`console.log(indent + label + " -");`, ...inner];
      }
      if (seen.has(kind)) continue;
      seen.add(kind);
      const owner = s.owner ?? "undefined";
      const name = `dump${owner}_${kind}`;
      if (!this.kindIndex.has(name)) {
        const at = this.kindLines.length;
        this.kindIndex.set(name, at);
        this.kindLines.push([]);
        const inner = this.fields(s.fields, "n", `indent + "  "`);
        this.kindLines[at] = fn(name, `Extract<${owner}, { kind: ${s.kindType ?? "undefined"} }>`, [`console.log(indent + label + " " + ${JSON.stringify(kind)});`, ...inner]);
      }
      append(out, [`  case ${JSON.stringify(kind)}:`, `    ${name}(indent, label, ${v});`, "    break;"]);
    }
    return [`switch (${v}.kind) {`, ...out, `}`];
  }

  source(this: Mut<this>): string throws Error {
    let out: string[] = [];
    for (let i: usize = 0; i < this.nt.names.length; i++) {
      const name = this.nt.names[i]!;
      if (!this.nt.isNode(name)) continue;
      const all = this.nt.shapes(this.nt.types[i]!).map((s): Shape => ({ kind: s.kind, kindType: s.kindType, owner: s.owner ?? name, fields: s.fields.clone() }));
      append(out, fn(`dump${name}`, name, this.cases(all, "n")));
    }
    // Unions found while writing the node printers, and those found while writing these.
    for (let i: usize = 0; i < this.unionNames.length; i++) {
      const name = this.unionNames[i]!;
      const members = this.unionMembers[i]!.clone();
      let body: string[] = [];
      let rest = this.nt.expandAll(members);
      if (rest.some((m) => ref(m, "string"))) {
        append(body, [`if (typeof n === "string") {`, `  console.log(indent + label + " " + JSON.stringify(n));`, `  return;`, `}`]);
        rest = rest.filter((m) => !ref(m, "string"));
      }
      const array = rest.findIndex((m) => m.kind === "array");
      if (array >= 0) {
        const inner = this.value(rest[array as usize]!, "n", "indent", "label");
        append(body, [`if (Array.isArray(n)) {`, ...indented(inner, "  "), `  return;`, `}`]);
        rest.splice(array, 1);
      }
      // One node type left is that type's printer's; several are told apart by kind here.
      const only = rest.length === 1 && rest[0]!.kind === "ref" ? this.onlyNode(rest[0]!) : undefined;
      if (only !== undefined) body.push(`dump${only}(indent, label, n);`);
      else {
        let shapes: Shape[] = [];
        for (const m of rest) {
          let some = this.nt.shapes(m);
          while (some.length > 0) shapes.push(some.shift()!);
        }
        append(body, this.cases(shapes, "n"));
      }
      append(out, fn(name, this.nt.showAll(members, " | "), body));
    }
    for (const lines of this.kindLines) append(out, lines);
    let imports: string[] = [];
    for (const name of this.nt.names) if (out.some((l) => hasWord(l, name))) imports.push(name);
    const all = [
      `// Generated from the parser's AST types by \`fishc run scripts/dumpgen.fsh\`; a test fails when it is stale.`,
      `import type { ${imports.join(", ")} } from "../../src/parser.ts";`,
      ``,
      ...out,
    ];
    return all.join("\n").trimEnd() + "\n";
  }

  onlyNode(m: Ref<Ty>): string | undefined {
    return m.kind === "ref" && this.nt.isNode(m.name) ? m.name : undefined;
  }
}

function fn(name: string, type: string, body: Ref<string[]>): string[] {
  return [`export function ${name}(indent: string, label: string, n: Ref<${type}>): void {`, ...indented(body, "  "), `}`, ``];
}

export function dumperSource(source: string): string throws Error | CompileError {
  let d = new Dumper(nodeTypes(source));
  return d.source();
}
