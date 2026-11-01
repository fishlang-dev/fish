// Writes `tests/selfhost/dump.ts`, which prints a parsed tree in full, from the parser's own AST
// types in `src/parser.ts`, so it prints every field of every node kind. The printer is plain
// enough to be valid TypeScript and valid Fish, so the parser built by fishc and run by Bun can
// print the same trees. `tests/selfhost_parser.test.ts` fails when the file is stale.
import { parse, type TypeMember, type TypeNode } from "../src/parser.ts";

// The parser's types that aren't part of a tree.
const SKIPPED = new Set(["Span", "Id", "Parse"]);

type Field = { name: string; optional: boolean; type: TypeNode };
// One object type a node may be: its `kind`, when it has one, the type its `kind` is written as,
// the alias it belongs to, and its fields in order.
type Shape = { kind: string | undefined; kindType?: string; owner?: string; fields: Field[] };

// How a value of a type is printed.
type Form =
  | { form: "json" | "plain" | "bigint" }
  | { form: "node"; name: string }
  | { form: "array"; element: TypeNode }
  | { form: "option"; inner: TypeNode }
  | { form: "union"; members: TypeNode[] }
  | { form: "object"; fields: Field[] };

// The parser's AST types read from its source: the aliases a tree is made of, the object shapes
// each is the union of, and how a value of each type is held.
export function nodeTypes(parserSource: string) {
  const aliases = new Map<string, TypeNode>();
  for (const s of parse(parserSource, { last: 0 })) {
    const t = s.kind === "export" ? s.body : s;
    if (t.kind === "typeAlias" && !SKIPPED.has(t.name)) aliases.set(t.name, t.type);
  }
  const ref = (t: TypeNode, name: string) => t.kind === "ref" && t.name === name;
  const literalString = (t: TypeNode) => t.kind === "literal" && t.value.kind === "string";
  // Literal strings, and aliases of nothing else, print as JSON.
  const isWord = (t: TypeNode): boolean => literalString(t) || (t.kind === "union" && t.types.every(isWord)) || (t.kind === "ref" && aliases.has(t.name) && isWord(aliases.get(t.name)!));
  // A string or a node, as `PropertyName` is.
  const membersOf = (t: TypeNode | undefined): TypeNode[] => (t?.kind === "union" ? t.types : t ? [t] : []);
  const isNode = (name: string) => aliases.has(name) && !isWord(aliases.get(name)!) && !membersOf(aliases.get(name)).some((m) => ref(m, "string"));

  const shapes = (t: TypeNode): Shape[] => {
    if (ref(t, "Span")) return [{ kind: undefined, fields: [field("start", "usize"), field("end", "usize")] }];
    if (ref(t, "Id")) return [{ kind: undefined, fields: [field("id", "usize")] }];
    if (t.kind === "ref" && t.name === "Extract") return shapes(t.args[0]!).filter((s) => s.kind === kindOf(t.args[1]!));
    if (t.kind === "ref" && aliases.has(t.name)) return shapes(aliases.get(t.name)!).map((s) => ({ ...s, owner: s.owner ?? t.name }));
    if (t.kind === "union") return t.types.flatMap(shapes);
    if (t.kind === "intersection") {
      return t.types.map(shapes).reduce((all, next) => all.flatMap((a) => next.map((b) => ({
        kind: a.kind ?? b.kind,
        kindType: a.kindType ?? b.kindType,
        // A node belongs to the alias its `kind` was written in, as `ClassNode & { kind: "class" }`
        // is an `Expr` and not a `ClassNode`.
        owner: a.kind !== undefined ? a.owner : b.owner,
        fields: [...a.fields.filter((f) => !b.fields.some((g) => g.name === f.name)), ...b.fields],
      }))));
    }
    if (t.kind !== "object") throw new Error(`the dumper can't read a '${t.kind === "ref" ? t.name : t.kind}' type as a node`);
    const kind = t.members.find((m) => m.kind === "property" && m.name === "kind");
    const kinds = kind?.kind === "property" && kind.type?.kind === "union" ? kind.type.types : [kind?.kind === "property" ? kind.type : undefined];
    return kinds.map((k) => ({
      kind: k?.kind === "literal" ? (k.value as { value: string }).value : undefined,
      kindType: kind?.kind === "property" && kind.type ? show(kind.type) : undefined,
      fields: t.members.filter((m) => !(m.kind === "property" && m.name === "kind")).map(member),
    }));
  };
  const field = (name: string, type: string): Field => ({ name, optional: false, type: { kind: "ref", name: type, args: [], start: 0, end: 0, id: 0 } });
  const member = (m: TypeMember): Field => {
    if (m.kind !== "property" || typeof m.name !== "string" || !m.type) throw new Error("the dumper reads only named fields");
    return { name: m.name, optional: m.optional, type: m.type };
  };
  const kindOf = (t: TypeNode): string | undefined => {
    const k = t.kind === "object" ? t.members.find((m) => m.kind === "property" && m.name === "kind") : undefined;
    return k?.kind === "property" && k.type?.kind === "literal" ? (k.type.value as { value: string }).value : undefined;
  };

  const formOf = (t: TypeNode): Form => {
    if (isWord(t)) return { form: "json" };
    if (t.kind === "literal") return { form: "plain" };
    if (t.kind === "array") return { form: "array", element: t.element };
    if (t.kind === "object") return { form: "object", fields: t.members.map(member) };
    if (t.kind === "union") {
      const rest = t.types.filter((m) => !ref(m, "undefined"));
      if (rest.length < t.types.length) return { form: "option", inner: rest.length === 1 ? rest[0]! : { ...t, types: rest } };
      return { form: "union", members: t.types };
    }
    if (t.kind !== "ref") throw new Error(`the dumper has no form for a '${t.kind}' type`);
    if (t.name === "string") return { form: "json" };
    if (t.name === "bigint") return { form: "bigint" };
    if (t.name === "boolean" || t.name === "f64" || /^[iu](8|16|32|64|128|size)$/.test(t.name)) return { form: "plain" };
    if (t.name === "Extract" || (aliases.has(t.name) && !isNode(t.name))) return { form: "union", members: [t] };
    if (isNode(t.name)) return { form: "node", name: t.name };
    throw new Error(`the dumper has no form for '${t.name}'`);
  };
  const show = (t: TypeNode): string => {
    if (t.kind === "ref") return t.args.length ? `${t.name}<${t.args.map(show).join(", ")}>` : t.name;
    if (t.kind === "array") return `${t.element.kind === "union" ? `(${show(t.element)})` : show(t.element)}[]`;
    if (t.kind === "union") return t.types.map(show).join(" | ");
    if (t.kind === "literal") return JSON.stringify((t.value as { value: unknown }).value);
    if (t.kind === "object") return `{ ${t.members.map((m) => { const f = member(m); return `${f.name}${f.optional ? "?" : ""}: ${show(f.type)}`; }).join("; ")} }`;
    throw new Error(`the dumper can't write a '${t.kind}' type`);
  };

  return { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show, field };
}

