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
import type { Comment } from "../../src/lexer.fsh";
import { parse, parseWithComments } from "../../src/parser.fsh";
import { format, programShape } from "../../src/printer.fsh";
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
  "src/analysis.fsh",
  "src/arenas.fsh",
  "src/arithmetic.fsh",
  "src/ast.fsh",
  "src/astgen.fsh",
  "src/bundle.fsh",
  "src/casemap.fsh",
  "src/check.fsh",
  "src/classes.fsh",
  "src/codegen.fsh",
  "src/codes.fsh",
  "src/comments.fsh",
  "src/compilation.fsh",
  "src/comptime.fsh",
  "src/debuginfo.fsh",
  "src/declarations.fsh",
  "src/defaults.fsh",
  "src/dependencies.fsh",
  "src/deps.fsh",
  "src/diag.fsh",
  "src/edits.fsh",
  "src/doc.fsh",
  "src/enums.fsh",
  "src/expressions.fsh",
  "src/fish.d.ts",
  "src/flow.fsh",
  "src/fmt.fsh",
  "src/generics.fsh",
  "src/git.fsh",
  "src/ids.fsh",
  "src/incremental.fsh",
  "src/interfaces.fsh",
  "src/js.fsh",
  "src/js_native.fsh",
  "src/keys.fsh",
  "src/layout.fsh",
  "src/lexer.fsh",
  "src/locals.fsh",
  "src/lsp.fsh",
  "src/macros.fsh",
  "src/main.fsh",
  "src/manifest.fsh",
  "src/match.fsh",
  "src/mathlib.fsh",
  "src/migrate.fsh",
  "src/modules.fsh",
  "src/moves.fsh",
  "src/narrow.fsh",
  "src/native.fsh",
  "src/nodes.fsh",
  "src/operators.fsh",
  "src/overloads.fsh",
  "src/parseargs.fsh",
  "src/parser.fsh",
  "src/patterns.fsh",
  "src/printer.fsh",
  "src/program.fsh",
  "src/publish.fsh",
  "src/quote.fsh",
  "src/rank.fsh",
  "src/rebuild.fsh",
  "src/regex.fsh",
  "src/registry.fsh",
  "src/registry_index.fsh",
  "src/resolve.fsh",
  "src/runtime.fsh",
  "src/rust.fsh",
  "src/rustshim.fsh",
  "src/semver.fsh",
  "src/sizes.fsh",
  "src/split.fsh",
  "src/std.fsh",
  "src/stdcache.fsh",
  "src/suggest.fsh",
  "src/survey.fsh",
  "src/tar.fsh",
  "src/target.fsh",
  "src/tests.fsh",
  "src/typefns.fsh",
  "src/types.fsh",
  "src/typing.fsh",
  "src/typings.fsh",
  "src/unions.fsh",
  "src/unquote.fsh",
  "src/unsupported.fsh",
  "src/values.fsh",
  "src/walk.fsh",
  "src/warnings.fsh",
  "src/watch.fsh",
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
    for (const f of names) if (f.endsWith(".fsh") || f.endsWith(".ts")) out.push(`src/${f}`);
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
  ["src/codegen.fsh", "takes about 9 of the 10 seconds a test has"],
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

