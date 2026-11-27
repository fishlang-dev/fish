// The playground's compiler: one program's text checked, its errors placed by line and column,
// its ownership explained, and its `main()` run through the comptime interpreter. Built for
// wasm32-wasip1 by `scripts/playground.fsh`, the page runs it with a request on stdin and reads
// the answer from stdout.
import { analyze } from "./analysis.fsh";
import type { InstanceId } from "./arenas.fsh";
import { newSession, type Tables } from "./compilation.fsh";
import { display, runMain, type Value } from "./comptime.fsh";
import { CompileError, locate, type BorrowEvent } from "./diag.fsh";
import { explainBorrows } from "./explain.fsh";
import { MEMORY } from "./modules.fsh";
import { shown } from "./repl.fsh";
import type { Type } from "./typing.fsh";

// One error or warning, where it starts and ends in the source; lines and columns count from 1.
export type Diagnostic = { severity: string; code: string; message: string; line: usize; col: usize; endLine: usize; endCol: usize };
// What the page shows: `ran` says whether `main()` ran to its end, and `note` why it didn't when
// the program checked.
export type Answer = { diagnostics: Diagnostic[]; explain: string; ran: boolean; output: string[]; note: string };

const FILE = `${MEMORY}main.fsh`;
// The checker's ownership errors, which the explainer can show the moves and loans behind.
const OWNERSHIP = new Set(["E0201", "E0202", "E0203", "E0204", "E0205"]);

class PlayHost {
  tables: Tables;

  constructor(tables: Tables) {
    this.tables = tables;
  }

  ensureChecked(this: Mut<this>, _id: InstanceId): boolean {
    return true;
  }
}

function diagnostic(src: string, e: Ref<CompileError>, severity: string): Diagnostic {
  // An error inside std, past the program's text, is shown at its end.
  const start = locate(src, e.start <= src.length ? e.start : src.length);
  const end = locate(src, e.end <= src.length ? e.end : src.length);
  return { severity, code: e.code, message: e.message, line: start.line, col: start.col, endLine: end.line, endCol: end.col };
}

// A line `console.log` printed, its arguments as it shows them.
function printedLine(typing: Ref<Tables["typing"]>, args: Ref<[Value, Type][]>): string {
  let parts: string[] = [];
  for (const [v, t] of args) parts.push(shown(typing, v, t, false) ?? display(v, t));
  return parts.join(" ");
}

// The playground's answer for the program `src`.
export function answer(src: string): Answer {
  let session = newSession();
  session.borrows = [];
  let out: Answer = { diagnostics: [], explain: "", ran: false, output: [], note: "" };
  let events: BorrowEvent[] = [];
  let errors: CompileError[] = [];
  try {
    let made = analyze(session, src, FILE);
    for (const w of made.checked.warnings) out.diagnostics.push(diagnostic(src, w, "warning"));
    const kept: Ref<BorrowEvent[] | undefined> = made.checked.tables.session.borrows;
    if (kept !== undefined) for (const b of kept) if (b.end <= src.length) events.push({ ...b });
    out.explain = explainBorrows(src, "main.fsh", events, errors);
    let main: InstanceId | undefined = undefined;
    for (const id of made.checked.instances) if (made.checked.tables.arenas.instanceOf(id).symbol === "main") main = id;
    if (main === undefined) {
      out.note = "the program has no main() to run";
      return out;
    }
    let host = new PlayHost(made.checked.tables);
    const run = runMain(host, main);
    for (const line of run.printed) out.output.push(printedLine(host.tables.typing, line));
    if (run.failure === undefined) out.ran = true;
    else {
      const stop = diagnostic(src, run.failure, "error");
      out.note = run.failure.message.startsWith("this comptime code panicked: ")
        ? `main() panicked at line ${stop.line}: ${run.failure.message.slice("this comptime code panicked: ".length as i64)}`
        : `the playground runs main() in the compiler's interpreter, which stopped at line ${stop.line}: ${run.failure.message}; a native build runs it`;
    }
  } catch (e) {
    if (!(e instanceof CompileError)) {
      out.note = `internal error: ${(e as { message: string }).message}`;
      return out;
    }
    if (e.errors.length > 0) for (const x of e.errors) errors.push(x.clone());
    else errors.push(e.clone());
    for (const x of errors) out.diagnostics.push(diagnostic(src, x, "error"));
    if (errors.every((x) => OWNERSHIP.has(x.code) && x.end <= src.length)) {
      for (const b of e.borrows) if (b.end <= src.length) events.push({ ...b });
      out.explain = explainBorrows(src, "main.fsh", events, errors);
    }
  }
  return out;
}

type Request = { source: string };

// A request on stdin, `{"source": "..."}`, and its answer on stdout, as JSON.
async function main(): Promise<void> throws JsonError {
  let input: Buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) input = Buffer.concat([input, chunk]);
  const request = JSON.parse<Request>(input.toString("utf8"));
  console.log(JSON.stringify(answer(request.source)));
}
