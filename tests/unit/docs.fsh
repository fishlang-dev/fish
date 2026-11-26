// What `fishc doc` reads from a file's doc comments, and the examples `fishc test` runs.
import {
  documented,
  examplesIn,
  exampleTest,
  headOf,
  modulePage,
  rendered,
  type Example,
} from "../../src/docs.fsh";
import type { Comment } from "../../src/lexer.fsh";
import { parseWithComments, type Stmt } from "../../src/parser.fsh";
import { same } from "./support.fsh";

const SRC = `/** Adds two numbers.
 *
 * Use \`add\` for small ones.
 * @param a the first
 *
 * \`\`\`fsh
 * console.log(add(1, 2));
 * // expect: 3
 * \`\`\`
 */
export function add(a: i64, b: i64): i64 {
  return a + b;
}

/** A point. */
export class Point {
  /** Across. */
  x: i64 = 0;
  #hidden: i64 = 0;
  constructor() {}
  /** How far. */
  length(): f64 { return 0.0; }
}

export const LIMIT: i64 = 3;
function inner() {}
`;

function parsedSrc(): { program: Stmt[]; comments: Comment[] } {
  try {
    const p = parseWithComments(SRC, { last: 0 });
    return { program: p.program, comments: p.comments };
  } catch (e) {
    assert(false, e.message);
    return { program: [], comments: [] };
  }
}

test("a doc comment is found for each exported declaration, with its signature as written", () => {
  const parsed = parsedSrc();
  const items = documented(SRC, parsed.program, parsed.comments);
  same(
    items.map((d) => `${d.kind} ${d.name}`).join(", "),
    "function add, class Point, const LIMIT",
    "the items",
  );
  same(
    items[0]!.signature,
    "export function add(a: i64, b: i64): i64",
    "add's signature",
  );
  assert(
    items[0]!.doc.startsWith("Adds two numbers.\n\nUse `add`"),
    items[0]!.doc,
  );
  same(
    items[1]!.members.map((m) => `${m.kind} ${m.name}: ${m.doc}`).join("; "),
    "field x: Across.; constructor constructor: ; method length: How far.",
    "Point's members",
  );
  same(items[2]!.signature, "const LIMIT: i64", "the constant");
});

test("an example's code keeps its offsets, and its expect lines are read", () => {
  const parsed = parsedSrc();
  const found = examplesIn(SRC, parsed.comments);
  same(String(found.length), "1", "one example");
  const e: Ref<Example> = found[0]!;
  same(String(e.line), "6", "its fence's line");
  same(e.expect.join("|"), "3", "its expect lines");
  same(
    String(e.padded.length),
    String(SRC.length),
    "the padded text is as long as the file",
  );
  const at = SRC.indexOf("console.log");
  same(
    e.padded.slice(at as i64, (at + 21) as i64),
    "console.log(add(1, 2)",
    "the code sits where it is written",
  );
  same(e.padded.slice(0, at as i64).trim(), "", "nothing before it is kept");
  const t = exampleTest(e);
  assert(t.text.startsWith('test("", () => {'), t.text.slice(0, 30));
  assert(t.text.includes("});"), "the wrapper closes on the fence");
});

test("a signature stops at the body's brace, not at an object type's", () => {
  same(
    headOf("function f(o: { a: i64 }): { b: i64 } { return o; }"),
    "function f(o: { a: i64 }): { b: i64 }",
    "object types",
  );
  same(
    headOf('async function g(s = "{"): Promise<void> throws E {}'),
    'async function g(s = "{"): Promise<void> throws E',
    "a brace in a string",
  );
});

test("a doc comment renders paragraphs, code and tags, escaped", () => {
  same(
    rendered("A <b> `x`.\n\n```fsh\nf(1 < 2);\n```\n@throws {E} when bad"),
    '<p>A &lt;b&gt; <code>x</code>.</p>\n<pre><code>f(1 &lt; 2);</code></pre>\n<ul class="tags">\n<li><b>@throws</b> {E} when bad</li>\n</ul>\n',
    "the HTML",
  );
  const parsed = parsedSrc();
  const html = modulePage(
    "src/lib.fsh",
    documented(SRC, parsed.program, parsed.comments),
  );
  assert(
    html.includes('id="add"') &&
      html.includes("export function add(a: i64, b: i64): i64") &&
      html.includes("console.log(add(1, 2));"),
    html,
  );
});
