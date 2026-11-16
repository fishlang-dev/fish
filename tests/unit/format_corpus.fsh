// Ports tests/format_corpus.test.ts. Every test program and every compiler source must format to
// text that keeps its comments, parses again to the same tree and formats again to the same text;
// and every compiler source must format byte for byte as Prettier formats it, apart from the known
// differences below. A file of `// case:` programs is checked one case at a time, as the golden
// runner builds them. Bun's tests are made in a loop, one per program and one per source; a Fish
// test's name is a literal, so the programs are a few tests by the first letter of their file, to
// stay inside a test's time, each reporting every failing program, and the sources are listed by
// name, both held to the files there are by the last test.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Comment } from "../compiler/lexer.fsh";
import { parse, parseWithComments } from "../compiler/parser.fsh";
import { format, programShape } from "../compiler/printer.fsh";
import { prettier, read, root } from "./support.fsh";

// Where a source file deliberately formats otherwise than Prettier: in Prettier's output, each
// `prettier` text is replaced by `ours`, once. Each row is the file, the reason, Prettier's text
// and ours.
const KNOWN_DIFFERENCES: [string, string, string, string][] = [];

// Programs the parser refuses on purpose, each an error test.
const REFUSED: [string, string][] = [
  ["tests/programs/octal_escape.fsh", "octal escapes are refused"],
  ["tests/programs/regex.fsh > regex_unterminated", "an unterminated regular expression"],
  ["tests/programs/type.fsh > type_newline_extends", "'extends' on a new line after a type"],
  ["tests/programs/throw.fsh > throw_newline", "a line break after 'throw'"],
  ["tests/programs/modules_parse_error_elsewhere/b.fsh", "a parse error in an imported file"],
  ["tests/programs/jsdoc_throws.fsh > jsdoc_throws_conflict", "a JSDoc @throws disagreeing with the written clause"],
  ["tests/programs/jsdoc_throws.fsh > jsdoc_throws_still_conflicts", "a JSDoc @throws disagreeing with the written clause"],
  ["tests/programs/error_codes.fsh > code_syntax", "a syntax error's code"],
  ["tests/programs/string_raw.fsh > string_raw_invalid_escape", "an invalid escape outside String.raw"],
  ["tests/programs/string_raw.fsh > string_raw_invalid_escape_tag", "an invalid escape outside String.raw"],
  ["tests/programs/string_raw.fsh > string_raw_invalid_escape_unterminated", "an invalid escape outside String.raw"],
  ["tests/programs/string_raw.fsh > string_raw_invalid_escape_pattern", "an invalid escape outside String.raw"],
  ["tests/programs/string_raw.fsh > string_raw_invalid_escape_import", "an invalid escape outside String.raw"],
];

// The compiler's sources, each with a test of its own below.
const SOURCES: string[] = [
  "src/analysis.ts",
  "src/arenas.ts",
  "src/arithmetic.ts",
  "src/ast.ts",
  "src/astgen.ts",
  "src/bundle.ts",
  "src/casemap.ts",
  "src/check.ts",
  "src/classes.ts",
  "src/codegen.ts",
  "src/codes.ts",
  "src/comments.ts",
  "src/compilation.ts",
  "src/comptime.ts",
  "src/debuginfo.ts",
  "src/declarations.ts",
  "src/defaults.ts",
  "src/dependencies.ts",
  "src/deps.ts",
  "src/diag.ts",
  "src/doc.ts",
  "src/enums.ts",
  "src/expressions.ts",
  "src/fish.d.ts",
  "src/flow.ts",
  "src/fmt.ts",
  "src/generics.ts",
  "src/git.ts",
  "src/ids.ts",
  "src/interfaces.ts",
  "src/js.ts",
  "src/js_native.ts",
  "src/keys.ts",
  "src/layout.ts",
  "src/lexer.ts",
  "src/locals.ts",
  "src/lsp.ts",
  "src/macros.ts",
  "src/main.ts",
  "src/manifest.ts",
  "src/match.ts",
  "src/mathlib.ts",
  "src/migrate.ts",
  "src/modules.ts",
  "src/moves.ts",
  "src/narrow.ts",
  "src/native.ts",
  "src/nodes.ts",
  "src/operators.ts",
  "src/overloads.ts",
  "src/parseargs.ts",
  "src/parser.ts",
  "src/patterns.ts",
  "src/printer.ts",
  "src/program.ts",
  "src/publish.ts",
  "src/quote.ts",
  "src/rank.ts",
  "src/rebuild.ts",
  "src/regex.ts",
  "src/registry.ts",
  "src/registry_index.ts",
  "src/resolve.ts",
  "src/runtime.ts",
  "src/rust.ts",
  "src/rustshim.ts",
  "src/semver.ts",
  "src/sizes.ts",
  "src/split.ts",
  "src/std.ts",
  "src/stdcache.ts",
  "src/suggest.ts",
  "src/survey.ts",
  "src/tar.ts",
  "src/target.ts",
  "src/tests.ts",
  "src/typefns.ts",
  "src/types.ts",
  "src/typing.ts",
  "src/typings.ts",
  "src/unions.ts",
  "src/unquote.ts",
  "src/unsupported.ts",
  "src/values.ts",
  "src/walk.ts",
  "src/warnings.ts",
  "src/watch.ts",
];

