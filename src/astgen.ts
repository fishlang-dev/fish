import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "./diag.ts";
import { parse, type Expr, type TypeMember, type TypeNode } from "./parser.ts";

// The Fish declarations of the `Ast` types, made from the parser's own AST types in
// `src/parser.ts`, so the tree macros see is the tree the parser builds. Each alias becomes
// `Ast` and its name, the four node categories `AstExpr`, `AstStmt`, `AstType` and
// `AstPattern`; a span's offsets are `i64`, a float's value `f64`, an integer's `i64` until
// big integers, and an absent part `null`.

const CATEGORIES = new Map<string, string>([["Expr", "AstExpr"], ["Stmt", "AstStmt"], ["TypeNode", "AstType"], ["Pattern", "AstPattern"]]);
// The parser's types that aren't part of the tree. A node's id is the compiler's own, so macros
// never see one.
const SKIPPED = new Set(["Span", "Id", "Cursor", "Parse"]);
// Fields the compiler sets on nodes for its own passes, which a macro must not write: an
// overload's narrowing downcast is made only by overload lowering.
const INTERNAL = new Set(["narrows"]);

type Field = { name: string; optional: boolean; type: string };
type Shape = Field[];

const SPAN: Shape = [{ name: "start", optional: false, type: "i64" }, { name: "end", optional: false, type: "i64" }];

function named(name: string): string {
  const category = CATEGORIES.get(name);
  return category !== undefined ? category : `Ast${name}`;
}

// A literal type's value as Fish source.
/** @throws {Error} */
function literalText(v: Ref<Expr>): string {
  if (v.kind === "string") return JSON.stringify(v.value);
  if (v.kind === "bool") return JSON.stringify(v.value);
  throw new Error(`the Ast generator has no Fish type for a '${v.kind}' literal`);
}

// A literal type's string, as a `kind` field's type names a node's kind.
function literalTag(t: Ref<TypeNode>): string | undefined {
  return t.kind === "literal" && t.value.kind === "string" ? t.value.value : undefined;
}

// The kinds the first `kind` property names: one for each member of a union of literals, or one
// for its literal, or none at all, written `undefined`.
function kindTags(members: Ref<TypeMember[]>): (string | undefined)[] {
  for (const m of members) {
    if (m.kind !== "property" || m.name !== "kind") continue;
    const t: Ref<TypeNode | undefined> = m.type;
    if (t === undefined) return [undefined];
    if (t.kind !== "union") return [literalTag(t)];
    let tags: (string | undefined)[] = [];
    for (const k of t.types) tags.push(literalTag(k));
    return tags;
  }
  return [undefined];
}

// The kind the first `kind` property's literal type names.
function kindTag(members: Ref<TypeMember[]>): string | undefined {
  for (const m of members) {
    if (m.kind !== "property" || m.name !== "kind") continue;
    const t: Ref<TypeNode | undefined> = m.type;
    return t !== undefined ? literalTag(t) : undefined;
  }
  return undefined;
}

function shapeText(s: Ref<Shape>): string {
  return `{ ${s.map((f) => `${f.name}${f.optional ? "?" : ""}: ${f.type}`).join("; ")} }`;
}

function shapesText(all: Ref<Shape[]>): string {
  return all.map((s) => shapeText(s)).join(" | ");
}

// The parser's type aliases, read into Fish source.
class AstReader {
  readonly aliases: Map<string, TypeNode>;

  constructor(aliases: Map<string, TypeNode>) {
    this.aliases = aliases;
  }

  // A type as Fish source, inside a field.
  /** @throws {Error} */
  typeText(t: Ref<TypeNode>): string {
    switch (t.kind) {
      case "ref": {
        if (t.name === "string" || t.name === "boolean") return t.name;
        if (t.name === "undefined") return "null";
        // The parser's offsets and counts are `usize`, but macros see every integer as `i64`.
        if (t.name === "f64") return "f64";
        if (t.name === "bigint" || /^[iu](8|16|32|64|128|size)$/.test(t.name)) return "i64";
        if (t.name === "Extract") {
          const from: Ref<TypeNode> = t.args[0]!;
          let all: Shape[] = [];
          const alias = from.kind === "ref" ? this.aliases.get(from.name) : undefined;
          if (alias !== undefined) all = this.shapes(alias);
          else all = this.shapes(from);
          const by: Ref<TypeNode> = t.args[1]!;
          return shapesText(all.filter((s) => this.extracted(s, by)));
        }
        if (this.aliases.has(t.name)) return named(t.name);
        throw new Error(`the Ast generator has no Fish type for '${t.name}'`);
      }
      case "literal":
        return literalText(t.value);
      case "array": {
        const element = this.typeText(t.element);
        return t.element.kind === "union" ? `(${element})[]` : `${element}[]`;
      }
      case "union": {
        let parts: string[] = [];
        for (const m of t.types) parts.push(this.typeText(m));
        return parts.join(" | ");
      }
      default:
        return shapesText(this.shapes(t));
    }
  }

