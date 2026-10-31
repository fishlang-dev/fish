import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/compilation.ts";
import { buildAsync } from "../src/main.ts";
import { compile, parsePattern, RegexSyntaxError, type RegexTables } from "../src/regex.ts";

const session = newSession();
const tables: RegexTables = { properties: new Map(), folds: new Map() };

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
      parsePattern(p, f, tables);
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
const ATOMS = ["\\p{L}", "\\p{Lu}", "[\\p{L}--[a-z]]", "[\\q{ab|c}x]", "σ", "ς", "\\uD83D", "[😀-😂]", "a", "b", "c", ".", "[ab]", "[^a]", "\\d", "\\w", "\\s", "\\b", "\\B", "^", "$", "(a)", "(b|c)", "(?:ab)", "(a|)", "(?<n>a)", "\\1", "\\k<n>", "(?=a)", "(?!b)", "(?<=a)", "(?<!b)", "x", "\\n", "[a-c]", "(a*)", "(?:a|b)", "A", "😀", "[😀a]", "ß", "K", "k", "ſ", "s", "(?i:a)"];
const QUANTIFIERS = ["", "", "", "*", "+", "?", "{2}", "{1,2}", "{0,}", "*?", "+?", "??"];
const TEXT = [..."abc 1\nAaBb😀😂xßSsKkſ_σΣςαΩ"];
const MATCH_FLAGS = ["", "i", "m", "s", "u", "iu", "im", "su", "v", "iv"];

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
      compile(parsePattern(p, f, tables), tables);
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
  await buildAsync(session, file, join(dir, "corpus"), false, "unwind", []);
  const run = Bun.spawnSync([join(dir, "corpus")], { env: { ...process.env, FISH_LEAKS: "1" } });
  const got = run.stdout.toString().replace(/\n$/, "").split("\n");
  const wrong = cases.flatMap((c, i) => (String(new RegExp(c.p, c.f).test(c.s)) === got[i] ? [] : [`/${c.p}/${c.f}.test(${JSON.stringify(c.s)}) gave ${got[i]}`]));
  expect(wrong).toEqual([]);
  expect(run.stderr.toString()).not.toContain("fish: leaked");
}, 60_000);

test("regex exec agrees with JavaScript", async () => {
  const cases = corpus(400);
  const dir = mkdtempSync(join(tmpdir(), "fishc-regex-"));
  const file = join(dir, "exec.fsh");
  const lines = cases.map((c, i) => {
    const parts = parsePattern(c.p, c.f, tables).captures.map((g, k) => (g.optional ? `, m${i}[${k + 1}] ?? "-"` : `, m${i}[${k + 1}]`)).join("");
    return `  const m${i} = /${c.p}/${c.f}.exec(${JSON.stringify(c.s)});\n  if (m${i} === null) console.log("null"); else console.log(m${i}.index, m${i}[0]${parts});`;
  });
  writeFileSync(file, `function main() {\n${lines.join("\n")}\n}\n`);
  await buildAsync(session, file, join(dir, "exec"), false, "unwind", []);
  const run = Bun.spawnSync([join(dir, "exec")], { env: { ...process.env, FISH_LEAKS: "1" } });
  const got = run.stdout.toString().replace(/\n$/, "").split("\n");
  const wrong = cases.flatMap((c, i) => {
    const m = new RegExp(c.p, c.f).exec(c.s);
    const want = m === null ? "null" : [m.index, ...m.map((x) => x ?? "-")].join(" ");
    return want === got[i] ? [] : [`/${c.p}/${c.f}.exec(${JSON.stringify(c.s)}) gave ${got[i]}, not ${want}`];
  });
  expect(wrong).toEqual([]);
  expect(run.stderr.toString()).not.toContain("fish: leaked");
}, 60_000);

test("string methods taking a regex agree with JavaScript", async () => {
  const cases = corpus(300);
  const dir = mkdtempSync(join(tmpdir(), "fishc-regex-"));
  const file = join(dir, "methods.fsh");
  const lines = cases.map((c, i) => {
    const s = JSON.stringify(c.s);
    const optional = parsePattern(c.p, c.f, tables).captures.some((g) => g.optional);
    const split = optional ? `${s}.split(/${c.p}/${c.f}).map((x) => x ?? "-").join("|")` : `${s}.split(/${c.p}/${c.f}).join("|")`;
    const all = `(${s}.match(/${c.p}/g${c.f}) ?? ["none"]).join("|")`;
    return `  let each${i} = "";\n  for (const m of ${s}.matchAll(/${c.p}/g${c.f})) each${i} += m.index + ":" + m[0] + ";";\n` +
      `  console.log(${s}.search(/${c.p}/${c.f}), ${split}, ${all}, each${i}, ${s}.replace(/${c.p}/g${c.f}, "<$&|$1|$\`>"), ${s}.replace(/${c.p}/${c.f}, (m) => "[" + m + "]"));`;
  });
  writeFileSync(file, `function main() {\n${lines.join("\n")}\n}\n`);
  await buildAsync(session, file, join(dir, "methods"), false, "unwind", []);
  const run = Bun.spawnSync([join(dir, "methods")], { env: { ...process.env, FISH_LEAKS: "1" } });
  const got = run.stdout.toString().replace(/\n$/, "").split("\n");
  const wrong = cases.flatMap((c, i) => {
    const re = (g: string) => new RegExp(c.p, g + c.f);
    const each = [...c.s.matchAll(re("g"))].map((m) => `${m.index}:${m[0]};`).join("");
    const want = [c.s.search(re("")), c.s.split(re("")).map((x) => x ?? "-").join("|"), (c.s.match(re("g")) ?? ["none"]).join("|"), each, c.s.replace(re("g"), "<$&|$1|$`>"), c.s.replace(re(""), (m) => "[" + m + "]")].join(" ");
    return want === got[i] ? [] : [`/${c.p}/${c.f} on ${JSON.stringify(c.s)} gave ${got[i]}, not ${want}`];
  });
  expect(wrong).toEqual([]);
  expect(run.stderr.toString()).not.toContain("fish: leaked");
}, 60_000);
