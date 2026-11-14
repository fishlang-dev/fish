// Writes `src/unquote.ts`, which turns a value a macro made while compiling, of an `Ast` type,
// back into the syntax tree it stands for, from the parser's own AST types in `src/parser.ts`:
// the `Ast` types mirror them field for field, so each record reads as a node of its kind.
// `tests/walk.test.ts` fails when the file is stale.
import type { TypeNode } from "../src/parser.ts";
import { nodeTypes } from "./dumpgen.ts";

// The fields the compiler sets on nodes for its own passes, which no `Ast` type has.
const INTERNAL = new Set(["narrows"]);

const HEADER = `// Generated from the parser's AST types by \`bun scripts/unquotegen.ts\`; a test fails when it is stale.
// A value a macro made while compiling, of an \`Ast\` type, as the syntax tree it stands for: each
// record a node of its kind, its fields read by name, an absent part \`undefined\`, and a node made
// from one given a fresh id once its parts have theirs.
import type { Value } from "./comptime.ts";
import { nextId, type Ids } from "./ids.ts";
`;

const HELPERS = `
/** @throws {Error} */
function field(v: Ref<Value>, name: string): Value {
  if (v !== null && typeof v === "object" && v.kind === "member") return field(v.value, name);
  if (v !== null && typeof v === "object" && v.kind === "record") {
    const x = v.fields.get(name);
    return x === undefined ? undefined : x;
  }
  throw new Error(\`internal error: an Ast value without a '\${name}'\`);
}

/** @throws {Error} */
function kindOf(v: Ref<Value>): string {
  const k = field(v, "kind");
  return text(k);
}

function absent(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return absent(v.value);
  return v === null || v === undefined;
}

function isText(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isText(v.value);
  return typeof v === "string";
}

function isItems(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isItems(v.value);
  return v !== null && typeof v === "object" && v.kind === "array";
}

/** @throws {Error} */
function text(v: Ref<Value>): string {
  if (v !== null && typeof v === "object" && v.kind === "member") return text(v.value);
  if (typeof v === "string") return v;
  throw new Error("internal error: an Ast value that isn't text where text belongs");
}

/** @throws {Error} */
function flag(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return flag(v.value);
  if (typeof v === "boolean") return v;
  throw new Error("internal error: an Ast value that isn't a boolean where one belongs");
}

/** @throws {Error} */
function count(v: Ref<Value>): usize {
  if (v !== null && typeof v === "object" && v.kind === "member") return count(v.value);
  if (typeof v === "bigint") return Number(v.toString())! as usize;
  throw new Error("internal error: an Ast value that isn't an integer where an offset belongs");
}

/** @throws {Error} */
function float(v: Ref<Value>): f64 {
  if (v !== null && typeof v === "object" && v.kind === "member") return float(v.value);
  if (typeof v === "number") return v;
  throw new Error("internal error: an Ast value that isn't a float where one belongs");
}

/** @throws {Error} */
function big(v: Ref<Value>): bigint {
  if (v !== null && typeof v === "object" && v.kind === "member") return big(v.value);
  if (typeof v === "bigint") return v;
  throw new Error("internal error: an Ast value that isn't an integer where one belongs");
}

/** @throws {Error} */
function itemsOf(v: Ref<Value>): Value[] {
  if (v !== null && typeof v === "object" && v.kind === "member") return itemsOf(v.value);
  if (v !== null && typeof v === "object" && v.kind === "array") return [...v.items];
  throw new Error("internal error: an Ast value that isn't a list where one belongs");
}
`;

