import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import * as prettier from "prettier";
import type { Comment } from "../src/lexer.ts";
import { parse, parseWithComments } from "../src/parser.ts";
import { format, programShape } from "../src/printer.ts";

// Every test program and every compiler source must format to text that keeps its comments,
// parses again to the same tree and formats again to the same text; and every compiler source
// must format byte for byte as Prettier formats it, apart from the known differences below. A
// file of `// case:` programs is checked one case at a time, as tests/run.test.ts builds them.

// Where a source file deliberately formats otherwise than Prettier: in Prettier's output, each
// `prettier` text is replaced by `ours`, once.
const knownDifferences = new Map<string, { reason: string; prettier: string; ours: string }[]>([
  ["src/codegen.ts", [{
    reason: "Prettier isn't idempotent here: its own output, formatted again, joins the chain once the object has a line break after its `{`; Fish formats until the text is stable, so it gives Prettier's second-run output",
    prettier: [
      "    awaitsOf",
      "      .get(current)!",
      "      .push({",
      "        state: resumed,",
      "        field: current.frame!.awaits.get(e)!,",
      "        type: inner,",
      "      });",
    ].join("\n"),
    ours: [
      "    awaitsOf.get(current)!.push({",
      "      state: resumed,",
      "      field: current.frame!.awaits.get(e)!,",
      "      type: inner,",
      "    });",
    ].join("\n"),
  }]],
]);

// Programs the parser refuses on purpose, each an error test.
const refused = new Map([
  ["tests/programs/octal_escape.fsh", "octal escapes are refused"],
  ["tests/programs/regex.fsh > regex_unterminated", "an unterminated regular expression"],
  ["tests/programs/type.fsh > type_newline_extends", "'extends' on a new line after a type"],
  ["tests/programs/throw.fsh > throw_newline", "a line break after 'throw'"],
  ["tests/programs/modules_parse_error_elsewhere/b.fsh", "a parse error in an imported file"],
  ["tests/programs/jsdoc_throws.fsh > jsdoc_throws_conflict", "a JSDoc @throws disagreeing with the written clause"],
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

const tree = (src: string) => programShape(parse(src));

// A comment as the formatter may rewrite it: trailing space trimmed, and a JSDoc-shaped block
// comment's lines read without their indentation.
function commentText(c: Comment): string {
  const text = c.text.replace(/[ \t]+$/gm, "").replace(/\r\n?/g, "\n");
  if (c.kind !== "block" || !text.includes("\n")) return text;
  const lines = `*${text.slice(2, -2)}*`.split("\n").map((l) => l.trimStart());
  return lines.every((l) => l.startsWith("*")) ? lines.map((l) => l.trimEnd()).join("\n") : text;
}

const comments = (src: string) => parseWithComments(src).comments.map(commentText);

for (const [name, src] of units) {
  test(`${name} formats keeping its comments, parses back to the same tree and formats the same again`, () => {
    const reason = refused.get(name);
    if (reason !== undefined) {
      expect(() => parse(src), `${name} is listed as refused (${reason}) but parses`).toThrow();
      return;
    }
    const formatted = format(src);
    expect(comments(formatted)).toEqual(comments(src));
    expect(tree(formatted)).toBe(tree(src));
    expect(format(formatted)).toBe(formatted);
  });
}

const sources = files.filter((f) => f.startsWith("src/"));
let matched = 0;

for (const file of sources) {
  test(`${file} formats as Prettier formats it`, async () => {
    const src = readFileSync(root + file, "utf8");
    const expected = await prettier.format(src, { parser: "typescript" });
    const ours = format(src);
    const differences = knownDifferences.get(file);
    if (!differences) {
      expect(ours).toBe(expected);
      matched++;
      return;
    }
    expect(ours, `${file} is listed with known differences but matches Prettier`).not.toBe(expected);
    let adjusted = expected;
    for (const d of differences) {
      expect(adjusted.split(d.prettier).length - 1, `${file}: Prettier's text for "${d.reason}" isn't found once`).toBe(1);
      adjusted = adjusted.replace(d.prettier, () => d.ours);
    }
    expect(ours).toBe(adjusted);
  });
}

test("the corpus and the oracle are counted", () => {
  const oracle = readFileSync(root + "tests/format.test.ts", "utf8");
  const rows = oracle.split("\n").filter((l) => /^ {4}["'`[]/.test(l)).length;
  const differs = [...oracle.matchAll(/await differ\(\[\n([\s\S]*?)\n {2}\]/g)].reduce((n, m) => n + m[1]!.split("\n").length, 0);
  const differences = [...knownDifferences.values()].reduce((n, list) => n + list.length, 0);
  console.log(
    `corpus: ${sources.length} src files, ${matched} matching Prettier, ${differences} known differences in ${knownDifferences.size} files; ` +
    `${units.length} programs, ${refused.size} refused on purpose; oracle and golden rows: ${rows}, of them known differences: ${differs}`,
  );
  expect([...refused.keys()].filter((name) => !units.some(([u]) => u === name))).toEqual([]);
  expect([...knownDifferences.keys()].filter((f) => !sources.includes(f))).toEqual([]);
});
