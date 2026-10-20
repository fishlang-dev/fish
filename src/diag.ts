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

// 1-based line and column of a source offset, plus the bounds of its line.
export function locate(src: string, offset: number) {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const newline = src.indexOf("\n", offset);
  const lineEnd = newline < 0 ? src.length : newline;
  const line = src.slice(0, offset).split("\n").length;
  return { line, col: offset - lineStart + 1, lineStart, lineEnd };
}

// Renders `file:line:col: error: msg` followed by the source line with a caret underline.
export function formatError(e: CompileError, file: string, src: string): string {
  const { line, col, lineStart, lineEnd } = locate(src, e.start);
  const width = Math.max(1, Math.min(e.end, lineEnd) - e.start);
  const pad = " ".repeat(String(line).length);
  return [
    `${file}:${line}:${col}: error: ${e.message}`,
    ` ${line} | ${src.slice(lineStart, lineEnd)}`,
    ` ${pad} | ${" ".repeat(col - 1)}${"^".repeat(width)}`,
  ].join("\n");
}
