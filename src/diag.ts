
// The names a compilation made up, which a message shows as the user knows them. `local` holds
// the names local declarations are hoisted under, 'Point@0', and a macro's private names,
// 'helper@m0', each shown as written; `madeUp` maps a name like a test's function, `test "x"`, to
// how it reads, as the test it is. Only names recorded here are rewritten, so text a user wrote,
// like a string "user@1", is left alone.
export type Names = { local: Set<string>; madeUp: Map<string, string> };

// How a message reads: without the suffix a top-level name takes to tell it apart from another
// file's (`helper-fsh2`), and with made-up names shown as the user knows them.
export function shown(text: string, names: Ref<Names>): string {
  let out = text;
  for (const [name, display] of names.madeUp) out = quotedAs(out, name, display);
  return out.replace(/(?<=[\w$])-fsh\d+\b/g, "");
}

// `text` with each `'name'` in it, or `'name-fsh2'` for another file's, as `display`.
function quotedAs(text: string, name: string, display: string): string {
  let out = "";
  let from: usize = 0;
  for (let found = text.indexOf(`'${name}`); found >= 0; found = text.indexOf(`'${name}`, from as i64)) {
    const at = found as usize;
    let end = at + name.length + 1;
    if (text.startsWith("-fsh", end as i64)) {
      let digits = end + 4;
      while (digits < text.length && text.charAt(digits as i64) >= "0" && text.charAt(digits as i64) <= "9") digits++;
      if (digits > end + 4) end = digits;
    }
    if (text.charAt(end as i64) !== "'") {
      out += text.slice(from as i64, (at + 1) as i64);
      from = at + 1;
      continue;
    }
    out += text.slice(from as i64, at as i64) + display;
    from = end + 1;
  }
  return out + text.slice(from as i64);
}

// `text` with the hoisted names in it as they were written.
export function written(text: string, names: Ref<Names>): string {
  return text.replace(/([\w$]+)@m?\d+/g, (m, name: string) => (names.local.has(m) ? name : m));
}

// A second location an error refers to, like where a value was moved.
export type Note = { message: string; start: usize; end: usize };

// A file of a program other than the one an error is rendered against, from `base` on.
export type Source = { base: usize; src: string; file: string };

// A user-facing compile error pointing at a [start, end) source range, with its code from
// src/codes.ts. `sources` holds the program's other files, when it spans several, and `names` the
// names its compilation made up, both given by `named` where the error leaves the compilation.
export class CompileError extends Error {
  code: string;
  start: usize;
  end: usize;
  note: Note | undefined;
  sources: Source[] = [];
  names: Names = { local: new Set(), madeUp: new Map() };
  // The errors a group from one build stands for, in source order; none for a single error.
  errors: CompileError[] = [];

  constructor(code: string, message: string, start: usize, end: usize = start + 1, note?: Note) {
    super(message);
    this.code = code;
    this.start = start;
    this.end = end;
    this.note = note;
  }
}

// Several errors from one build, in source order. It reads as its first wherever only one error
// is looked at.
export class CompileErrors extends CompileError {
  constructor(errors: CompileError[]) {
    super(errors[0]!.code, errors[0]!.message, errors[0]!.start, errors[0]!.end, errors[0]!.note === undefined ? undefined : { ...errors[0]!.note! });
    this.errors = errors;
  }
}

// Gives `e` the names its compilation made up, with the hoisted ones in its messages as written.
export function named(e: CompileError, names: Names): CompileError {
  let out = e;
  rename(out, names);
  for (let i = 0; i < out.errors.length; i++) rename(out.errors[i]!, names);
  out.names = names;
  return out;
}

// `e`'s messages with the hoisted names in them as written.
function rename(e: Mut<CompileError>, names: Ref<Names>): void {
  e.message = written(e.message, names);
  if (e.note !== undefined) e.note = { start: e.note!.start, end: e.note!.end, message: written(e.note!.message, names) };
}

// Which source an offset is in: the entry file's, or another file's from `sources`, which ends
// with std's when the program was loaded with it.
export function sourceOf(src: string, file: string, offset: usize, sources: Ref<Source[]>): { src: string; file: string; offset: usize } {
  for (let i = sources.length; i > 0; i--) {
    const other: Ref<Source> = sources[i - 1]!;
    if (offset >= other.base) return { src: other.src, file: other.file, offset: offset - other.base };
  }
  return { src, file, offset };
}

// 1-based line and column of a source offset, plus the bounds of its line.
export function locate(src: string, offset: usize) {
  // At 0 there is no earlier character, and `lastIndexOf` from -1 would still find a newline at 0.
  const lineStart = offset === 0 ? 0 : ((src.lastIndexOf("\n", (offset as i64) - 1) + 1) as usize);
  const newline = src.indexOf("\n", offset as i64);
  const lineEnd = newline < 0 ? src.length : newline as usize;
  const line = src.slice(0, offset as i64).split("\n").length;
  return { line, col: offset - lineStart + 1, lineStart, lineEnd };
}

// Renders `file:line:col: error[E0201]: msg`, or another `kind` than `error`, followed by the
// source line with a caret underline, then the same for its note. Only errors and warnings show
// the code: lint findings render through here under their rule's name. A group renders each
// error, a blank line apart, then a line counting them, as Rust's does. With `colour`, the
// label and caret line are painted for a terminal.
export function formatError(e: Ref<CompileError>, path: string, program: string, kind = "error", colour = false): string {
  if (e.errors.length > 1) {
    const summary = `${paint("error", RED, colour)}${paint(`: could not compile due to ${e.errors.length} previous errors`, BOLD, colour)}`;
    return [...e.errors.map((x) => rendered(x, e, path, program, kind, colour)), summary].join("\n\n");
  }
  return rendered(e, e, path, program, kind, colour);
}

// One error, rendered against its group's sources when it has none of its own, and with the
// names its group's compilation made up.
function rendered(e: Ref<CompileError>, group: Ref<CompileError>, path: string, program: string, kind: string, colour: boolean): string {
  const lines = (kind: string, note: Ref<Note>, tone: string) => {
    const { src, file, offset } = sourceOf(program, path, note.start, e.sources.length > 0 ? e.sources : group.sources);
    // A position past its text would pad the caret line without end.
    const start = Math.min(offset, src.length);
    const { message } = note;
    const end = note.end - (note.start - start);
    const { line, col, lineStart, lineEnd } = locate(src, start);
    const width = Math.max(1, Math.min(end, lineEnd) - start);
    const pad = " ".repeat(String(line).length);
    return [
      `${paint(`${file}:${line}:${col}:`, BOLD, colour)} ${paint(kind, tone, colour)}: ${shown(message, group.names)}`,
      ` ${line} | ${src.slice(lineStart as i64, lineEnd as i64)}`,
      ` ${pad} | ${" ".repeat(col - 1)}${paint("^".repeat(width), tone, colour)}`,
    ];
  };
  const head = kind === "error" || kind === "warning" ? `${kind}[${e.code}]` : kind;
  const tone = kind === "error" ? RED : kind === "warning" ? YELLOW : BOLD;
  const out = lines(head, e, tone);
  return (e.note === undefined ? out : out.concat(lines("note", e.note!, BOLD))).join("\n");
}

const RED = "1;31";
const YELLOW = "1;33";
const BOLD = "1";

function paint(text: string, tone: string, colour: boolean): string {
  return colour ? `\x1b[${tone}m${text}\x1b[0m` : text;
}
