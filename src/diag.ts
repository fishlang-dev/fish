
// The names a compilation made up, which a message shows as the user knows them. `local` holds
// the names local declarations are hoisted under, 'Point@0', and a macro's private names,
// 'helper@m0', each shown as written; `madeUp` maps a name like a test's function, `test "x"`, to
// how it reads, as the test it is. Only names recorded here are rewritten, so text a user wrote,
// like a string "user@1", is left alone.
export type Names = { local: Set<string>; madeUp: Map<string, string> };

// How a message reads: without the suffix a top-level name takes to tell it apart from another
// file's (`helper-fsh2`), and with made-up names shown as the user knows them.
export function shown(text: string, names: Names): string {
  for (const [name, display] of names.madeUp) {
    const quoted = new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-fsh\\d+)?'`, "g");
    text = text.replace(quoted, () => display);
  }
  return text.replace(/(?<=[\w$])-fsh\d+\b/g, "");
}

// `text` with the hoisted names in it as they were written.
export const written = (text: string, names: Names) => text.replace(/([\w$]+)@m?\d+/g, (m, name: string) => (names.local.has(m) ? name : m));

// A second location an error refers to, like where a value was moved.
export type Note = { message: string; start: number; end: number };

// A file of a program other than the one an error is rendered against, from `base` on.
export type Source = { base: number; src: string; file: string };

// A user-facing compile error pointing at a [start, end) source range, with its code from
// src/codes.ts. `sources` holds the program's other files, when it spans several, and `names` the
// names its compilation made up, both given by `named` where the error leaves the compilation.
export class CompileError extends Error {
  code: string;
  start: number;
  end: number;
  note: Note | undefined;
  sources: Source[] = [];
  names: Names = { local: new Set(), madeUp: new Map() };

  constructor(code: string, message: string, start: number, end?: number, note?: Note);
  constructor(message: string, start: number, end?: number, note?: Note);
  constructor(a: string, b: string | number, c?: number, d?: number | Note, e?: Note) {
    const coded = typeof b === "string";
    super(coded ? b : a);
    this.code = coded ? a : "";
    this.start = coded ? c! : b;
    this.end = (coded ? (d as number | undefined) : c) ?? this.start + 1;
    this.note = coded ? e : (d as Note | undefined);
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
export function sourceOf(src: string, file: string, offset: number, sources: Source[] = []): { src: string; file: string; offset: number } {
  const other = sources.findLast((s) => offset >= s.base);
  return other ? { src: other.src, file: other.file, offset: offset - other.base } : { src, file, offset };
}

// 1-based line and column of a source offset, plus the bounds of its line.
export function locate(src: string, offset: number) {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const newline = src.indexOf("\n", offset);
  const lineEnd = newline < 0 ? src.length : newline;
  const line = src.slice(0, offset).split("\n").length;
  return { line, col: offset - lineStart + 1, lineStart, lineEnd };
}

// Renders `file:line:col: error[E0201]: msg`, or another `kind` than `error`, followed by the
// source line with a caret underline, then the same for its note. Only errors and warnings show
// the code: lint findings render through here under their rule's name.
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
  const head = e.code && (kind === "error" || kind === "warning") ? `${kind}[${e.code}]` : kind;
  return [...lines(head, e), ...(e.note ? lines("note", e.note) : [])].join("\n");
}

// How an index reads in a message: a name or a number as written, anything else as `...`.
export function indexText(e: { kind: string; name?: string; value?: unknown }): string {
  return e.kind === "ident" ? e.name! : e.kind === "int" ? String(e.value) : "...";
}
