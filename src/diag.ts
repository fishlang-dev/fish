
// The names a compilation made up, which a message shows as the user knows them. `local` holds
// the names local declarations are hoisted under, 'Point@0', and a macro's private names,
// 'helper@m0', each shown as written; `madeUp` maps a name like a test's function, `test "x"`, to
// how it reads, as the test it is. Only names recorded here are rewritten, so text a user wrote,
// like a string "user@1", is left alone.
export type Names = { local: Set<string>; madeUp: Map<string, string> };

// How a message reads: without the suffix a top-level name takes to tell it apart from another
// file's (`helper-fsh2`), and with made-up names shown as the user knows them.
export function shown(text: string, names: Names): string {
  let out = text;
  for (const [name, display] of names.madeUp) out = quotedAs(out, name, display);
  return out.replace(/(?<=[\w$])-fsh\d+\b/g, "");
}

// `text` with each `'name'` in it, or `'name-fsh2'` for another file's, as `display`.
function quotedAs(text: string, name: string, display: string): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf(`'${name}`); at >= 0; at = text.indexOf(`'${name}`, from)) {
    let end = at + name.length + 1;
    if (text.startsWith("-fsh", end)) {
      let digits = end + 4;
      while (digits < text.length && text[digits]! >= "0" && text[digits]! <= "9") digits++;
      if (digits > end + 4) end = digits;
    }
    if (text[end] !== "'") {
      out += text.slice(from, at + 1);
      from = at + 1;
      continue;
    }
    out += text.slice(from, at) + display;
    from = end + 1;
  }
  return out + text.slice(from);
}

// `text` with the hoisted names in it as they were written.
export const written = (text: string, names: Names) => text.replace(/([\w$]+)@m?\d+/g, (m, name: string) => (names.local.has(m) ? name : m));

// A second location an error refers to, like where a value was moved.
export type Note = { message: string; start: usize; end: usize };

// A file of a program other than the one an error is rendered against, from `base` on.
export type Source = { base: usize; src: string; file: string };

// A user-facing compile error pointing at a [start, end) source range. `sources` holds the
// program's other files, when it spans several, and `names` the names its compilation made up,
// both given by `named` where the error leaves the compilation.
export class CompileError extends Error {
  start: usize;
  end: usize;
  note: Note | undefined;
  sources: Source[] = [];
  names: Names = { local: new Set(), madeUp: new Map() };

  constructor(message: string, start: usize, end: usize = start + 1, note?: Note) {
    super(message);
    this.start = start;
    this.end = end;
    this.note = note;
  }
}

// Gives `e` the names its compilation made up, with the hoisted ones in its messages as written.
export function named(e: CompileError, names: Names): CompileError {
  e.message = written(e.message, names);
  if (e.note) e.note = { ...e.note, message: written(e.note.message, names) };
  e.names = names;
  return e;
}

// Which source an offset is in: the entry file's, or another file's from `sources`, which ends
// with std's when the program was loaded with it.
export function sourceOf(src: string, file: string, offset: usize, sources: Source[] = []): { src: string; file: string; offset: usize } {
  const other = sources.findLast((s) => offset >= s.base);
  return other ? { src: other.src, file: other.file, offset: offset - other.base } : { src, file, offset };
}

// 1-based line and column of a source offset, plus the bounds of its line.
export function locate(src: string, offset: usize) {
  const lineStart = (src.lastIndexOf("\n", offset - 1) + 1) as usize;
  const newline = src.indexOf("\n", offset);
  const lineEnd = newline < 0 ? src.length : newline as usize;
  const line = src.slice(0, offset).split("\n").length;
  return { line, col: offset - lineStart + 1, lineStart, lineEnd };
}

// Renders `file:line:col: error: msg`, or another `kind` than `error`, followed by the source line
// with a caret underline, then the same for its note.
export function formatError(e: CompileError, path: string, program: string, kind = "error"): string {
  const lines = (kind: string, note: Note) => {
    const { src, file, offset } = sourceOf(program, path, note.start, e.sources);
    // A position past its text would pad the caret line without end.
    const start = Math.min(offset, src.length);
    const { message } = note;
    const end = note.end - (note.start - start);
    const { line, col, lineStart, lineEnd } = locate(src, start);
    const width = Math.max(1, Math.min(end, lineEnd) - start);
    const pad = " ".repeat(String(line).length);
    return [
      `${file}:${line}:${col}: ${kind}: ${shown(message, e.names)}`,
      ` ${line} | ${src.slice(lineStart, lineEnd)}`,
      ` ${pad} | ${" ".repeat(col - 1)}${"^".repeat(width)}`,
    ];
  };
  return [...lines(kind, e), ...(e.note ? lines("note", e.note) : [])].join("\n");
}

// How an index reads in a message: a name or a number as written, anything else as `...`.
export function indexText(e: { kind: string; name?: string; value?: unknown }): string {
  return e.kind === "ident" ? e.name! : e.kind === "int" ? String(e.value) : "...";
}
