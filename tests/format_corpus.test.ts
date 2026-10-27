import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { parse } from "../src/parser.ts";
import { printProgram } from "../src/printer.ts";

// Every test program and every compiler source, printed with its comments dropped, must parse
// again to the same tree and print again to the same text. A file of `// case:` programs is
// checked one case at a time, as tests/run.test.ts builds them.

// Programs the parser refuses on purpose, each an error test.
const refused = new Map([
  ["tests/programs/octal_escape.fsh", "octal escapes are refused"],
  ["tests/programs/regex.fsh > regex_unterminated", "an unterminated regular expression"],
  ["tests/programs/type.fsh > type_newline_extends", "'extends' on a new line after a type"],
  ["tests/programs/throw.fsh > throw_newline", "a line break after 'throw'"],
  ["tests/programs/modules_parse_error_elsewhere/b.fsh", "a parse error in an imported file"],
]);

const root = new URL("..", import.meta.url).pathname;
const files = [...new Glob("tests/programs/**/*.fsh").scanSync(root), ...new Glob("src/*.ts").scanSync(root)].sort();

// Each program: a file, or each case in it, named `<file> > <case>`.
function programs(file: string): [string, string][] {
  const src = readFileSync(root + file, "utf8");
  if (!/^\/\/ case: /m.test(src)) return [[file, src]];
  const cases: [string, string[]][] = [];
  for (const line of src.split("\n")) {
    const marker = /^\/\/ case: (.*)$/.exec(line);
    if (marker) cases.push([`${file} > ${marker[1]!.trim()}`, []]);
    else cases.at(-1)?.[1].push(line);
  }
  return cases.map(([name, lines]) => [name, lines.join("\n")]);
}
const units = files.flatMap(programs);

// The tree with what printing legitimately changes taken out:
// - `start` and `end`, which move with the layout;
// - empty statements, which Prettier drops from statement lists (as a body, `;` stays);
// - `args` of `new C`, which Prettier prints as `new C()`;
// - a regex's flags, which Prettier sorts and whose order means nothing;
// - `a && (b && c)`, and the same for `||`, `??` and `|>`, which Prettier prints without the
//   parentheses; each of these operators is associative, so the left-nested tree means the same.
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => (x as { kind?: string } | undefined)?.kind !== "empty").map(normalize);
  if (typeof v === "bigint") return `${v}n`;
  if (!v || typeof v !== "object") return v;
  const node: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (k !== "start" && k !== "end") node[k] = normalize(x);
  if (node.kind === "new" && node.args === undefined) node.args = [];
  if (node.kind === "regex" && typeof node.flags === "string") node.flags = [...node.flags].sort().join("");
  return leftNested(node);
}

type Node = Record<string, unknown>;

function leftNested(node: Node): Node {
  const chain = (outer: Node, inner: unknown): inner is Node =>
    typeof inner === "object" && inner !== null && (inner as Node).kind === outer.kind &&
    (outer.kind === "pipe" || ((outer.op === "&&" || outer.op === "||" || outer.op === "??") && (inner as Node).op === outer.op));
  if (node.kind === "binary" && chain(node, node.right)) {
    const right = node.right;
    return leftNested({ ...node, left: leftNested({ ...node, right: right.left }), right: right.right });
  }
  if (node.kind === "pipe" && chain(node, node.body)) {
    const body = node.body;
    return leftNested({ ...node, value: leftNested({ ...node, body: body.value }), body: body.body });
  }
  return node;
}

const tree = (src: string) => JSON.stringify(normalize(parse(src)));

for (const [name, src] of units) {
  test(`${name} prints, parses back to the same tree and prints the same again`, () => {
    const reason = refused.get(name);
    if (reason !== undefined) {
      expect(() => parse(src), `${name} is listed as refused (${reason}) but parses`).toThrow();
      return;
    }
    const printedSrc = printProgram(parse(src), src);
    expect(tree(printedSrc)).toBe(tree(src));
    expect(printProgram(parse(printedSrc), printedSrc)).toBe(printedSrc);
  });
}

test("the corpus and the oracle are counted", () => {
  const oracle = readFileSync(root + "tests/format.test.ts", "utf8");
  const rows = oracle.split("\n").filter((l) => /^ {4}["'`[]/.test(l)).length;
  const differs = [...oracle.matchAll(/await differ\(\[\n([\s\S]*?)\n {2}\]/g)].reduce((n, m) => n + m[1]!.split("\n").length, 0);
  console.log(`corpus: ${files.length} files, ${units.length} programs, ${refused.size} refused on purpose; oracle and golden rows: ${rows}; known differences: ${differs}`);
  expect([...refused.keys()].filter((name) => !units.some(([u]) => u === name))).toEqual([]);
});
