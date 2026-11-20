// Bun's tests ask the engine running them; these ask Bun, run as a child
// with each case in a JSON file, for what JavaScript makes of each case. The corpora are seeded
// with integer arithmetic and draw a case's text before its pattern is tried, so they hold
// different cases from Bun's, as many of them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../../src/diag.fsh";
import { build } from "../../src/main.fsh";
import { compile, parsePattern, type RegexTables } from "../../src/regex.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { same } from "./support.fsh";

type Case = { p: string; f: string; s: string };

function tables(): RegexTables {
  return { properties: new Map(), folds: new Map() };
}

// What JavaScript makes of each case, read by `mode`: "refused" for a pattern it refuses, and
// otherwise "accepted", or the line the Fish program for that mode should print for it. A lone
// surrogate can't cross UTF-8, so it's compared as the U+FFFD that either engine prints for it.
function oracle(): string {
  return `const [mode, file] = process.argv.slice(2);
const cases = JSON.parse(require("fs").readFileSync(file, "utf8"));
console.log(JSON.stringify(cases.map(([p, f, s]) => answer(p, f, s).toWellFormed())));
function answer(p, f, s) {
  let re;
  try {
    re = (g) => new RegExp(p, g + f);
    re("");
  } catch {
    return "refused";
  }
  if (mode === "syntax") return "accepted";
  if (mode === "test") return String(re("").test(s));
  if (mode === "exec") {
    const m = re("").exec(s);
    return m === null ? "null" : [m.index, ...m.map((x) => x ?? "-")].join(" ");
  }
  const each = [...s.matchAll(re("g"))].map((m) => m.index + ":" + m[0] + ";").join("");
  return [s.search(re("")), s.split(re("")).map((x) => x ?? "-").join("|"), (s.match(re("g")) ?? ["none"]).join("|"), each, s.replace(re("g"), "<$&|$1|$\`>"), s.replace(re(""), (m) => "[" + m + "]")].join(" ");
}
`;
}

function text(bytes: Ref<u8[]>): string {
  return new TextDecoder().decode(bytes);
}

function temp(): string {
  try {
    return mkdtempSync(join(tmpdir(), "fishc-regex-"));
  } catch (e) {
    assert(false, e.message);
    return "";
  }
}

