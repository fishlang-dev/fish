// Ports tests/comments.test.ts but its comparison with TypeScript's own scanner, which needs the
// npm typescript package.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { lexer, type Comment } from "../compiler/lexer.fsh";
import { parseWithComments } from "../compiler/parser.fsh";
import { read, root, same } from "./support.fsh";

// Each comment as kind and text, one per line, failing the test when a span doesn't hold its text.
function comments(src: string): string {
  let shown: string[] = [];
  try {
    const found = parseWithComments(src, { last: 0 }).comments;
    for (const c of found) {
      assert(src.slice(c.start as i64, c.end as i64) === c.text, `span ${c.start}..${c.end} doesn't hold ${c.text}`);
      shown.push(`${c.kind} ${c.text}`);
    }
  } catch (e) {
    assert(false, `${src} doesn't parse: ${e.message}`);
  }
  return shown.join("\n");
}

test("line, block, doc and shebang comments are kept with their spans, in order", () => {
  const src = `#!/usr/bin/env fishc\n// one\n/** doc */\nfunction main() { /* two\n lines */ const x = 1; // end\n}\n`;
  same(comments(src), "shebang #!/usr/bin/env fishc\nline // one\nblock /** doc */\nblock /* two\n lines */\nline // end", "comments");
  try {
    const parsed = parseWithComments(src, { last: 0 });
    const at: Ref<Comment> = parsed.comments[1]!;
    assert(at.start === 21 && at.end === 27, `the second comment spans ${at.start}..${at.end}`);
  } catch (e) {
    assert(false, e.message);
  }
  same(comments(`const x = 1;`), "", "no comments");
  same(comments(`// only a comment`), "line // only a comment", "a lone comment");
});

test("comments inside substitutions and around Fish's own syntax are kept", () => {
  same(comments("const s = `a ${/* in */ 1 + 2} b`;"), "block /* in */", "in a substitution");
  same(comments(`const y = x |> /* pipe */ f(%); // after\nconst z = match (y) { // arms\n  case 1 => "a", /* one */\n  case _ => "b",\n};\nconst k = comptime /* c */ g();`), "block /* pipe */\nline // after\nline // arms\nblock /* one */\nblock /* c */", "around Fish's syntax");
});

test("strings, template text and regexes hold no comments", () => {
  same(comments(`const a = "// not"; const b = '/* not */';`), "", "strings");
  same(comments("const t = `// not ${'/* not */'} /* not */`;"), "", "templates");
  same(comments(`const r = /a\\/\\/b/; const s = /[/*]+/g; // real`), "line // real", "regexes");
});

test("a stretch the lexer reads again as a regex records its comments once", () => {
  try {
    // Read ahead as `/`, `[` and a `//` comment, then read again from the slash as one regex.
    let lex = lexer("/[//]/ + 1; // real");
    const slash = lex.next();
    lex.next();
    lex.next();
    same(lex.comments.map((c) => c.text).join("\n"), "//]/ + 1; // real", "read ahead");
    same(lex.regex(slash).text, "/[//]/", "the regex");
    assert(lex.comments.length === 0, "the comment read ahead is dropped");
    while (lex.next().kind !== "eof") {}
    same(lex.comments.map((c) => c.text).join("\n"), "// real", "read again");
  } catch (e) {
    assert(false, e.message);
  }
  same(comments(`const r = x ? /=\\/\\/ / : 1; /* after */`), "block /* after */", "after a conditional regex");
  same(comments(`f(/a/, /* mid */ /b/); // end`), "block /* mid */\nline // end", "between regexes");
});

// Every .fsh file under `dir`, as a path relative to it.
function fshUnder(dir: string, at: string): string[] {
  let found: string[] = [];
  try {
    for (const name of readdirSync(join(dir, at))) {
      const rel = at === "" ? name : join(at, name);
      if (statSync(join(dir, rel)).isDirectory()) {
        for (const f of fshUnder(dir, rel)) found.push(f);
      }
      else if (name.endsWith(".fsh")) found.push(rel);
    }
  } catch (e) {
    assert(false, e.message);
  }
  return found;
}

// Each program of a test file: the whole file, or each of its cases.
function programs(file: string): string[] {
  const src = read(file);
  if (!/^\/\/ case: /m.test(src)) return [src];
  return src.split(/^\/\/ case: .*$/m).slice(1);
}

// The source with each comment's characters made spaces, its newlines kept.
function blanked(src: string): string {
  let out = src;
  try {
    const parsed = parseWithComments(src, { last: 0 });
    for (const c of parsed.comments) out = out.slice(0, c.start as i64) + c.text.replace(/[^\n]/g, " ") + out.slice(c.end as i64);
  } catch (e) {
    assert(false, e.message);
  }
  return out;
}

test("blanking every test program's comments leaves the same parse, so recording changes nothing", () => {
  const files = fshUnder(join(root(), "tests", "programs"), "");
  assert(files.length > 200, `only ${files.length} test programs`);
  let compared = 0;
  for (const f of files) {
    for (const src of programs(join(root(), "tests", "programs", f))) {
      // A program that doesn't parse can't be blanked either, since blanking parses it first.
      let parses = true;
      try {
        parseWithComments(src, { last: 0 });
      } catch (_e) {
        parses = false;
      }
      if (!parses) continue;
      const plain = blanked(src);
      try {
        const tree = parseWithComments(src, { last: 0 }).program;
        const blank = parseWithComments(plain, { last: 0 });
        assert(blank.comments.length === 0, `${f}: comments are left after blanking`);
        assert(blank.program === tree, `${f}: blanking its comments changes the parse`);
      } catch (e) {
        assert(false, `${f}: ${e.message}`);
      }
      compared++;
    }
  }
  assert(compared > 1000, `only ${compared} programs compared`);
});