test("src/analysis.fsh formats as Prettier formats it", () => likePrettier("src/analysis.fsh"));
test("src/arenas.fsh formats as Prettier formats it", () => likePrettier("src/arenas.fsh"));
test("src/arithmetic.fsh formats as Prettier formats it", () => likePrettier("src/arithmetic.fsh"));
test("src/ast.fsh formats as Prettier formats it", () => likePrettier("src/ast.fsh"));
test("src/astgen.fsh formats as Prettier formats it", () => likePrettier("src/astgen.fsh"));
test("src/bundle.fsh formats as Prettier formats it", () => likePrettier("src/bundle.fsh"));
test("src/casemap.fsh formats as Prettier formats it", () => likePrettier("src/casemap.fsh"));
test("src/check.fsh formats as Prettier formats it", () => likePrettier("src/check.fsh"));
test("src/classes.fsh formats as Prettier formats it", () => likePrettier("src/classes.fsh"));
test("src/codes.fsh formats as Prettier formats it", () => likePrettier("src/codes.fsh"));
test("src/comments.fsh formats as Prettier formats it", () => likePrettier("src/comments.fsh"));
test("src/compilation.fsh formats as Prettier formats it", () => likePrettier("src/compilation.fsh"));
test("src/comptime.fsh formats as Prettier formats it", () => likePrettier("src/comptime.fsh"));
test("src/debuginfo.fsh formats as Prettier formats it", () => likePrettier("src/debuginfo.fsh"));
test("src/declarations.fsh formats as Prettier formats it", () => likePrettier("src/declarations.fsh"));
test("src/defaults.fsh formats as Prettier formats it", () => likePrettier("src/defaults.fsh"));
test("src/dependencies.fsh formats as Prettier formats it", () => likePrettier("src/dependencies.fsh"));
test("src/deps.fsh formats as Prettier formats it", () => likePrettier("src/deps.fsh"));
test("src/diag.fsh formats as Prettier formats it", () => likePrettier("src/diag.fsh"));
test("src/edits.fsh formats as Prettier formats it", () => likePrettier("src/edits.fsh"));
test("src/doc.fsh formats as Prettier formats it", () => likePrettier("src/doc.fsh"));
test("src/enums.fsh formats as Prettier formats it", () => likePrettier("src/enums.fsh"));
test("src/expressions.fsh formats as Prettier formats it", () => likePrettier("src/expressions.fsh"));
test("src/fish.d.ts formats as Prettier formats it", () => likePrettier("src/fish.d.ts"));
test("src/flow.fsh formats as Prettier formats it", () => likePrettier("src/flow.fsh"));
test("src/fmt.fsh formats as Prettier formats it", () => likePrettier("src/fmt.fsh"));
test("src/generics.fsh formats as Prettier formats it", () => likePrettier("src/generics.fsh"));
test("src/git.fsh formats as Prettier formats it", () => likePrettier("src/git.fsh"));
test("src/ids.fsh formats as Prettier formats it", () => likePrettier("src/ids.fsh"));
test("src/incremental.fsh formats as Prettier formats it", () => likePrettier("src/incremental.fsh"));
test("src/interfaces.fsh formats as Prettier formats it", () => likePrettier("src/interfaces.fsh"));
test("src/js.fsh formats as Prettier formats it", () => likePrettier("src/js.fsh"));
test("src/js_native.fsh formats as Prettier formats it", () => likePrettier("src/js_native.fsh"));
test("src/keys.fsh formats as Prettier formats it", () => likePrettier("src/keys.fsh"));
test("src/layout.fsh formats as Prettier formats it", () => likePrettier("src/layout.fsh"));
test("src/lexer.fsh formats as Prettier formats it", () => likePrettier("src/lexer.fsh"));
test("src/locals.fsh formats as Prettier formats it", () => likePrettier("src/locals.fsh"));
test("src/lsp.fsh formats as Prettier formats it", () => likePrettier("src/lsp.fsh"));
test("src/macros.fsh formats as Prettier formats it", () => likePrettier("src/macros.fsh"));
test("src/main.fsh formats as Prettier formats it", () => likePrettier("src/main.fsh"));
test("src/manifest.fsh formats as Prettier formats it", () => likePrettier("src/manifest.fsh"));
test("src/match.fsh formats as Prettier formats it", () => likePrettier("src/match.fsh"));
test("src/mathlib.fsh formats as Prettier formats it", () => likePrettier("src/mathlib.fsh"));
test("src/migrate.fsh formats as Prettier formats it", () => likePrettier("src/migrate.fsh"));
test("src/modules.fsh formats as Prettier formats it", () => likePrettier("src/modules.fsh"));
test("src/moves.fsh formats as Prettier formats it", () => likePrettier("src/moves.fsh"));
test("src/narrow.fsh formats as Prettier formats it", () => likePrettier("src/narrow.fsh"));
test("src/native.fsh formats as Prettier formats it", () => likePrettier("src/native.fsh"));
test("src/nodes.fsh formats as Prettier formats it", () => likePrettier("src/nodes.fsh"));
test("src/operators.fsh formats as Prettier formats it", () => likePrettier("src/operators.fsh"));
test("src/overloads.fsh formats as Prettier formats it", () => likePrettier("src/overloads.fsh"));
test("src/parseargs.fsh formats as Prettier formats it", () => likePrettier("src/parseargs.fsh"));
test("src/parser.fsh formats as Prettier formats it", () => likePrettier("src/parser.fsh"));
test("src/patterns.fsh formats as Prettier formats it", () => likePrettier("src/patterns.fsh"));
test("src/printer.fsh formats as Prettier formats it", () => likePrettier("src/printer.fsh"));
test("src/program.fsh formats as Prettier formats it", () => likePrettier("src/program.fsh"));
test("src/publish.fsh formats as Prettier formats it", () => likePrettier("src/publish.fsh"));
test("src/quote.fsh formats as Prettier formats it", () => likePrettier("src/quote.fsh"));
test("src/rank.fsh formats as Prettier formats it", () => likePrettier("src/rank.fsh"));
test("src/rebuild.fsh formats as Prettier formats it", () => likePrettier("src/rebuild.fsh"));
test("src/regex.fsh formats as Prettier formats it", () => likePrettier("src/regex.fsh"));
test("src/registry.fsh formats as Prettier formats it", () => likePrettier("src/registry.fsh"));
test("src/registry_index.fsh formats as Prettier formats it", () => likePrettier("src/registry_index.fsh"));
test("src/resolve.fsh formats as Prettier formats it", () => likePrettier("src/resolve.fsh"));
test("src/runtime.fsh formats as Prettier formats it", () => likePrettier("src/runtime.fsh"));
test("src/rust.fsh formats as Prettier formats it", () => likePrettier("src/rust.fsh"));
test("src/rustshim.fsh formats as Prettier formats it", () => likePrettier("src/rustshim.fsh"));
test("src/semver.fsh formats as Prettier formats it", () => likePrettier("src/semver.fsh"));
test("src/sizes.fsh formats as Prettier formats it", () => likePrettier("src/sizes.fsh"));
test("src/split.fsh formats as Prettier formats it", () => likePrettier("src/split.fsh"));
test("src/std.fsh formats as Prettier formats it", () => likePrettier("src/std.fsh"));
test("src/stdcache.fsh formats as Prettier formats it", () => likePrettier("src/stdcache.fsh"));
test("src/suggest.fsh formats as Prettier formats it", () => likePrettier("src/suggest.fsh"));
test("src/survey.fsh formats as Prettier formats it", () => likePrettier("src/survey.fsh"));
test("src/tar.fsh formats as Prettier formats it", () => likePrettier("src/tar.fsh"));
test("src/target.fsh formats as Prettier formats it", () => likePrettier("src/target.fsh"));
test("src/tests.fsh formats as Prettier formats it", () => likePrettier("src/tests.fsh"));
test("src/typefns.fsh formats as Prettier formats it", () => likePrettier("src/typefns.fsh"));
test("src/types.fsh formats as Prettier formats it", () => likePrettier("src/types.fsh"));
test("src/typing.fsh formats as Prettier formats it", () => likePrettier("src/typing.fsh"));
test("src/typings.fsh formats as Prettier formats it", () => likePrettier("src/typings.fsh"));
test("src/unions.fsh formats as Prettier formats it", () => likePrettier("src/unions.fsh"));
test("src/unquote.fsh formats as Prettier formats it", () => likePrettier("src/unquote.fsh"));
test("src/unsupported.fsh formats as Prettier formats it", () => likePrettier("src/unsupported.fsh"));
test("src/values.fsh formats as Prettier formats it", () => likePrettier("src/values.fsh"));
test("src/walk.fsh formats as Prettier formats it", () => likePrettier("src/walk.fsh"));
test("src/warnings.fsh formats as Prettier formats it", () => likePrettier("src/warnings.fsh"));
test("src/watch.fsh formats as Prettier formats it", () => likePrettier("src/watch.fsh"));

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
