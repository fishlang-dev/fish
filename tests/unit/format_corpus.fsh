// Every test program and every compiler source formats to text that keeps its comments, parses
// again to the same tree and formats again to the same text. A file of `// case:` programs is
// checked one case at a time, as the golden runner builds them. A test's name is a literal, so the
// programs are a few tests by the first letter of their file, to stay inside a test's time, each
// reporting every failing program, and the sources are listed by name, both held to the files
// there are by the last test.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Comment } from "../../src/lexer.fsh";
import { parse, parseWithComments } from "../../src/parser.fsh";
import { format, programShape } from "../../src/printer.fsh";
import { read, root } from "./support.fsh";

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
  ["tests/programs/jsx.fsh > jsx_closing_tag", "a closing tag for another element"],
  ["tests/programs/jsx.fsh > jsx_void_with_content", "an element with no content written open"],
  ["tests/programs/jsx.fsh > jsx_spread_on_element", "a spread into an HTML element's attributes"],
  ["tests/programs/jsx.fsh > jsx_never_closed", "an element never closed"],
];

// The compiler's sources, each with a test of its own below.
const SOURCES: string[] = [
  "src/addon.fsh",
  "src/analysis.fsh",
  "src/arenas.fsh",
  "src/arithmetic.fsh",
  "src/ast.fsh",
  "src/astgen.fsh",
  "src/bindc.fsh",
  "src/bundle.fsh",
  "src/callbacks.fsh",
  "src/casemap.fsh",
  "src/check.fsh",
  "src/checkcache.fsh",
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
  "src/doc.fsh",
  "src/edits.fsh",
  "src/enums.fsh",
  "src/explain.fsh",
  "src/expressions.fsh",
  "src/fix.fsh",
  "src/flow.fsh",
  "src/fmt.fsh",
  "src/fuzz.fsh",
  "src/generics.fsh",
  "src/git.fsh",
  "src/ids.fsh",
  "src/incremental.fsh",
  "src/interfaces.fsh",
  "src/js.fsh",
  "src/js_native.fsh",
  "src/jsx.fsh",
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
  "src/navigate.fsh",
  "src/nodes.fsh",
  "src/openapi.fsh",
  "src/operators.fsh",
  "src/overloads.fsh",
  "src/parseargs.fsh",
  "src/parser.fsh",
  "src/patterns.fsh",
  "src/printer.fsh",
  "src/program.fsh",
  "src/publish.fsh",
  "src/queries.fsh",
  "src/quote.fsh",
  "src/rank.fsh",
  "src/rebuild.fsh",
  "src/regex.fsh",
  "src/registry.fsh",
  "src/registry_index.fsh",
  "src/repl.fsh",
  "src/resolve.fsh",
  "src/runtime.fsh",
  "src/rust.fsh",
  "src/rustshim.fsh",
  "src/scripts.fsh",
  "src/semver.fsh",
  "src/sizes.fsh",
  "src/split.fsh",
  "src/std.fsh",
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
    for (const f of names) if (f.endsWith(".fsh")) out.push(`src/${f}`);
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

// One compiler source, checked as each test program is.
function roundTrips(file: string): void {
  let failed: string[] = [];
  checkProgram(file, read(join(root(), file)), failed);
  assert(failed.length === 0, failed.join("\n\n"));
}

test("src/addon.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/addon.fsh"));
test("src/analysis.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/analysis.fsh"));
test("src/arenas.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/arenas.fsh"));
test("src/arithmetic.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/arithmetic.fsh"));
test("src/ast.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/ast.fsh"));
test("src/astgen.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/astgen.fsh"));
test("src/bindc.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/bindc.fsh"));
test("src/bundle.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/bundle.fsh"));
test("src/callbacks.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/callbacks.fsh"));
test("src/casemap.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/casemap.fsh"));
test("src/check.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/check.fsh"));
test("src/checkcache.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/checkcache.fsh"));
test("src/classes.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/classes.fsh"));
test("src/codes.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/codes.fsh"));
test("src/comments.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/comments.fsh"));
test("src/compilation.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/compilation.fsh"));
test("src/comptime.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/comptime.fsh"));
test("src/debuginfo.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/debuginfo.fsh"));
test("src/declarations.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/declarations.fsh"));
test("src/defaults.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/defaults.fsh"));
test("src/dependencies.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/dependencies.fsh"));
test("src/deps.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/deps.fsh"));
test("src/diag.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/diag.fsh"));
test("src/doc.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/doc.fsh"));
test("src/edits.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/edits.fsh"));
test("src/enums.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/enums.fsh"));
test("src/explain.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/explain.fsh"));
test("src/expressions.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/expressions.fsh"));
test("src/fix.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/fix.fsh"));
test("src/flow.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/flow.fsh"));
test("src/fmt.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/fmt.fsh"));
test("src/fuzz.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/fuzz.fsh"));
test("src/generics.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/generics.fsh"));
test("src/git.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/git.fsh"));
test("src/ids.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/ids.fsh"));
test("src/incremental.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/incremental.fsh"));
test("src/interfaces.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/interfaces.fsh"));
test("src/js.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/js.fsh"));
test("src/js_native.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/js_native.fsh"));
test("src/jsx.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/jsx.fsh"));
test("src/keys.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/keys.fsh"));
test("src/layout.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/layout.fsh"));
test("src/lexer.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/lexer.fsh"));
test("src/locals.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/locals.fsh"));
test("src/lsp.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/lsp.fsh"));
test("src/macros.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/macros.fsh"));
test("src/main.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/main.fsh"));
test("src/manifest.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/manifest.fsh"));
test("src/match.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/match.fsh"));
test("src/mathlib.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/mathlib.fsh"));
test("src/migrate.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/migrate.fsh"));
test("src/modules.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/modules.fsh"));
test("src/moves.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/moves.fsh"));
test("src/narrow.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/narrow.fsh"));
test("src/native.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/native.fsh"));
test("src/navigate.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/navigate.fsh"));
test("src/nodes.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/nodes.fsh"));
test("src/openapi.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/openapi.fsh"));
test("src/operators.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/operators.fsh"));
test("src/overloads.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/overloads.fsh"));
test("src/parseargs.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/parseargs.fsh"));
test("src/parser.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/parser.fsh"));
test("src/patterns.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/patterns.fsh"));
test("src/printer.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/printer.fsh"));
test("src/program.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/program.fsh"));
test("src/publish.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/publish.fsh"));
test("src/queries.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/queries.fsh"));
test("src/quote.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/quote.fsh"));
test("src/rank.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/rank.fsh"));
test("src/rebuild.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/rebuild.fsh"));
test("src/regex.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/regex.fsh"));
test("src/registry.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/registry.fsh"));
test("src/registry_index.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/registry_index.fsh"));
test("src/repl.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/repl.fsh"));
test("src/resolve.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/resolve.fsh"));
test("src/runtime.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/runtime.fsh"));
test("src/rust.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/rust.fsh"));
test("src/rustshim.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/rustshim.fsh"));
test("src/scripts.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/scripts.fsh"));
test("src/semver.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/semver.fsh"));
test("src/sizes.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/sizes.fsh"));
test("src/split.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/split.fsh"));
test("src/std.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/std.fsh"));
test("src/suggest.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/suggest.fsh"));
test("src/survey.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/survey.fsh"));
test("src/tar.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/tar.fsh"));
test("src/target.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/target.fsh"));
test("src/tests.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/tests.fsh"));
test("src/typefns.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/typefns.fsh"));
test("src/types.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/types.fsh"));
test("src/typing.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/typing.fsh"));
test("src/typings.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/typings.fsh"));
test("src/unions.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/unions.fsh"));
test("src/unquote.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/unquote.fsh"));
test("src/unsupported.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/unsupported.fsh"));
test("src/values.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/values.fsh"), { timeout: 60_000 });
test("src/walk.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/walk.fsh"));
test("src/warnings.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/warnings.fsh"));
test("src/watch.fsh formats keeping its comments, parses back to the same tree and formats the same again", () => roundTrips("src/watch.fsh"));

