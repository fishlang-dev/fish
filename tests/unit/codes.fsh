// The error codes: every code the compiler raises is in the table, and fishc explain prints each.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES, explain } from "../../src/codes.fsh";
import { newSession } from "../../src/compilation.fsh";
import { CompileError } from "../../src/diag.fsh";
import { analyze } from "../../src/main.fsh";
import { walk } from "../../src/nodes.fsh";
import { parse, type Expr, type Stmt } from "../../src/parser.fsh";
import { read, root, same } from "./support.fsh";

type Site = { site: string; codes: string[] | undefined };

// The codes an error's code argument gives as written: a code literal, a choice between code
// literals, or another error's `.code` passed on, which gives none of its own.
function codesIn(e: Ref<Expr> | undefined): string[] | undefined {
  if (e === undefined) return undefined;
  if (e.kind === "string") return [e.value];
  if (e.kind === "member" && e.name === "code") return [];
  if (e.kind !== "conditional") return undefined;
  const then = codesIn(e.then);
  const other = codesIn(e.else);
  if (then === undefined || other === undefined) return undefined;
  return [...then, ...other];
}

// The code each `new CompileError` in the compiler's source gives.
function codesGiven(): Site[] {
  let found: Site[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(join(root(), "src")).filter((f) => f.endsWith(".fsh"));
  } catch (e) {
    assert(false, e.message);
  }
  for (const f of files) {
    const text = read(join(root(), "src", f));
    let program: Stmt[] = [];
    try {
      program = parse(text, { last: 0 });
    } catch (e) {
      assert(false, `${f} doesn't parse: ${e.message}`);
    }
    walk({ of: "stmts", node: program }, (n) => {
      if (n.of !== "expr" || n.node.kind !== "new") return;
      const callee: Ref<Expr> = n.node.callee;
      if (callee.kind !== "ident" || callee.name !== "CompileError") return;
      const first: Ref<Expr> | undefined = n.node.args !== undefined ? n.node.args[0] : undefined;
      found.push({ site: `${f}:${text.slice(0, n.node.start as i64).split("\n").length}`, codes: codesIn(first) });
    });
  }
  return found;
}

test("every CompileError the compiler makes names a code the table has", () => {
  const sites = codesGiven();
  assert(sites.length > 1000, `only ${sites.length} sites`);
  let wrong: string[] = [];
  for (const s of sites) {
    if (s.codes === undefined || s.codes.some((c) => CODES[c] === undefined)) wrong.push(s.site);
  }
  same(wrong.join("\n"), "", "sites naming no code the table has");
});

test("every code in the table is given somewhere, and is numbered in its area", () => {
  let used = new Set<string>();
  for (const s of codesGiven()) {
    if (s.codes !== undefined) for (const c of s.codes) used.add(c);
  }
  const keys = Object.keys(CODES);
  same(keys.filter((c) => !used.has(c)).join(", "), "", "codes never given");
  same(keys.filter((c) => !/^(E(0\d|1[01])\d\d|W0\d\d\d)$/.test(c)).join(", "), "", "codes numbered outside their area");
  let titled: string[] = [];
  for (const c of keys) {
    const title = CODES[c]!.title;
    if (title === "" || title.endsWith(".")) titled.push(c);
  }
  same(titled.join(", "), "", "codes with an empty title or one ending in a full stop");
});

type Found = { error: string | undefined; warnings: string[] };

// The codes `src` is refused with, or warned with, when checked as a program in `dir`.
function codesOf(dir: string, name: string, src: string): Found {
  const file = join(dir, `${name}.fsh`);
  try {
    writeFileSync(file, src);
    return { error: undefined, warnings: analyze(newSession(), src, file).checked.warnings.map((w) => w.code) };
  } catch (e) {
    if (e instanceof CompileError) return { error: e.code, warnings: [] };
    assert(false, `${name}: ${e.message}`);
    return { error: undefined, warnings: [] };
  }
}

test("each explanation's example fails with its code, and its fixed program compiles without it", () => {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fish-codes-"));
  } catch (e) {
    assert(false, e.message);
  }
  let explained = 0;
  let wrong: string[] = [];
  for (const code of Object.keys(CODES)) {
    const long = CODES[code]!.long;
    if (long === undefined) continue;
    explained++;
    const example = codesOf(dir, `${code}-example`, long.example);
    const fixed = codesOf(dir, `${code}-fixed`, long.fixed);
    const failed = code.startsWith("W") ? (example.warnings.includes(code) ? code : undefined) : example.error;
    const still = fixed.error ?? (fixed.warnings.includes(code) ? code : undefined);
    if (failed !== code || still !== undefined) wrong.push(`${code}: the example gives ${failed ?? "nothing"}, the fixed program ${still ?? "nothing"}`);
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
  assert(explained >= 20, `only ${explained} codes are explained`);
  same(wrong.join("\n"), "", "explanations");
});

test("explain gives a code's explanation, its title alone when it has none, and nothing for an unknown code", () => {
  same((explain("e0201") ?? "").split("\n")[0]!, "E0201: use of a moved value", "a lowercase code");
  assert((explain("E0201") ?? "").includes("\nFor example, this fails:\n\n    function main() {\n"), "an error's example");
  assert((explain("W0001") ?? "").includes("For example, this warns:"), "a warning's example");
  same(explain("E0110") ?? "undefined", "E0110: a number that doesn't fit its type\n\nThis code has no longer explanation yet; its message says what went wrong and what to change.", "a code with no explanation");
  assert(explain("E9999") === undefined, "an unknown code");
});
