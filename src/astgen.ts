import { parse, type Stmt, type TypeMember, type TypeNode } from "./parser.ts";

// The Fish declarations of the `Ast` types, made from the parser's own AST types in
// `src/parser.ts`, so the tree macros see is the tree the parser builds. Each alias becomes
// `Ast` and its name, the four node categories `AstExpr`, `AstStmt`, `AstType` and
// `AstPattern`; a span's offsets are `i64`, a float's value `f64`, an integer's `i64` until
// big integers, and an absent part `null`.

const CATEGORIES: Record<string, string> = { Expr: "AstExpr", Stmt: "AstStmt", TypeNode: "AstType", Pattern: "AstPattern" };
// The parser's types that aren't part of the tree. A node's id is the compiler's own, so macros
// never see one.
const SKIPPED = new Set(["Span", "Id", "Cursor", "Parse"]);

type Field = { name: string; optional: boolean; type: string };
type Shape = Field[];

export function astDeclarations(src: string): string {
  const aliases = new Map<string, TypeNode>();
  for (const s of parse(src, { last: 0 })) {
    const t = s.kind === "export" ? s.body : s;
    if (t.kind === "typeAlias" && !SKIPPED.has(t.name)) aliases.set(t.name, t.type);
  }
  const named = (name: string) => CATEGORIES[name] ?? `Ast${name}`;
  const span: Shape = [{ name: "start", optional: false, type: "i64" }, { name: "end", optional: false, type: "i64" }];

  // A type as Fish source, inside a field.
  const typeText = (t: TypeNode): string => {
    switch (t.kind) {
      case "ref": {
        if (t.name === "string" || t.name === "boolean") return t.name;
        if (t.name === "undefined") return "null";
        // The parser's offsets and counts are `usize`, but macros see every integer as `i64`.
        if (t.name === "f64") return "f64";
        if (t.name === "bigint" || /^[iu](8|16|32|64|128|size)$/.test(t.name)) return "i64";
        if (t.name === "Extract") {
          const from = t.args[0]!;
          return shapesText(shapes(from.kind === "ref" && aliases.has(from.name) ? aliases.get(from.name)! : from).filter((s) => extracted(s, t.args[1]!)));
        }
        if (aliases.has(t.name)) return named(t.name);
        throw new Error(`the Ast generator has no Fish type for '${t.name}'`);
      }
      case "literal":
        return JSON.stringify((t.value as { value: string }).value);
      case "array": {
        const element = typeText(t.element);
        return t.element.kind === "union" ? `(${element})[]` : `${element}[]`;
      }
      case "union":
        return t.types.map((m) => typeText(m)).join(" | ");
      default:
        return shapesText(shapes(t));
    }
  };

  // The object shapes a type is the union of, with intersections merged and a union of kinds
  // split into one shape per kind.
  const shapes = (t: TypeNode): Shape[] => {
    if (t.kind === "ref" && t.name === "Span") return [span];
    if (t.kind === "ref" && t.name === "Id") return [[]];
    if (t.kind === "ref" && aliases.has(t.name) && !CATEGORIES[t.name]) return shapes(aliases.get(t.name)!);
    if (t.kind === "union") return t.types.flatMap(shapes);
    if (t.kind === "intersection") {
      return t.types.map(shapes).reduce((all, next) => all.flatMap((a) => next.map((b) => [...a.filter((f) => !b.some((g) => g.name === f.name)), ...b])));
    }
    if (t.kind !== "object") throw new Error(`the Ast generator can't read a '${t.kind === "ref" ? t.name : t.kind}' type as a node`);
    const kind = t.members.find((m) => m.kind === "property" && m.name === "kind");
    const kinds = kind && kind.kind === "property" && kind.type?.kind === "union" ? kind.type.types : [kind && kind.kind === "property" ? kind.type : undefined];
    return kinds.map((k) => {
      const tag = k && k.kind === "literal" ? (k.value as { value: string }).value : undefined;
      return t.members.map((m) => member(m, tag));
    });
  };

  const member = (m: TypeMember, kind: string | undefined): Field => {
    if (m.kind !== "property" || typeof m.name !== "string" || !m.type) throw new Error("the Ast generator reads only named fields");
    if (m.name === "kind" && kind !== undefined) return { name: "kind", optional: false, type: JSON.stringify(kind) };
    return { name: m.name, optional: m.optional, type: typeText(m.type) };
  };

  const extracted = (s: Shape, by: TypeNode): boolean => {
    const want = by.kind === "object" ? by.members.find((m) => m.kind === "property" && m.name === "kind") : undefined;
    const tag = want && want.kind === "property" && want.type?.kind === "literal" ? JSON.stringify((want.type.value as { value: string }).value) : undefined;
    return s.some((f) => f.name === "kind" && f.type === tag);
  };

  const shapeText = (s: Shape) => `{ ${s.map((f) => `${f.name}${f.optional ? "?" : ""}: ${f.type}`).join("; ")} }`;
  const shapesText = (all: Shape[]) => all.map(shapeText).join(" | ");

  const out: string[] = [];
  for (const [name, t] of aliases) {
    const nodeish = t.kind !== "union" || t.types.some((m) => m.kind !== "literal");
    out.push(`type ${named(name)} =`);
    if (!nodeish) out.push(`  ${typeText(t)};`);
    else if (t.kind === "union" && t.types.some((m) => m.kind === "ref" && m.name === "string")) out.push(`  ${typeText(t)};`);
    else for (const s of shapes(t)) out.push(`  | ${shapeText(s)}`);
    if (nodeish && !(t.kind === "union" && t.types.some((m) => m.kind === "ref" && m.name === "string"))) out[out.length - 1] += ";";
  }
  out.push("type Ast = AstStmt | AstExpr | AstType | AstPattern;");
  return out.join("\n") + "\n";
}

// `bun src/astgen.ts` writes the declarations into `src/ast.ts`.
if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const declarations = astDeclarations(readFileSync(new URL("./parser.ts", import.meta.url), "utf8"));
  const file = `// Generated from the parser's AST types by \`bun src/astgen.ts\`; a test fails when it is stale.\nexport const AST = String.raw\`\n${declarations}\`;\n`;
  writeFileSync(new URL("./ast.ts", import.meta.url), file);
}