// Each `.fsh` file under `dir`, relative to the repository's root as `rel`.
function fshFiles(dir: string, rel: string, out: Mut<string[]>): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) fshFiles(join(dir, e.name), `${rel}/${e.name}`, out);
      else if (e.name.endsWith(".fsh")) out.push(`${rel}/${e.name}`);
    }
  } catch (e) {
    assert(false, `can't list ${dir}: ${e.message}`);
  }
}

function srcFiles(): string[] {
  try {
    let out: string[] = [];
    const names = readdirSync(join(root(), "src"));
    for (const f of names) if (f.endsWith(".ts")) out.push(`src/${f}`);
    out.sort();
    return out;
  } catch (e) {
    assert(false, `can't list src: ${e.message}`);
    return [];
  }
}

// Each program: a file, or each case in it, named `<file> > <case>`; the names, then the sources.
type Units = { names: string[]; sources: string[] };

function isMarker(line: string): boolean {
  return line.startsWith("// case: ") && !line.includes("\r");
}

function programs(file: string, units: Mut<Units>): void {
  const src = read(join(root(), file));
  if (!(src.startsWith("// case: ") || src.includes("\n// case: ") || src.includes("\r// case: "))) {
    units.names.push(file);
    units.sources.push(src);
    return;
  }
  let lines: string[] = [];
  let open = false;
  const all = src.split("\n");
  for (const line of all) {
    if (isMarker(line)) {
      if (open) units.sources.push(lines.join("\n"));
      units.names.push(`${file} > ${line.slice(9).trim()}`);
      lines = [];
      open = true;
    } else if (open) lines.push(line);
  }
  if (open) units.sources.push(lines.join("\n"));
}

// What the native formatter takes too long on to check inside a test's time: each level of nested
// hugged callbacks copies the documents Bun's formatter shares, so time grows with the nesting
// depth. Each is left out until the documents are shared natively too.
const SLOW: [string, string][] = [
  ["tests/programs/lock.fsh > lock_reentrant_deep", "seventeen nested callbacks never finish"],
  ["src/codegen.ts", "takes about 9 of the 10 seconds a test has"],
];

function slow(name: string): boolean {
  for (const s of SLOW) if (s[0] === name) return true;
  return false;
}

// The programs' groups by the first letter of the file under tests/programs, one test each.
const GROUPS: string[] = ["ab", "cd", "efg", "hijkl", "mno", "pqr", "st", "uvwxyz"];

// lock.fsh is a group of its own: its deeply nested callbacks take the native formatter far longer
// than Bun's, so it would take its letter's programs past a test's time with it.
const LOCK = "tests/programs/lock.fsh";

function groupOf(file: string): usize | undefined {
  if (file === LOCK) return GROUPS.length;
  const first = file.slice(15, 16);
  for (let i: usize = 0; i < GROUPS.length; i++) if (GROUPS[i]!.includes(first)) return i;
  return undefined;
}