function remove(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

// JavaScript's answer for each case, from Bun.
function asked(dir: string, mode: string, cases: Ref<Case[]>): string[] {
  try {
    const script = join(dir, "oracle.js");
    const file = join(dir, "cases.json");
    writeFileSync(script, oracle());
    writeFileSync(file, `[${cases.map((c) => `[${JSON.stringify(c.p)},${JSON.stringify(c.f)},${JSON.stringify(c.s)}]`).join(",\n")}]`);
    const run = spawnSync("bun", [script, mode, file]);
    const out = text(run.stdout);
    assert(run.status === 0, `bun failed: ${text(run.stderr)}`);
    return JSON.parse<string[]>(out);
  } catch (e) {
    assert(false, e.message);
    return [];
  }
}

const PIECES: string[] = ["a", "b", "\\", "(", ")", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?<m>", "\\k<n>", "\\k", "[", "]", "[^", "-", "^", "$", ".", "*", "+", "?", "{", "}", "{2}", "{1,3}", "{3,1}", "{2,}", "|", "\\d", "\\W", "\\b", "\\B", "\\1", "\\2", "\\0", "\\01", "\\8", "\\x4", "\\x41", "\\u0041", "\\u{41}", "\\uD83D\\uDE00", "\\c", "\\cA", "\\c1", "\\p{L}", "\\P{Lu}", "\\p{Foo}", "\\q{ab|c}", "&&", "--", "\\-", "\\/", "/", "😀", "\\n", "\\z", "(?i:", "(?-i:", "(?m-s:", "(?ii:", "[a-z]", "[z-a]", "[\\d-z]", "\\s", "_", "&", "!", "\\&", "[[a]--b]", "[\\q{}]", "[a&&&b]", "[a--b--c]", "[a&&b--c]", "[^\\q{ab}]", "(?<n>a)|(?<n>b)", "(?<\\u0061>"];
const FLAGS: string[] = ["", "u", "v", "i", "iu", "gm", "s", "y", "uv", "gg", "d"];

// Where the engine is more lenient than the standard, Fish follows the standard: under `u` or
// `v`, an escaped character outside ASCII, and a class under `v` mixing a union with `--`.
function lenient(p: string, f: string): boolean {
  return (/[uv]/.test(f) && /\\[^\x00-\x7f]/.test(p)) || (f.includes("v") && /\[[^\]]*[^\[\]]\[[^\]]*\]--/.test(p));
}

test("regex syntax is accepted and refused as JavaScript does", () => {
  let seed: i64 = 12345;
  const random = (n: usize): usize => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed % (n as i64)) as usize;
  };
  let cases: Case[] = [];
  for (let i = 0; i < 20000; i++) {
    let p = "";
    for (let k = random(8) + 1; k > 0; k--) p += PIECES[random(PIECES.length)]!;
    cases.push({ p, f: FLAGS[random(FLAGS.length)]!, s: "" });
  }
  const dir = temp();
  const js = asked(dir, "syntax", cases);
  remove(dir);
  let wrong: string[] = [];
  let t = tables();
  for (let i: usize = 0; i < cases.length; i++) {
    const c: Ref<Case> = cases[i]!;
    let fish = true;
    try {
      parsePattern(c.p, c.f, t);
    } catch (_e) {
      fish = false;
    }
    const accepts = js[i] === "accepted";
    if (accepts !== fish && !lenient(c.p, c.f)) wrong.push(`/${c.p}/${c.f}: JavaScript ${accepts ? "accepts" : "refuses"} it`);
  }
  assert(js.length === cases.length, `bun answered ${js.length} of ${cases.length} cases`);
  same(wrong.join("\n"), "", "patterns Fish judges differently");
});

const ATOMS: string[] = ["\\p{L}", "\\p{Lu}", "[\\p{L}--[a-z]]", "[\\q{ab|c}x]", "σ", "ς", "\\uD83D", "[😀-😂]", "a", "b", "c", ".", "[ab]", "[^a]", "\\d", "\\w", "\\s", "\\b", "\\B", "^", "$", "(a)", "(b|c)", "(?:ab)", "(a|)", "(?<n>a)", "\\1", "\\k<n>", "(?=a)", "(?!b)", "(?<=a)", "(?<!b)", "x", "\\n", "[a-c]", "(a*)", "(?:a|b)", "A", "😀", "[😀a]", "ß", "K", "k", "ſ", "s", "(?i:a)"];
const QUANTIFIERS: string[] = ["", "", "", "*", "+", "?", "{2}", "{1,2}", "{0,}", "*?", "+?", "??"];
const MATCH_FLAGS: string[] = ["", "i", "m", "s", "u", "iu", "im", "su", "v", "iv"];

function characters(): string[] {
  let out: string[] = [];
  for (const c of "abc 1\nAaBb😀😂xßSsKkſ_σΣςαΩ") out.push(c);
  return out;
}

// `count` patterns put together from atoms and quantifiers, each with a short string, that both
// Fish and JavaScript accept, with what JavaScript gives for each in `mode`.
function corpus(dir: string, mode: string, count: usize): { cases: Case[]; wants: string[] } {
  const chars = characters();
  let seed: i64 = 3;
  const random = (n: usize): usize => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed % (n as i64)) as usize;
  };
  let t = tables();
  let tried: Case[] = [];
  while (tried.length < count * 2) {
    let p = "";
    for (let k = random(5) + 1; k > 0; k--) p += ATOMS[random(ATOMS.length)]! + QUANTIFIERS[random(QUANTIFIERS.length)]!;
    const f = MATCH_FLAGS[random(MATCH_FLAGS.length)]!;
    let s = "";
    for (let k = random(8); k > 0; k--) s += chars[random(chars.length)]!;
    try {
      compile(parsePattern(p, f, t), t);
      tried.push({ p, f, s });
    } catch (_e) {}
  }
  const answers = asked(dir, mode, tried);
  let cases: Case[] = [];
  let wants: string[] = [];
  for (let i: usize = 0; i < tried.length && cases.length < count; i++) {
    if (answers[i] === "refused") continue;
    cases.push(tried[i]!.clone());
    wants.push(answers[i]!);
  }
  assert(cases.length === count, `only ${cases.length} cases both accept`);
  return { cases, wants };
}

// Builds `src` and runs it, giving its stdout, failing the test when it
// doesn't build or when it leaks.
function ran(dir: string, name: string, src: string): string {
  const file = join(dir, `${name}.fsh`);
  try {
    writeFileSync(file, src);
    build(cachedSession(), file, join(dir, name));
  } catch (e) {
    if (e instanceof CompileError) assert(false, formatError(e, file, src));
    else assert(false, e.message);
    return "";
  }
  const run = spawnSync("env", ["FISH_LEAKS=1", join(dir, name)]);
  assert(!text(run.stderr).includes("fish: leaked"), `${name} leaked: ${text(run.stderr)}`);
  return text(run.stdout);
}

// Each case whose printed line isn't JavaScript's. A line may hold a newline, so the output is
// read case by case from the front rather than split.
function disagreeing(cases: Ref<Case[]>, wants: Ref<string[]>, got: string, what: string): string {
  let wrong: string[] = [];
  let at: i64 = 0;
  for (let i: usize = 0; i < cases.length; i++) {
    const want = `${wants[i]!}\n`;
    if (got.slice(at, at + (want.length as i64)) === want) {
      at += want.length as i64;
      continue;
    }
    const end = got.indexOf("\n", at);
    const line = end < 0 ? got.slice(at) : got.slice(at, end);
    const c: Ref<Case> = cases[i]!;
    wrong.push(`/${c.p}/${c.f} ${what} ${JSON.stringify(c.s)} gave ${line}, not ${wants[i]!}`);
    at = end < 0 ? got.length as i64 : end + 1;
  }
  return wrong.join("\n");
}

test("regex test agrees with JavaScript", () => {
  const dir = temp();
  const { cases, wants } = corpus(dir, "test", 400);
  const body = cases.map((c) => `  console.log(/${c.p}/${c.f}.test(${JSON.stringify(c.s)}));`).join("\n");
  const got = ran(dir, "corpus", `function main() {\n${body}\n}\n`);
  remove(dir);
  same(disagreeing(cases, wants, got, "test on"), "", "results");
}, { timeout: 60_000 });

test("regex exec agrees with JavaScript", () => {
  const dir = temp();
  const { cases, wants } = corpus(dir, "exec", 400);
  let t = tables();
  let lines: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const c: Ref<Case> = cases[i]!;
    let parts = "";
    try {
      const captures = parsePattern(c.p, c.f, t).captures;
      for (let k: usize = 0; k < captures.length; k++) parts += captures[k]!.optional ? `, m${i}[${k + 1}] ?? "-"` : `, m${i}[${k + 1}]`;
    } catch (e) {
      assert(false, e.message);
    }
    lines.push(`  const m${i} = /${c.p}/${c.f}.exec(${JSON.stringify(c.s)});\n  if (m${i} === null) console.log("null"); else console.log(m${i}.index, m${i}[0]${parts});`);
  }
  const got = ran(dir, "exec", `function main() {\n${lines.join("\n")}\n}\n`);
  remove(dir);
  same(disagreeing(cases, wants, got, "exec on"), "", "results");
}, { timeout: 60_000 });

// Bun's 300 cases, built as two programs of 150, each case a function of its own, since building
// them all at once runs past the test runner's 10 seconds: each distinct regex costs codegen about
// 12ms, and clang is slow on one long function.
function methodsAgree(half: usize): void {
  const dir = temp();
  const whole = corpus(dir, "methods", 300);
  let cases: Case[] = [];
  let wants: string[] = [];
  for (let i: usize = half * 150; i < half * 150 + 150; i++) {
    cases.push(whole.cases[i]!.clone());
    wants.push(whole.wants[i]!.clone());
  }
  let t = tables();
  let lines: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const c: Ref<Case> = cases[i]!;
    const s = JSON.stringify(c.s);
    let optional = false;
    try {
      optional = parsePattern(c.p, c.f, t).captures.some((g) => g.optional);
    } catch (e) {
      assert(false, e.message);
    }
    const split = optional ? `${s}.split(/${c.p}/${c.f}).map((x) => x ?? "-").join("|")` : `${s}.split(/${c.p}/${c.f}).join("|")`;
    const all = `(${s}.match(/${c.p}/g${c.f}) ?? ["none"]).join("|")`;
    lines.push(`function case${i}() {\n  let each${i} = "";\n  for (const m of ${s}.matchAll(/${c.p}/g${c.f})) each${i} += m.index + ":" + m[0] + ";";\n` +
      `  console.log(${s}.search(/${c.p}/${c.f}), ${split}, ${all}, each${i}, ${s}.replace(/${c.p}/g${c.f}, "<$&|$1|$\`>"), ${s}.replace(/${c.p}/${c.f}, (m) => "[" + m + "]"));\n}`);
  }
  let calls: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) calls.push(`  case${i}();`);
  const got = ran(dir, "methods", `${lines.join("\n")}\nfunction main() {\n${calls.join("\n")}\n}\n`);
  remove(dir);
  same(disagreeing(cases, wants, got, "on"), "", "results");
}

test("string methods taking a regex agree with JavaScript", () => methodsAgree(0));

test("string methods taking a regex agree with JavaScript, the second 150 cases", () => methodsAgree(1));
