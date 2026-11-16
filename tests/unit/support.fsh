// What the ported tests share: reading files, which fails the test rather than throwing, and
// asking Prettier, the formatter's reference, how it formats.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The repository's root.
export function root(): string {
  return join(import.meta.dir, "..", "..");
}

export function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Fails the test with both values shown when they differ.
export function same(got: string, want: string, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want}\n--- got\n${got}`);
}

// Bun's script printing, as a JSON array, how Prettier formats each input of the JSON array in a
// file: read with `parser`, or for "doc", each input a JSON `[width, doc]` of the formatter's
// documents, laid out by Prettier's own document printer.
function prettierScript(): string {
  return `import { readFileSync } from "node:fs";
const [parser, file, root] = process.argv.slice(2);
const inputs = JSON.parse(readFileSync(file, "utf8"));
const prettier = await import(Bun.resolveSync("prettier", root));
const { builders: b, printer } = await import(Bun.resolveSync("prettier/doc", root));
function theirs(d, ids) {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => theirs(x, ids));
  const id = (name) => (ids.has(name) ? ids.get(name) : ids.set(name, Symbol(name)).get(name));
  switch (d.kind) {
    case "group":
      return d.expandedStates !== null
        ? b.conditionalGroup(d.expandedStates.map((s) => theirs(s, ids)), { shouldBreak: d.break })
        : b.group(theirs(d.contents, ids), { shouldBreak: d.break, id: d.id !== null ? id(d.id) : undefined });
    case "indent": return b.indent(theirs(d.contents, ids));
    case "align": return b.align(Number(d.n), theirs(d.contents, ids));
    case "line": return d.hard ? (d.literal ? b.literallineWithoutBreakParent : b.hardlineWithoutBreakParent) : d.soft ? b.softline : b.line;
    case "ifBreak": return b.ifBreak(theirs(d.breakContents, ids), theirs(d.flatContents, ids), { groupId: d.groupId !== null ? id(d.groupId) : undefined });
    case "indentIfBreak": return b.indentIfBreak(theirs(d.contents, ids), { groupId: id(d.groupId), negate: d.negate });
    case "fill": return b.fill(d.parts.map((p) => theirs(p, ids)));
    case "breakParent": return b.breakParent;
    case "lineSuffix": return b.lineSuffix(theirs(d.contents, ids));
    case "lineSuffixBoundary": return b.lineSuffixBoundary;
    case "label": return b.label(d.label, theirs(d.contents, ids));
    case "trim": return b.trim;
  }
  throw new Error("unknown document kind " + d.kind);
}
const out = [];
for (const input of inputs) {
  if (parser !== "doc") {
    out.push(await prettier.format(input, { parser }));
    continue;
  }
  const [width, doc] = JSON.parse(input);
  out.push(printer.printDocToString(theirs(doc, new Map()), { printWidth: width, tabWidth: 2, useTabs: false }).formatted);
}
console.log(JSON.stringify(out));
`;
}

// How Prettier formats each input, asked of the `prettier` package found from the repository's
// root through a Bun child process, all inputs at once to start Bun once. Prettier is the reference
// the formatter is held to, never part of a build. Without it the test fails.
export function prettier(parser: string, inputs: Ref<string[]>): string[] {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fishc-prettier-"));
    const script = join(dir, "prettier.mjs");
    const file = join(dir, "inputs.json");
    writeFileSync(script, prettierScript());
    writeFileSync(file, `[${inputs.map((s) => JSON.stringify(s)).join(",")}]`);
    const run = spawnSync("bun", [script, parser, file, root()]);
    const decoder = new TextDecoder();
    assert(run.status === 0, `prettier failed: ${decoder.decode(run.stderr)}`);
    const out = JSON.parse<string[]>(decoder.decode(run.stdout));
    rmSync(dir, { recursive: true, force: true });
    return out;
  } catch (e) {
    if (dir !== "") {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (_e) {}
    }
    assert(false, `can't ask prettier: ${e.message}`);
    return [];
  }
}