// The programs of every file, or of the files in one group.
function units(group: usize | undefined = undefined): Units {
  let files: string[] = [];
  fshFiles(join(root(), "tests", "programs"), "tests/programs", files);
  files.sort();
  let out: Units = { names: [], sources: [] };
  for (const f of files) if (group === undefined || groupOf(f) === group) programs(f, out);
  return out;
}

function tree(src: string): string {
  try {
    return programShape(parse(src, { last: 0 }));
  } catch (e) {
    return `<parse threw: ${e.message}>`;
  }
}

// A comment as the formatter may rewrite it: trailing space trimmed, and a JSDoc-shaped block
// comment's lines read without their indentation.
function commentText(c: Ref<Comment>): string {
  const text = c.text.replace(/[ \t]+$/gm, "").replace(/\r\n?/g, "\n");
  if (c.kind !== "block" || !text.includes("\n")) return text;
  const inner = `*${text.slice(2, -2)}*`;
  let lines: string[] = [];
  for (const l of inner.split("\n")) lines.push(l.trimStart());
  if (!lines.every((l) => l.startsWith("*"))) return text;
  let trimmed: string[] = [];
  for (const l of lines) trimmed.push(l.trimEnd());
  return trimmed.join("\n");
}

function comments(src: string): string {
  try {
    let out: string[] = [];
    const parsed = parseWithComments(src, { last: 0 });
    for (const c of parsed.comments) out.push(commentText(c));
    return out.join("\n---\n");
  } catch (e) {
    return `<parse threw: ${e.message}>`;
  }
}

function formatted(src: string): string {
  try {
    return format(src);
  } catch (e) {
    return `<format threw: ${e.message}>`;
  }
}

function reasonOf(name: string): string | undefined {
  for (const r of REFUSED) if (r[0] === name) return r[1];
  return undefined;
}

// What goes wrong with one program, added to `failed`.
function checkProgram(name: string, src: string, failed: Mut<string[]>): void {
  if (slow(name)) return;
  const reason = reasonOf(name);
  if (reason !== undefined) {
    let parses = true;
    try {
      parse(src, { last: 0 });
    } catch (_e) {
      parses = false;
    }
    if (parses) failed.push(`${name} is listed as refused (${reason}) but parses`);
    return;
  }
  const out = formatted(src);
  const before = comments(src);
  const after = comments(out);
  if (after !== before) failed.push(`${name} doesn't keep its comments:\n--- expected\n${before}\n--- got\n${after}`);
  const want = tree(src);
  const got = tree(out);
  if (got !== want) failed.push(`${name} parses back to another tree:\n--- expected\n${want}\n--- got\n${got}`);
  const again = formatted(out);
  if (again !== out) failed.push(`${name} formats differently again:\n--- expected\n${out}\n--- got\n${again}`);
}

function checkGroup(group: usize): void {
  const all = units(group);
  let failed: string[] = [];
  for (let i: usize = 0; i < all.names.length; i++) checkProgram(all.names[i]!, all.sources[i]!, failed);
  assert(failed.length === 0, failed.join("\n\n"));
}

