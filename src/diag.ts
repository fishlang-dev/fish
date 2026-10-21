// A second location an error refers to, like where a value was moved.
export type Note = { message: string; start: number; end: number };

// A user-facing compile error pointing at a [start, end) source range.
export class CompileError extends Error {
  start: number;
  end: number;
  note: Note | undefined;

  constructor(message: string, start: number, end = start + 1, note?: Note) {
    super(message);
    this.start = start;
    this.end = end;
    this.note = note;
  }
}

// 1-based line and column of a source offset, plus the bounds of its line.
export function locate(src: string, offset: number) {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const newline = src.indexOf("\n", offset);
  const lineEnd = newline < 0 ? src.length : newline;
  const line = src.slice(0, offset).split("\n").length;
  return { line, col: offset - lineStart + 1, lineStart, lineEnd };
}

// Renders `file:line:col: error: msg` followed by the source line with a caret underline,
// then the same for its note.
export function formatError(e: CompileError, file: string, src: string): string {
  const lines = (kind: string, { message, start, end }: Note) => {
    const { line, col, lineStart, lineEnd } = locate(src, start);
    const width = Math.max(1, Math.min(end, lineEnd) - start);
    const pad = " ".repeat(String(line).length);
    return [
      `${file}:${line}:${col}: ${kind}: ${message}`,
      ` ${line} | ${src.slice(lineStart, lineEnd)}`,
      ` ${pad} | ${" ".repeat(col - 1)}${"^".repeat(width)}`,
    ];
  };
  return [...lines("error", e), ...(e.note ? lines("note", e.note) : [])].join("\n");
}

// How an index reads in a message: a name or a number as written, anything else as `...`.
export function indexText(e: { kind: string; name?: string; value?: unknown }): string {
  return e.kind === "ident" ? e.name! : e.kind === "int" ? String(e.value) : "...";
}
