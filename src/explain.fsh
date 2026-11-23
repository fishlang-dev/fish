// `fishc explain-borrows`: a file's source with a line under each place where ownership does
// something, from what the move checker logged and the ownership errors the check gave.
import { locate, shown, type BorrowEvent, type CompileError, type Names } from "./diag.fsh";

// What is printed under a source line: where on it, how far it is underlined, and its lines of
// text. `order` keeps marks at one spot as they were given.
type Mark = { start: usize; line: usize; col: usize; width: usize; lines: string[]; order: usize };

// The checker stops a body at its first ownership error, so nothing after it was looked at.
const UNANALYSED = "the rest of this function isn't analysed past this error";

// A loan's text without the word that tells a mutable loan from a shared one.
function shared(text: string): string {
  return text.replace(" mutably", "");
}

function mark(src: string, start: usize, end: usize, lines: string[], order: usize): Mark {
  const at = locate(src, start);
  // A span running past its line is underlined to the line's end.
  const width = Math.max(1, Math.min(end, at.lineEnd) - start);
  return { start, line: at.line, col: at.col, width, lines, order };
}

// `src`, the text of `file`, with `events` and `errors` under the lines they are on, their
// offsets into `src`. With `only`, just the lines that range covers.
export function explainBorrows(src: string, file: string, events: Ref<BorrowEvent[]>, errors: Ref<CompileError[]>, only?: { start: usize; end: usize }): string {
  // A loop's body is walked more than once and a generic body once per instance, each logging
  // the same events again. A receiver is lent shared while its arguments run and then mutably
  // for the call, which the mutable loan alone says.
  let kept: BorrowEvent[] = [];
  for (const e of events) {
    const same = kept.findIndex((k) => k.kind === e.kind && k.start === e.start && k.end === e.end && shared(k.text) === shared(e.text));
    if (same < 0) kept.push({ ...e });
    else if (e.text !== shared(e.text)) kept[same as usize] = { ...e };
  }
  const names: Names = { local: new Set(), madeUp: new Map() };
  let marks: Mark[] = [];
  for (const e of kept) {
    if (only !== undefined && (e.start < only.start || e.start >= only.end)) continue;
    let text = shown(e.text, names);
    if (e.until !== undefined) {
      const ends = locate(src, e.until).line;
      text += ends === locate(src, e.start).line ? " to the end of this line" : ` until line ${ends}`;
    }
    marks.push(mark(src, e.start, e.end, [text], marks.length));
  }
  for (const e of errors) {
    if (only !== undefined && (e.start < only.start || e.start >= only.end)) continue;
    let lines = [`error[${e.code}]: ${shown(e.message, names)}`];
    if (e.note !== undefined) lines.push(`line ${locate(src, e.note.start).line}: ${shown(e.note.message, names)}`);
    lines.push(UNANALYSED);
    marks.push(mark(src, e.start, e.end, lines, marks.length));
  }
  let text = src.split("\n");
  if (text.length > 0 && text[text.length - 1]! === "") text.pop();
  const first = only === undefined ? 1 : locate(src, only.start).line;
  const last = only === undefined ? text.length : Math.min(text.length, locate(src, only.end).line);
  if (marks.length === 0) return `nothing moves or is lent in ${only === undefined ? file : `lines ${first} to ${last} of ${file}`}`;
  marks.sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.order < b.order ? -1 : 1));
  const gutter = String(last).length;
  let out: string[] = [];
  let next: usize = 0;
  for (let n = first; n <= last; n++) {
    out.push(` ${" ".repeat(gutter - String(n).length)}${n} | ${text[n - 1]!}`);
    for (; next < marks.length && marks[next]!.line === n; next++) {
      const m: Ref<Mark> = marks[next]!;
      const under = ` ${" ".repeat(gutter)} | ${" ".repeat(m.col - 1)}`;
      out.push(`${under}${"^".repeat(m.width)} ${m.lines[0]!}`);
      for (let i: usize = 1; i < m.lines.length; i++) out.push(`${under}${" ".repeat(m.width)} ${m.lines[i]!}`);
    }
  }
  return out.join("\n");
}
