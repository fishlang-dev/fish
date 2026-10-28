import { STD_BASE, STD_FILE, STD_SOURCE } from "./std.ts";

// Names the compiler made up, as a message should show them: a test's function, `test "x"`, as
// the test it is. Only names recorded here are rewritten, so text a user wrote is left alone.
export const madeUpNames = new Map<string, string>();

// How a message reads: without the suffix a top-level name takes to tell it apart from another
// file's (`helper-fsh2`), and with made-up names shown as the user knows them.
export function shown(text: string): string {
  for (const [name, display] of madeUpNames) {
    const quoted = new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-fsh\\d+)?'`, "g");
    text = text.replace(quoted, () => display);
  }
  return text.replace(/(?<=[\w$])-fsh\d+\b/g, "");
}

// A second location an error refers to, like where a value was moved.
export type Note = { message: string; start: number; end: number };

// A file of a program other than the one an error is rendered against, from `base` on.
export type Source = { base: number; src: string; file: string };

// The names local declarations are hoisted under, 'Point@0', and a macro's private names,
// 'helper@m0', shown as written. Only those are, so a string like "user@1" in a message stays.
export const LOCAL_NAMES = new Set<string>();
export const written = (text: string) => text.replace(/([\w$]+)@m?\d+/g, (m, name: string) => (LOCAL_NAMES.has(m) ? name : m));

// A user-facing compile error pointing at a [start, end) source range. `sources` holds the
// program's other files, when it spans several.
export class CompileError extends Error {
  start: number;
  end: number;
  note: Note | undefined;
  sources: Source[] = [];

  constructor(message: string, start: number, end = start + 1, note?: Note) {
    super(written(message));
    this.start = start;
    this.end = end;
    this.note = note && { ...note, message: written(note.message) };
  }
}

// Which source an offset is in: the entry file's, another file's from `sources`, or the std
// library's, which sits past them all.
export function sourceOf(src: string, file: string, offset: number, sources: Source[] = []): { src: string; file: string; offset: number } {
  if (offset >= STD_BASE) return { src: STD_SOURCE, file: STD_FILE, offset: offset - STD_BASE };
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
      `${file}:${line}:${col}: ${kind}: ${shown(message)}`,
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
