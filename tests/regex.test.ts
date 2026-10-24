import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAsync } from "../src/main.ts";
import { compile, parsePattern, RegexSyntaxError } from "../src/regex.ts";

// The pattern parser accepts exactly what the engine running the compiler accepts, over
// patterns put together from pieces that exercise the grammar's corners, with a fixed seed.
const PIECES: string[] = ["a", "b", "\\", "(", ")", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?<m>", "\\k<n>", "\\k", "[", "]", "[^", "-", "^", "$", ".", "*", "+", "?", "{", "}", "{2}", "{1,3}", "{3,1}", "{2,}", "|", "\\d", "\\W", "\\b", "\\B", "\\1", "\\2", "\\0", "\\01", "\\8", "\\x4", "\\x41", "\\u0041", "\\u{41}", "\\uD83D\\uDE00", "\\c", "\\cA", "\\c1", "\\p{L}", "\\P{Lu}", "\\p{Foo}", "\\q{ab|c}", "&&", "--", "\\-", "\\/", "/", "😀", "\\n", "\\z", "(?i:", "(?-i:", "(?m-s:", "(?ii:", "[a-z]", "[z-a]", "[\\d-z]", "\\s", "_", "&", "!", "\\&", "[[a]--b]", "[\\q{}]", "[a&&&b]", "[a--b--c]", "[a&&b--c]", "[^\\q{ab}]", "(?<n>a)|(?<n>b)", "(?<\\u0061>"];
const FLAGS = ["", "u", "v", "i", "iu", "gm", "s", "y", "uv", "gg", "d"];

// Where the engine is more lenient than the standard, Fish follows the standard: under \`u\` or
// \`v\`, an escaped character outside ASCII, and a class under \`v\` mixing a union with \`--\`.
const LENIENT = (p: string, f: string) => (/[uv]/.test(f) && /\\[^\x00-\x7f]/.test(p)) || (f.includes("v") && /\[[^\]]*[^\[\]]\[[^\]]*\]--/.test(p));

test("regex syntax is accepted and refused as JavaScript does", () => {
  let seed = 12345;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const wrong: string[] = [];
  for (let i = 0; i < 20000; i++) {
    let p = "";
    for (let k = random(8) + 1; k > 0; k--) p += PIECES[random(PIECES.length)];
    const f = FLAGS[random(FLAGS.length)]!;
    let js = true;
    try {
      new RegExp(p, f);
    } catch {
      js = false;
    }
    let fish = true;
    try {
      parsePattern(p, f);
    } catch (e) {
      if (!(e instanceof RegexSyntaxError)) throw e;
      fish = false;
    }
    if (js !== fish && !LENIENT(p, f)) wrong.push(`/${p}/${f}: JavaScript ${js ? "accepts" : "refuses"} it`);
  }
  expect(wrong).toEqual([]);
});

// Patterns put together from atoms and quantifiers, each run against a short string by a Fish
// program and by the engine running the compiler, which must agree on every result.
const ATOMS = ["a", "b", "c", ".", "[ab]", "[^a]", "\\d", "\\w", "\\s", "\\b", "\\B", "^", "$", "(a)", "(b|c)", "(?:ab)", "(a|)", "(?<n>a)", "\\1", "\\k<n>", "(?=a)", "(?!b)", "(?<=a)", "(?<!b)", "x", "\\n", "[a-c]", "(a*)", "(?:a|b)", "A", "😀", "[😀a]", "ß", "K", "k", "ſ", "s", "(?i:a)"];
const QUANTIFIERS = ["", "", "", "*", "+", "?", "{2}", "{1,2}", "{0,}", "*?", "+?", "??"];
const TEXT = [..."abc 1\nAaBb😀xßSsKkſ_"];
const MATCH_FLAGS = ["", "i", "m", "s", "u", "iu", "im", "su"];

function corpus(count: number): { p: string; f: string; s: string }[] {
  let seed = 3;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const out: { p: string; f: string; s: string }[] = [];
  while (out.length < count) {
    let p = "";
    for (let k = random(5) + 1; k > 0; k--) p += ATOMS[random(ATOMS.length)]! + QUANTIFIERS[random(QUANTIFIERS.length)]!;
    const f = MATCH_FLAGS[random(MATCH_FLAGS.length)]!;
    try {
      new RegExp(p, f);
      compile(parsePattern(p, f));
    } catch {
      continue;
    }
    let s = "";
    for (let k = random(8); k > 0; k--) s += TEXT[random(TEXT.length)];
    out.push({ p, f, s });
  }
  return out;
}

test("regex test agrees with JavaScript", async () => {
  const cases = corpus(400);
  const dir = mkdtempSync(join(tmpdir(), "fishc-regex-"));
  const file = join(dir, "corpus.fsh");
  writeFileSync(file, `function main() {\n${cases.map((c) => `  console.log(/${c.p}/${c.f}.test(${JSON.stringify(c.s)}));`).join("\n")}\n}\n`);
  await buildAsync(file, join(dir, "corpus"), false, "unwind", []);
  const run = Bun.spawnSync([join(dir, "corpus")], { env: { ...process.env, FISH_LEAKS: "1" } });
  const got = run.stdout.toString().trim().split("\n");
  const wrong = cases.flatMap((c, i) => (String(new RegExp(c.p, c.f).test(c.s)) === got[i] ? [] : [`/${c.p}/${c.f}.test(${JSON.stringify(c.s)}) gave ${got[i]}`]));
  expect(wrong).toEqual([]);
  expect(run.stderr.toString()).not.toContain("fish: leaked");
}, 60_000);
