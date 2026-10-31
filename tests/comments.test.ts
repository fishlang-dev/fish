import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript5";
import { lexer } from "../src/lexer.ts";
import { parseWithComments, type Stmt } from "../src/parser.ts";

// A tree without its nodes' ids, which differ between two parses of the same text.
function withoutIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutIds);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, withoutIds(x)]));
}

// Each comment as [kind, text], and that its span holds exactly its text.
function comments(src: string): [string, string][] {
  const found = parseWithComments(src).comments;
  for (const c of found) expect(src.slice(c.start, c.end)).toBe(c.text);
  return found.map((c) => [c.kind, c.text]);
}

test("line, block, doc and shebang comments are kept with their spans, in order", () => {
  const src = `#!/usr/bin/env fishc\n// one\n/** doc */\nfunction main() { /* two\n lines */ const x = 1; // end\n}\n`;
  expect(comments(src)).toEqual([["shebang", "#!/usr/bin/env fishc"], ["line", "// one"], ["block", "/** doc */"], ["block", "/* two\n lines */"], ["line", "// end"]]);
  const at = parseWithComments(src).comments[1]!;
  expect([at.start, at.end]).toEqual([21, 27]);
  expect(comments(`const x = 1;`)).toEqual([]);
  expect(comments(`// only a comment`)).toEqual([["line", "// only a comment"]]);
});

test("comments inside substitutions and around Fish's own syntax are kept", () => {
  expect(comments("const s = `a ${/* in */ 1 + 2} b`;")).toEqual([["block", "/* in */"]]);
  expect(comments(`const y = x |> /* pipe */ f(%); // after\nconst z = match (y) { // arms\n  case 1 => "a", /* one */\n  case _ => "b",\n};\nconst k = comptime /* c */ g();`)).toEqual([
    ["block", "/* pipe */"], ["line", "// after"], ["line", "// arms"], ["block", "/* one */"], ["block", "/* c */"],
  ]);
});

test("strings, template text and regexes hold no comments", () => {
  expect(comments(`const a = "// not"; const b = '/* not */';`)).toEqual([]);
  expect(comments("const t = `// not ${'/* not */'} /* not */`;")).toEqual([]);
  expect(comments(`const r = /a\\/\\/b/; const s = /[/*]+/g; // real`)).toEqual([["line", "// real"]]);
});

test("a stretch the lexer reads again as a regex records its comments once", () => {
  // Read ahead as `/`, `[` and a `//` comment, then read again from the slash as one regex.
  const lex = lexer("/[//]/ + 1; // real");
  const slash = lex.next();
  lex.next();
  lex.next();
  expect(lex.comments.map((c) => c.text)).toEqual(["//]/ + 1; // real"]);
  expect(lex.regex(slash).text).toBe("/[//]/");
  expect(lex.comments).toEqual([]);
  while (lex.next().kind !== "eof");
  expect(lex.comments.map((c) => c.text)).toEqual(["// real"]);
  expect(comments(`const r = x ? /=\\/\\/ / : 1; /* after */`)).toEqual([["block", "/* after */"]]);
  expect(comments(`f(/a/, /* mid */ /b/); // end`)).toEqual([["block", "/* mid */"], ["line", "// end"]]);
});

// Every comment TypeScript's own scanner finds in the trivia before each token.
function typescriptComments(text: string): [number, number][] {
  const file = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, number>();
  const visit = (node: ts.Node) => {
    if (node.getChildCount(file) === 0) for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(r.pos, r.end);
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  // TypeScript reports a shebang apart from comments.
  const shebang = ts.getShebang(text);
  if (shebang !== undefined) ranges.set(0, shebang.length);
  return [...ranges].sort(([a], [b]) => a - b);
}

test("the compiler's own source holds the comments TypeScript's scanner finds", () => {
  const files = readdirSync(join(import.meta.dir, "..", "src")).filter((f) => f.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(40);
  for (const f of files) {
    const text = readFileSync(join(import.meta.dir, "..", "src", f), "utf8");
    const ours = parseWithComments(text).comments.map((c): [number, number] => [c.start, c.end]);
    expect([f, ours]).toEqual([f, typescriptComments(text)]);
  }
});

// Each program of a test file: the whole file, or each of its cases.
function programs(file: string): string[] {
  const src = readFileSync(file, "utf8");
  if (!/^\/\/ case: /m.test(src)) return [src];
  return src.split(/^\/\/ case: .*$/m).slice(1);
}

// The source with each comment's characters made spaces, its newlines kept.
const blanked = (src: string) => {
  let out = src;
  for (const c of parseWithComments(src).comments) out = out.slice(0, c.start) + c.text.replace(/[^\n]/g, " ") + out.slice(c.end);
  return out;
};

test("blanking every test program's comments leaves the same parse, so recording changes nothing", () => {
  const files = readdirSync(join(import.meta.dir, "programs"), { recursive: true }).map(String).filter((f) => f.endsWith(".fsh"));
  expect(files.length).toBeGreaterThan(200);
  let compared = 0;
  for (const f of files) {
    for (const src of programs(join(import.meta.dir, "programs", f))) {
      let tree: Stmt[];
      try {
        tree = parseWithComments(src).program;
      } catch (e) {
        expect(() => parseWithComments(blanked(src))).toThrow((e as Error).message);
        continue;
      }
      const plain = blanked(src);
      expect(parseWithComments(plain).comments).toEqual([]);
      expect([f, withoutIds(parseWithComments(plain).program)]).toEqual([f, withoutIds(tree)]);
      compared++;
    }
  }
  expect(compared).toBeGreaterThan(1000);
});
