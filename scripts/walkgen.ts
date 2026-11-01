// Writes `src/walk.ts`, which visits the child nodes of every node kind, from the parser's own AST
// types in `src/parser.ts`, so the compiler can walk a tree without reading arbitrary objects'
// fields, which Fish can't. A visitor has a method for each of the parser's node types; Fish has
// no unions holding references yet, so one callback can't take a node of any type.
// `tests/walk.test.ts` fails when the file is stale.
import type { TypeNode } from "../src/parser.ts";
import { nodeTypes } from "./dumpgen.ts";

export function walkerSource(parserSource: string): string {
  const { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show } = nodeTypes(parserSource);
  const nodes = [...aliases.keys()].filter(isNode);
  const method = (name: string) => name[0]!.toLowerCase() + name.slice(1);

  const unions = new Map<string, { name: string; members: TypeNode[] }>();
  const unionName = (members: TypeNode[]) => {
    const key = members.map(show).join(" | ");
    if (!unions.has(key)) unions.set(key, { name: `visitOneOf${unions.size}`, members });
    return unions.get(key)!.name;
  };

  // How many loops deep a visit is, which names its loop variable.
  let depth = 0;
  // Statements visiting the nodes `value`, of type `t`, holds; none when it holds none.
  const visits = (t: TypeNode, value: string): string[] => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
      case "plain":
      case "bigint":
        return [];
      case "node":
        return [`v.${method(f.name)}(${value});`];
      case "union":
        return holdsNodes(f.members) ? [`${unionName(f.members)}(${value}, v);`] : [];
      case "array": {
        if (ref(f.element, "Stmt")) return [`v.stmts(${value});`];
        const x = `x${++depth}`;
        const inner = visits(f.element, x);
        depth--;
        return inner.length ? [`for (const ${x} of ${value}) {`, ...inner.map((l) => `  ${l}`), `}`] : [];
      }
      case "option": {
        const inner = visits(f.inner, `${value}!`);
        return inner.length ? [`if (${value} !== undefined) {`, ...inner.map((l) => `  ${l}`), `}`] : [];
      }
      case "object":
        return fieldVisits(f.fields, value);
    }
  };
  const fieldVisits = (fields: { name: string; optional: boolean; type: TypeNode }[], value: string): string[] =>
    fields.flatMap((f) => {
      const inner = visits(f.type, `${value}.${f.name}${f.optional ? "!" : ""}`);
      return f.optional && inner.length ? [`if (${value}.${f.name} !== undefined) {`, ...inner.map((l) => `  ${l}`), `}`] : inner;
    });
  // Whether a value of one of `members` may hold a node.
  const holdsNodes = (members: TypeNode[]): boolean => members.flatMap(expand).some((m) => {
    if (ref(m, "string")) return false;
    if (ref(m, "Extract")) return true;
    const f = formOf(m);
    switch (f.form) {
      case "json": case "plain": case "bigint": return false;
      case "node": return true;
      case "array": return holdsNodes([f.element]);
      case "option": return holdsNodes([f.inner]);
      case "object": return holdsNodes(f.fields.map((x) => x.type));
      case "union": return holdsNodes(f.members);
    }
  });
  // A union's members, with an alias of a union that isn't a node type, as `PropertyName`, opened.
  const expand = (m: TypeNode): TypeNode[] => (m.kind === "ref" && aliases.has(m.name) && !isNode(m.name) && !isWord(m) ? membersOf(aliases.get(m.name)) : [m]);

  const fn = (name: string, type: string, body: string[]) => [
    `export function ${name}<V extends Visitor>(${body.length ? "n" : "_n"}: Ref<${type}>, ${body.length ? "v" : "_v"}: Mut<V>): void {`,
    ...body.map((l) => `  ${l}`),
    `}`,
    ``,
  ];
  // The children of a node of type `name`, kind by kind when it has kinds.
  const children = (name: string): string[] => {
    const all = shapes(aliases.get(name)!);
    if (all.length === 1 && all[0]!.kind === undefined) return fieldVisits(all[0]!.fields, "n");
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined || seen.has(s.kind)) continue;
      seen.add(s.kind);
      const body = fieldVisits(s.fields, "n");
      if (body.length) out.push(`  case ${JSON.stringify(s.kind)}:`, ...body.map((l) => `    ${l}`), `    break;`);
    }
    return out.length ? [`switch (n.kind) {`, ...out, `}`] : [];
  };

  const out: string[] = [];
  for (const name of nodes) out.push(...fn(`childrenOf${name}`, name, children(name)));
  out.push(...fn("childrenOfStmts", "Stmt[]", ["for (const x of n) {", "  v.stmt(x);", "}"]));
  // A field of a union type goes to the visitor's method for the member it holds. A kind two node
  // types share goes to the first written; as `expr` in `Stmt | Pattern`, their shapes agree.
  for (let i = 0; i < unions.size; i++) {
    const [, { name, members }] = [...unions][i]!;
    const body: string[] = [];
    let rest = members.flatMap(expand).filter((m) => !ref(m, "string"));
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (Array.isArray(n)) {`, ...visits(array, "n").map((l) => `  ${l}`), `  return;`, `}`);
      rest = rest.filter((m) => m !== array);
    }
    if (members.flatMap(expand).some((m) => ref(m, "string"))) body.unshift(`if (typeof n === "string") return;`);
    const owner = (m: TypeNode) => (m.kind === "ref" && m.name === "Extract" && m.args[0]!.kind === "ref" ? m.args[0]!.name : m.kind === "ref" ? m.name : "");
    if (rest.length === 1) body.push(`v.${method(owner(rest[0]!))}(n);`);
    else {
      const seen = new Set<string>();
      body.push(`switch (n.kind) {`);
      for (const m of rest) {
        const kinds = shapes(m).flatMap((s) => (s.kind === undefined || seen.has(s.kind) ? [] : [s.kind]));
        kinds.forEach((k) => seen.add(k));
        // A case each, as Fish lends a node narrowed to one shape, not to several, as its whole type.
        for (const k of kinds) body.push(`  case ${JSON.stringify(k)}:`, `    v.${method(owner(m))}(n);`, `    break;`);
      }
      body.push(`}`);
    }
    out.push(`// ${members.map(show).join(" | ")}`, ...fn(name, members.map(show).join(" | "), body));
  }

  const visitor = [
    `// What a walk does at each node it reaches, by the node's type. A method visits a node's children`,
    `// by calling the matching \`childrenOf\` function, or skips them by not calling it.`,
    `export interface Visitor {`,
    ...nodes.map((name) => `  ${method(name)}(this: Mut<this>, n: Ref<${name}>): void;`),
    `  // A list of statements, apart from the nodes, as it is a scope of its own.`,
    `  stmts(this: Mut<this>, n: Ref<Stmt[]>): void;`,
    `}`,
    ``,
  ];
  const imports = [...aliases.keys()].filter((name) => out.some((l) => new RegExp(`\\b${name}\\b`).test(l)));
  return [
    `// Generated from the parser's AST types by \`bun scripts/walkgen.ts\`; a test fails when it is stale.`,
    `// Each \`childrenOf\` function hands each node a node holds to the visitor, in the order its type`,
    `// lists the fields.`,
    `import type { ${imports.join(", ")} } from "./parser.ts";`,
    ``,
    ...visitor,
    ...out,
  ].join("\n").trimEnd() + "\n";
}

export const WALK = new URL("../src/walk.ts", import.meta.url);

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(WALK, walkerSource(readFileSync(new URL("../src/parser.ts", import.meta.url), "utf8")));
}
