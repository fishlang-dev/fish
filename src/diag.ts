// A user-facing compile error pointing at a [start, end) source range.
export class CompileError extends Error {
  start: number;
  end: number;

  constructor(message: string, start: number, end = start + 1) {
    super(message);
    this.start = start;
    this.end = end;
  }
}

// Renders `file:line:col: error: msg` followed by the source line with a caret underline.
export function formatError(e: CompileError, file: string, src: string): string {
  const lineStart = src.lastIndexOf("\n", e.start - 1) + 1;
  const newline = src.indexOf("\n", e.start);
  const lineEnd = newline < 0 ? src.length : newline;
  const line = String(src.slice(0, e.start).split("\n").length);
  const col = e.start - lineStart + 1;
  const width = Math.max(1, Math.min(e.end, lineEnd) - e.start);
  const pad = " ".repeat(line.length);
  return [
    `${file}:${line}:${col}: error: ${e.message}`,
    ` ${line} | ${src.slice(lineStart, lineEnd)}`,
    ` ${pad} | ${" ".repeat(col - 1)}${"^".repeat(width)}`,
  ].join("\n");
}