export function unquoteSource(parserSource: string): string {
  const { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show } = nodeTypes(parserSource);
  type Shape = ReturnType<typeof shapes>[number];

  const words = new Map<string, { name: string; values: string[] }>();
  const literals = (t: TypeNode): string[] => {
    if (t.kind === "literal") return [(t.value as { value: string }).value];
    if (t.kind === "union") return t.types.flatMap(literals);
    if (t.kind === "ref" && aliases.has(t.name)) return literals(aliases.get(t.name)!);
    return [];
  };
  // The function reading text as the word type `t`, which names its values.
  const word = (t: TypeNode): string => {
    if (ref(t, "string")) return "text";
    const type = show(t);
    if (!words.has(type)) words.set(type, { name: `word${words.size}`, values: literals(t) });
    return words.get(type)!.name;
  };
  const unions = new Map<string, { name: string; members: TypeNode[] }>();
  const unionName = (members: TypeNode[]) => {
    const key = members.map(show).join(" | ");
    if (!unions.has(key)) unions.set(key, { name: `unquoteUnion${unions.size}`, members });
    return unions.get(key)!.name;
  };
  let loops = 0;
  // An expression giving the value `v`, of type `t`, as the tree has it. `field` writes the type
  // of the node's field it fills, when it fills one.
  const value = (t: TypeNode, v: string, field?: string): string => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
        return `${word(t)}(${v})`;
      case "bigint":
        return `big(${v})`;
      case "plain":
        if (t.kind === "literal") return `${JSON.stringify((t.value as { value: unknown }).value)} as const`;
        if (ref(t, "boolean")) return `flag(${v})`;
        if (ref(t, "f64")) return `float(${v})`;
        return `count(${v})`;
      case "node":
        return `unquote${f.name}(ids, ${v})`;
      case "union":
        return `${unionName(f.members)}(ids, ${v})`;
      case "array": {
        const x = `x${++loops}`;
        // A list whose elements may be absent is typed by its field, as the checker reads a
        // recursive type's absent elements only through the field's own type.
        const element = formOf(f.element).form === "option" && field !== undefined ? `${field}[usize]` : show(f.element);
        return `itemsOf(${v}).map((${x}): ${element} => ${value(f.element, x)})`;
      }
      case "option":
        return `absent(${v}) ? undefined : ${value(f.inner, v)}`;
      case "object":
        return build({ kind: undefined, fields: f.fields }, v);
    }
  };
  // A node of shape `s` made from the record `v`: its fields in order, then its id.
  const build = (s: Shape, v: string, type?: string): string => {
    const parts: string[] = s.kind !== undefined ? [`kind: ${JSON.stringify(s.kind)}`] : [];
    let id = false;
    for (const f of s.fields) {
      if (f.name === "id") id = true;
      if (f.name === "id" || INTERNAL.has(f.name)) continue;
      const x = `field(${v}, ${JSON.stringify(f.name)})`;
      const typed = type !== undefined && !f.optional ? `${type}[${JSON.stringify(f.name)}]` : undefined;
      parts.push(`${f.name}: ${f.name === "start" || f.name === "end" ? `count(${x})` : f.optional ? `absent(${x}) ? undefined : ${value(f.type, x)}` : value(f.type, x, typed)}`);
    }
    if (id) parts.push("id: nextId(ids)");
    return `{ ${parts.join(", ")} }`;
  };
  const fn = (name: string, type: string, body: string[], exported = false) => [
    `/** @throws {Error} */`,
    `${exported ? "export " : ""}function ${name}(ids: Mut<Ids>, v: Ref<Value>): ${type} {`,
    ...body.map((l) => `  ${l}`),
    `}`,
    ``,
  ];
  // A switch over the node kinds of `all`, each kind made by a function of its own.
  const kinds = new Map<string, string[]>();
  const cases = (all: Shape[]): string[] => {
    if (all.length === 1 && all[0]!.kind === undefined) return [`return ${build(all[0]!, "v")};`];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined) throw new Error(`unquotegen can't tell apart the nodes of ${s.owner}`);
      if (seen.has(s.kind)) continue;
      seen.add(s.kind);
      const name = `unquote${s.owner}_${s.kind}`;
      if (!kinds.has(name)) {
        kinds.set(name, []);
        const type = `Extract<${s.owner}, { kind: ${s.kindType} }>`;
        kinds.set(name, fn(name, type, [`return ${build(s, "v", type)};`]));
      }
      out.push(`  case ${JSON.stringify(s.kind)}:`, `    return ${name}(ids, v);`);
    }
    return [`const kind = kindOf(v);`, `switch (kind) {`, ...out, `}`, `throw new Error(\`internal error: an Ast value of kind '\${kind}', which no node here has\`);`];
  };

  const out: string[] = [];
  for (const [name, t] of aliases) if (isNode(name)) out.push(...fn(`unquote${name}`, name, cases(shapes(t).map((s) => ({ ...s, owner: s.owner ?? name }))), true));
  // Unions found while writing the node makers, and those found while writing these.
  for (let i = 0; i < unions.size; i++) {
    const [, { name, members }] = [...unions][i]!;
    const body: string[] = [];
    let rest = members.flatMap((m) => (m.kind === "ref" && aliases.has(m.name) && !isNode(m.name) && !isWord(m) ? membersOf(aliases.get(m.name)) : [m]));
    if (rest.some((m) => ref(m, "string"))) {
      body.push(`if (isText(v)) return text(v);`);
      rest = rest.filter((m) => !ref(m, "string"));
    }
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (isItems(v)) return ${value(array, "v")};`);
      rest = rest.filter((m) => m !== array);
    }
    // One node type left is that type's maker's; several are told apart by kind here.
    const only = rest.length === 1 ? rest[0]! : undefined;
    if (only?.kind === "ref" && isNode(only.name)) body.push(`return unquote${only.name}(ids, v);`);
    else body.push(...cases(rest.flatMap(shapes)));
    out.push(...fn(name, members.map(show).join(" | "), body));
  }
  for (const lines of kinds.values()) out.push(...lines);
  for (const [type, { name, values }] of words) {
    out.push(`/** @throws {Error} */`, `function ${name}(v: Ref<Value>): ${type} {`, `  const s = text(v);`);
    for (const x of values) out.push(`  if (s === ${JSON.stringify(x)}) return ${JSON.stringify(x)};`);
    out.push(`  throw new Error(\`internal error: '\${s}' where an Ast value names one of ${values.map((x) => `'${x}'`).join(", ").replaceAll("`", "\\`")}\`);`, `}`, ``);
  }
  const imports = [...aliases.keys()].filter((name) => out.some((l) => new RegExp(`\\b${name}\\b`).test(l)));
  return [HEADER.trimEnd(), `import type { ${imports.join(", ")} } from "./parser.ts";`, HELPERS, ...out].join("\n").trimEnd() + "\n";
}

export const UNQUOTE = new URL("../src/unquote.ts", import.meta.url);

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(UNQUOTE, unquoteSource(readFileSync(new URL("../src/parser.ts", import.meta.url), "utf8")));
}