  // The object shapes a type is the union of, with intersections merged and a union of kinds
  // split into one shape per kind.
  /** @throws {Error} */
  shapes(t: Ref<TypeNode>): Shape[] {
    if (t.kind === "ref" && t.name === "Span") return [[...SPAN]];
    if (t.kind === "ref" && t.name === "Id") return [[]];
    if (t.kind === "ref" && !CATEGORIES.has(t.name)) {
      const alias = this.aliases.get(t.name);
      if (alias !== undefined) return this.shapes(alias);
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
      for (const [i, m] of t.types.entries()) {
        const next = this.shapes(m);
        if (i === 0) {
          all = next;
          continue;
        }
        let merged: Shape[] = [];
        for (const a of all) for (const b of next) merged.push([...a.filter((f) => !b.some((g) => g.name === f.name)), ...b]);
        all = merged;
      }
      return all;
    }
    if (t.kind !== "object") throw new Error(`the Ast generator can't read a '${t.kind === "ref" ? t.name : t.kind}' type as a node`);
    let all: Shape[] = [];
    for (const tag of kindTags(t.members)) {
      let fields: Shape = [];
      for (const m of t.members) {
        if (m.kind === "property" && typeof m.name === "string" && INTERNAL.has(m.name)) continue;
        fields.push(this.member(m, tag));
      }
      all.push(fields);
    }
    return all;
  }

  /** @throws {Error} */
  member(m: Ref<TypeMember>, kind: string | undefined): Field {
    if (m.kind !== "property" || typeof m.name !== "string" || m.type === undefined) throw new Error("the Ast generator reads only named fields");
    if (m.name === "kind" && kind !== undefined) return { name: "kind", optional: false, type: JSON.stringify(kind) };
    return { name: m.name, optional: m.optional, type: this.typeText(m.type) };
  }

  extracted(s: Ref<Shape>, by: Ref<TypeNode>): boolean {
    const want = by.kind === "object" ? kindTag(by.members) : undefined;
    const tag = want !== undefined ? JSON.stringify(want) : undefined;
    return s.some((f) => f.name === "kind" && f.type === tag);
  }
}

/** @throws {Error | CompileError} */
export function astDeclarations(src: string): string {
  let aliases = new Map<string, TypeNode>();
  let program = parse(src, { last: 0 });
  while (program.length > 0) {
    const s = program.shift()!;
    const t = s.kind === "export" ? s.body : s;
    if (t.kind === "typeAlias" && !SKIPPED.has(t.name)) aliases.set(t.name, t.type);
  }
  const g = new AstReader(aliases);
  let out: string[] = [];
  for (const [name, t] of g.aliases) {
    const nodeish = t.kind !== "union" || t.types.some((m) => m.kind !== "literal");
    const stringy = t.kind === "union" && t.types.some((m) => m.kind === "ref" && m.name === "string");
    out.push(`type ${named(name)} =`);
    if (!nodeish || stringy) out.push(`  ${g.typeText(t)};`);
    else {
      let lines: string[] = [];
      for (const s of g.shapes(t)) lines.push(`  | ${shapeText(s)}`);
      if (lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1]!};`;
      else out[out.length - 1] = `${out[out.length - 1]!};`;
      for (const l of lines) out.push(l);
    }
  }
  out.push("type Ast = AstStmt | AstExpr | AstType | AstPattern;");
  return out.join("\n") + "\n";
}

// `bun src/astgen.ts` writes the declarations into `src/ast.ts`.
/** @throws {Error | IoError | CompileError} */
function main() {
  const declarations = astDeclarations(readFileSync(join(import.meta.dir, "parser.ts"), "utf8"));
  const file = `// Generated from the parser's AST types by \`bun src/astgen.ts\`; a test fails when it is stale.\nexport const AST = String.raw\`\n${declarations}\`;\n`;
  writeFileSync(join(import.meta.dir, "ast.ts"), file);
}

if (import.meta.main) main();