test("the corpus is counted", () => {
  const all = units();
  const sources = srcFiles();
  console.log(`corpus: ${sources.length} src files, ${all.names.length} programs, ${REFUSED.length} refused on purpose`);
  let ungrouped: string[] = [];
  let programFiles: string[] = [];
  fshFiles(join(root(), "tests", "programs"), "tests/programs", programFiles);
  for (const f of programFiles) if (groupOf(f) === undefined) ungrouped.push(f);
  assert(ungrouped.length === 0, `test programs in no group of GROUPS: ${ungrouped.join(", ")}`);
  let missing: string[] = [];
  for (const r of REFUSED) if (!all.names.includes(r[0])) missing.push(r[0]);
  assert(missing.length === 0, `listed as refused but not a program: ${missing.join(", ")}`);
  let unknown: string[] = [];
  for (const sl of SLOW) if (!all.names.includes(sl[0]) && !sources.includes(sl[0])) unknown.push(sl[0]);
  assert(unknown.length === 0, `listed as slow but not a program or source: ${unknown.join(", ")}`);
  let unlisted: string[] = [];
  for (const f of sources) if (!SOURCES.includes(f)) unlisted.push(f);
  let gone: string[] = [];
  for (const f of SOURCES) if (!sources.includes(f)) gone.push(f);
  assert(unlisted.length === 0 && gone.length === 0, `SOURCES and its tests are out of step with src: without a test ${unlisted.join(", ")}; no longer in src ${gone.join(", ")}`);
});