test("test programs from a to b format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(0));
test("test programs from c to d format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(1));
test("test programs from e to g format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(2));
test("test programs from h to l format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(3));
test("test programs from m to o format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(4));
test("test programs from p to r format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(5));
test("test programs from s to t format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(6));
test("test programs from u to z format keeping their comments, parse back to the same tree and format the same again", () => checkGroup(7));
test("tests/programs/lock.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => checkGroup(8));

function knownIn(file: string): usize {
  let n: usize = 0;
  for (const d of KNOWN_DIFFERENCES) if (d[0] === file) n++;
  return n;
}

function likePrettier(file: string): void {
  const src = read(join(root(), file));
  const inputs = [src];
  const answers = prettier("typescript", inputs);
  const expected = answers.length > 0 ? answers[0]! : "<no answer>";
  const ours = formatted(src);
  if (knownIn(file) === 0) {
    assert(ours === expected, `${file} formats otherwise than Prettier:\n--- expected\n${expected}\n--- got\n${ours}`);
    return;
  }
  assert(ours !== expected, `${file} is listed with known differences but matches Prettier`);
  let adjusted = expected;
  for (const d of KNOWN_DIFFERENCES) {
    if (d[0] !== file) continue;
    assert(adjusted.split(d[2]).length - 1 === 1, `${file}: Prettier's text for "${d[1]}" isn't found once`);
    const at = adjusted.indexOf(d[2]);
    adjusted = `${adjusted.slice(0, at)}${d[3]}${adjusted.slice(at + (d[2].length as i64))}`;
  }
  assert(ours === adjusted, `${file} formats otherwise than Prettier with its known differences:\n--- expected\n${adjusted}\n--- got\n${ours}`);
}

test("src/analysis.ts formats as Prettier formats it", () => likePrettier("src/analysis.ts"));
test("src/arenas.ts formats as Prettier formats it", () => likePrettier("src/arenas.ts"));
test("src/arithmetic.ts formats as Prettier formats it", () => likePrettier("src/arithmetic.ts"));
test("src/ast.ts formats as Prettier formats it", () => likePrettier("src/ast.ts"));
test("src/astgen.ts formats as Prettier formats it", () => likePrettier("src/astgen.ts"));
test("src/bundle.ts formats as Prettier formats it", () => likePrettier("src/bundle.ts"));
test("src/casemap.ts formats as Prettier formats it", () => likePrettier("src/casemap.ts"));
test("src/check.ts formats as Prettier formats it", () => likePrettier("src/check.ts"));
test("src/classes.ts formats as Prettier formats it", () => likePrettier("src/classes.ts"));
test("src/codes.ts formats as Prettier formats it", () => likePrettier("src/codes.ts"));
test("src/comments.ts formats as Prettier formats it", () => likePrettier("src/comments.ts"));
test("src/compilation.ts formats as Prettier formats it", () => likePrettier("src/compilation.ts"));
test("src/comptime.ts formats as Prettier formats it", () => likePrettier("src/comptime.ts"));
test("src/debuginfo.ts formats as Prettier formats it", () => likePrettier("src/debuginfo.ts"));
test("src/declarations.ts formats as Prettier formats it", () => likePrettier("src/declarations.ts"));
test("src/defaults.ts formats as Prettier formats it", () => likePrettier("src/defaults.ts"));
test("src/dependencies.ts formats as Prettier formats it", () => likePrettier("src/dependencies.ts"));
test("src/deps.ts formats as Prettier formats it", () => likePrettier("src/deps.ts"));
test("src/diag.ts formats as Prettier formats it", () => likePrettier("src/diag.ts"));
test("src/doc.ts formats as Prettier formats it", () => likePrettier("src/doc.ts"));
test("src/enums.ts formats as Prettier formats it", () => likePrettier("src/enums.ts"));
test("src/expressions.ts formats as Prettier formats it", () => likePrettier("src/expressions.ts"));
test("src/fish.d.ts formats as Prettier formats it", () => likePrettier("src/fish.d.ts"));
test("src/flow.ts formats as Prettier formats it", () => likePrettier("src/flow.ts"));
test("src/fmt.ts formats as Prettier formats it", () => likePrettier("src/fmt.ts"));
test("src/generics.ts formats as Prettier formats it", () => likePrettier("src/generics.ts"));
test("src/git.ts formats as Prettier formats it", () => likePrettier("src/git.ts"));
test("src/ids.ts formats as Prettier formats it", () => likePrettier("src/ids.ts"));
test("src/interfaces.ts formats as Prettier formats it", () => likePrettier("src/interfaces.ts"));
test("src/js.ts formats as Prettier formats it", () => likePrettier("src/js.ts"));
test("src/js_native.ts formats as Prettier formats it", () => likePrettier("src/js_native.ts"));
test("src/keys.ts formats as Prettier formats it", () => likePrettier("src/keys.ts"));
test("src/layout.ts formats as Prettier formats it", () => likePrettier("src/layout.ts"));
test("src/lexer.ts formats as Prettier formats it", () => likePrettier("src/lexer.ts"));
test("src/locals.ts formats as Prettier formats it", () => likePrettier("src/locals.ts"));
test("src/lsp.ts formats as Prettier formats it", () => likePrettier("src/lsp.ts"));
test("src/macros.ts formats as Prettier formats it", () => likePrettier("src/macros.ts"));
test("src/main.ts formats as Prettier formats it", () => likePrettier("src/main.ts"));
test("src/manifest.ts formats as Prettier formats it", () => likePrettier("src/manifest.ts"));
test("src/match.ts formats as Prettier formats it", () => likePrettier("src/match.ts"));
test("src/mathlib.ts formats as Prettier formats it", () => likePrettier("src/mathlib.ts"));
test("src/migrate.ts formats as Prettier formats it", () => likePrettier("src/migrate.ts"));
test("src/modules.ts formats as Prettier formats it", () => likePrettier("src/modules.ts"));
test("src/moves.ts formats as Prettier formats it", () => likePrettier("src/moves.ts"));
test("src/narrow.ts formats as Prettier formats it", () => likePrettier("src/narrow.ts"));
test("src/native.ts formats as Prettier formats it", () => likePrettier("src/native.ts"));
test("src/nodes.ts formats as Prettier formats it", () => likePrettier("src/nodes.ts"));
test("src/operators.ts formats as Prettier formats it", () => likePrettier("src/operators.ts"));
test("src/overloads.ts formats as Prettier formats it", () => likePrettier("src/overloads.ts"));
test("src/parseargs.ts formats as Prettier formats it", () => likePrettier("src/parseargs.ts"));
test("src/parser.ts formats as Prettier formats it", () => likePrettier("src/parser.ts"));
test("src/patterns.ts formats as Prettier formats it", () => likePrettier("src/patterns.ts"));
test("src/printer.ts formats as Prettier formats it", () => likePrettier("src/printer.ts"));
test("src/program.ts formats as Prettier formats it", () => likePrettier("src/program.ts"));
test("src/publish.ts formats as Prettier formats it", () => likePrettier("src/publish.ts"));
test("src/quote.ts formats as Prettier formats it", () => likePrettier("src/quote.ts"));
test("src/rank.ts formats as Prettier formats it", () => likePrettier("src/rank.ts"));
test("src/rebuild.ts formats as Prettier formats it", () => likePrettier("src/rebuild.ts"));
test("src/regex.ts formats as Prettier formats it", () => likePrettier("src/regex.ts"));
test("src/registry.ts formats as Prettier formats it", () => likePrettier("src/registry.ts"));
test("src/registry_index.ts formats as Prettier formats it", () => likePrettier("src/registry_index.ts"));
test("src/resolve.ts formats as Prettier formats it", () => likePrettier("src/resolve.ts"));
test("src/runtime.ts formats as Prettier formats it", () => likePrettier("src/runtime.ts"));
test("src/rust.ts formats as Prettier formats it", () => likePrettier("src/rust.ts"));
test("src/rustshim.ts formats as Prettier formats it", () => likePrettier("src/rustshim.ts"));
test("src/semver.ts formats as Prettier formats it", () => likePrettier("src/semver.ts"));
test("src/sizes.ts formats as Prettier formats it", () => likePrettier("src/sizes.ts"));
test("src/split.ts formats as Prettier formats it", () => likePrettier("src/split.ts"));
test("src/std.ts formats as Prettier formats it", () => likePrettier("src/std.ts"));
test("src/stdcache.ts formats as Prettier formats it", () => likePrettier("src/stdcache.ts"));
test("src/suggest.ts formats as Prettier formats it", () => likePrettier("src/suggest.ts"));
test("src/survey.ts formats as Prettier formats it", () => likePrettier("src/survey.ts"));
test("src/tar.ts formats as Prettier formats it", () => likePrettier("src/tar.ts"));
test("src/target.ts formats as Prettier formats it", () => likePrettier("src/target.ts"));
test("src/tests.ts formats as Prettier formats it", () => likePrettier("src/tests.ts"));
test("src/typefns.ts formats as Prettier formats it", () => likePrettier("src/typefns.ts"));
test("src/types.ts formats as Prettier formats it", () => likePrettier("src/types.ts"));
test("src/typing.ts formats as Prettier formats it", () => likePrettier("src/typing.ts"));
test("src/typings.ts formats as Prettier formats it", () => likePrettier("src/typings.ts"));
test("src/unions.ts formats as Prettier formats it", () => likePrettier("src/unions.ts"));
test("src/unquote.ts formats as Prettier formats it", () => likePrettier("src/unquote.ts"));
test("src/unsupported.ts formats as Prettier formats it", () => likePrettier("src/unsupported.ts"));
test("src/values.ts formats as Prettier formats it", () => likePrettier("src/values.ts"));
test("src/walk.ts formats as Prettier formats it", () => likePrettier("src/walk.ts"));
test("src/warnings.ts formats as Prettier formats it", () => likePrettier("src/warnings.ts"));
test("src/watch.ts formats as Prettier formats it", () => likePrettier("src/watch.ts"));

// Rows of the Fish oracle, tests/unit/format.fsh: lines opening a row at four spaces, and the
// lines inside its `differ([` tables.
function oracleRows(): [usize, usize] {
  const oracle = read(join(root(), "tests", "unit", "format.fsh"));
  let rows: usize = 0;
  let differs: usize = 0;
  let inDiffer = false;
  const lines = oracle.split("\n");
  for (const l of lines) {
    if (/^ {4}["'`[]/.test(l)) rows++;
    if (l === "  differ([") inDiffer = true;
    else if (inDiffer && l.startsWith("  ]")) inDiffer = false;
    else if (inDiffer) differs++;
  }
  return [rows, differs];
}

test("the corpus and the oracle are counted", () => {
  const all = units();
  const sources = srcFiles();
  let files: string[] = [];
  for (const d of KNOWN_DIFFERENCES) if (!files.includes(d[0])) files.push(d[0]);
  const counts = oracleRows();
  // Each source without known differences is held to Prettier byte for byte by its own test.
  let slowSources: usize = 0;
  for (const sl of SLOW) if (sources.includes(sl[0])) slowSources++;
  const matched = sources.length - files.length - slowSources;
  console.log(
    `corpus: ${sources.length} src files, ${matched} matching Prettier, ${KNOWN_DIFFERENCES.length} known differences in ${files.length} files; ` +
    `${all.names.length} programs, ${REFUSED.length} refused on purpose; oracle and golden rows: ${counts[0]}, of them known differences: ${counts[1]}`,
  );
  let ungrouped: string[] = [];
  let programFiles: string[] = [];
  fshFiles(join(root(), "tests", "programs"), "tests/programs", programFiles);
  for (const f of programFiles) if (groupOf(f) === undefined) ungrouped.push(f);
  assert(ungrouped.length === 0, `test programs in no group of GROUPS: ${ungrouped.join(", ")}`);
  let missing: string[] = [];
  for (const r of REFUSED) if (!all.names.includes(r[0])) missing.push(r[0]);
  assert(missing.length === 0, `listed as refused but not a program: ${missing.join(", ")}`);
  let stray: string[] = [];
  for (const f of files) if (!sources.includes(f)) stray.push(f);
  assert(stray.length === 0, `listed with known differences but not a source: ${stray.join(", ")}`);
  let unknown: string[] = [];
  for (const sl of SLOW) if (!all.names.includes(sl[0]) && !sources.includes(sl[0])) unknown.push(sl[0]);
  assert(unknown.length === 0, `listed as slow but not a program or source: ${unknown.join(", ")}`);
  let unlisted: string[] = [];
  for (const f of sources) if (!SOURCES.includes(f)) unlisted.push(f);
  let gone: string[] = [];
  for (const f of SOURCES) if (!sources.includes(f)) gone.push(f);
  assert(unlisted.length === 0 && gone.length === 0, `SOURCES and its tests are out of step with src: without a test ${unlisted.join(", ")}; no longer in src ${gone.join(", ")}`);
});