export function dumperSource(parserSource: string): string {
  const { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show, field } = nodeTypes(parserSource);
  const text = (f: Form, v: string) => (f.form === "json" ? `JSON.stringify(${v})` : f.form === "bigint" ? `\`\${${v}}n\`` : `\`\${${v}}\``);

  const unions = new Map<string, { name: string; members: TypeNode[] }>();
  const unionName = (members: TypeNode[]) => {
    const key = members.map(show).join(" | ");
    if (!unions.has(key)) unions.set(key, { name: `dumpUnion${unions.size}`, members });
    return unions.get(key)!.name;
  };
  let loops = 0;
  // Statements printing `v`, of type `t`, under `label` at `indent`, both expressions.
  const value = (t: TypeNode, v: string, indent: string, label: string): string[] => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
      case "plain":
      case "bigint":
        return [`console.log(${indent} + ${label} + " " + ${text(f, v)});`];
      case "node":
        return [`dump${f.name}(${indent}, ${label}, ${v});`];
      case "union":
        return [`${unionName(f.members)}(${indent}, ${label}, ${v});`];
      case "array": {
        const x = `x${++loops}`;
        return [
          `console.log(${indent} + ${label} + \` [\${${v}.length}]\`);`,
          `for (const ${x} of ${v}) {`,
          ...value(f.element, x, `${indent} + "  "`, `"-"`).map((l) => `  ${l}`),
          `}`,
        ];
      }
      case "option":
        return [
          `if (${v} === undefined) console.log(${indent} + ${label} + " undefined");`,
          `else {`,
          ...value(f.inner, `${v}!`, indent, label).map((l) => `  ${l}`),
          `}`,
        ];
      case "object":
        return [`console.log(${indent} + ${label});`, ...fields(f.fields, v, `${indent} + "  "`)];
    }
  };
  // Every field of `v` in order: those printed as text on one line, then the rest below it.
  const fields = (all: Field[], v: string, indent: string): string[] =>
    all.flatMap((f) => (f.optional ? value({ kind: "union", types: [f.type, field("", "undefined").type], start: 0, end: 0, id: 0 }, `${v}.${f.name}`, indent, JSON.stringify(f.name)) : value(f.type, `${v}.${f.name}`, indent, JSON.stringify(f.name))));
  // A switch over the node kinds of `all`, each kind printed by a function of its own, which
  // keeps each printer's stack frame small enough to recurse through deep trees.
  const kinds = new Map<string, string[]>();
  const cases = (all: Shape[], v: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined) return [`console.log(indent + label + " -");`, ...fields(s.fields, v, `indent + "  "`)];
      if (seen.has(s.kind)) continue;
      seen.add(s.kind);
      const name = `dump${s.owner}_${s.kind}`;
      if (!kinds.has(name)) {
        kinds.set(name, []);
        kinds.set(name, fn(name, `Extract<${s.owner}, { kind: ${s.kindType} }>`, [`console.log(indent + label + " " + ${JSON.stringify(s.kind)});`, ...fields(s.fields, "n", `indent + "  "`)]));
      }
      out.push(`  case ${JSON.stringify(s.kind)}:`, `    ${name}(indent, label, ${v});`, "    break;");
    }
    return [`switch (${v}.kind) {`, ...out, `}`];
  };
  const fn = (name: string, type: string, body: string[]) => [
    `export function ${name}(indent: string, label: string, n: Ref<${type}>): void {`,
    ...body.map((l) => `  ${l}`),
    `}`,
    ``,
  ];

  const out: string[] = [];
  for (const [name, t] of aliases) if (isNode(name)) out.push(...fn(`dump${name}`, name, cases(shapes(t).map((s) => ({ ...s, owner: s.owner ?? name })), "n")));
  // Unions found while writing the node printers, and those found while writing these.
  for (let i = 0; i < unions.size; i++) {
    const [, { name, members }] = [...unions][i]!;
    const body: string[] = [];
    let rest = members.flatMap((m) => (m.kind === "ref" && aliases.has(m.name) && !isNode(m.name) && !isWord(m) ? membersOf(aliases.get(m.name)) : [m]));
    if (rest.some((m) => ref(m, "string"))) {
      body.push(`if (typeof n === "string") {`, `  console.log(indent + label + " " + JSON.stringify(n));`, `  return;`, `}`);
      rest = rest.filter((m) => !ref(m, "string"));
    }
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (Array.isArray(n)) {`, ...value(array, "n", "indent", "label").map((l) => `  ${l}`), `  return;`, `}`);
      rest = rest.filter((m) => m !== array);
    }
    // One node type left is that type's printer's; several are told apart by kind here.
    const only = rest.length === 1 ? rest[0]! : undefined;
    if (only?.kind === "ref" && isNode(only.name)) body.push(`dump${only.name}(indent, label, n);`);
    else body.push(...cases(rest.flatMap(shapes), "n"));
    out.push(...fn(name, members.map(show).join(" | "), body));
  }
  for (const lines of kinds.values()) out.push(...lines);
  const imports = [...aliases.keys()].filter((name) => out.some((l) => new RegExp(`\\b${name}\\b`).test(l)));
  return [
    `// Generated from the parser's AST types by \`bun scripts/dumpgen.ts\`; a test fails when it is stale.`,
    `import type { ${imports.join(", ")} } from "../../src/parser.ts";`,
    ``,
    ...out,
  ].join("\n").trimEnd() + "\n";
}

export const DUMP = new URL("../tests/selfhost/dump.ts", import.meta.url);

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(DUMP, dumperSource(readFileSync(new URL("../src/parser.ts", import.meta.url), "utf8")));
}
