// `fishc explain-borrows`: what the move checker logs for it, how the log is rendered, and the
// command run as the native fishc.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, type BorrowEvent } from "../../src/diag.fsh";
import { explainBorrows } from "../../src/explain.fsh";
import { analyze } from "../../src/main.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { fishc, ran, removed, same, scratch } from "./support.fsh";

type Logged = { events: BorrowEvent[]; error: CompileError | undefined };

// The moves and loans a check of `src` logs, and the error it fails with, when it does.
function logged(src: string): Logged {
  const dir = scratch("fish-explain-");
  let out: Logged = { events: [], error: undefined };
  try {
    const file = join(dir, "main.fsh");
    writeFileSync(file, src);
    let session = cachedSession();
    session.borrows = [];
    const made = analyze(session, src, file);
    if (made.checked.tables.session.borrows !== undefined) for (const b of made.checked.tables.session.borrows) out.events.push({ ...b });
  } catch (e) {
    if (e instanceof CompileError) {
      for (const b of e.borrows) out.events.push({ ...b });
      out.error = e.clone();
    } else assert(false, `the check failed: ${e.message}`);
  }
  removed(dir);
  return out;
}

// A log as a failed assertion shows it.
function listed(events: Ref<BorrowEvent[]>): string {
  return events.map((e) => `${e.kind} ${e.start}-${e.end} ${e.text}`).join("\n");
}

const HEAD = `class P { n: i64; constructor(n: i64) { this.n = n; } }
function take(p: P): void { console.log(p.n); }
`;

test("a check logging for explain-borrows gives each move and each loan with its holder's last use", () => {
  const src = `${HEAD}function main() {
  const a = new P(1);
  const b = new P(2);
  const r: Ref<P> = b;
  take(a);
  console.log(r.n);
}
`;
  const { events, error } = logged(src);
  assert(error === undefined, `the check failed: ${error?.message ?? ""}`);
  const moved = src.indexOf("take(a)") as usize + 5;
  const move = events.find((e) => e.kind === "move" && e.start === moved);
  assert(move !== undefined && move.end === moved + 1, `no move at 'a': ${listed(events)}`);
  assert(move!.text.startsWith("'a' moved here: passing it to 'take' hands it over"), `the move reads: ${move!.text}`);
  const lent = src.indexOf("= b;") as usize + 2;
  const loan = events.find((e) => e.kind === "lend" && e.start === lent);
  assert(loan !== undefined && loan.text === "'b' is lent to 'r'", `no loan of 'b' to 'r': ${listed(events)}`);
  const used = src.indexOf("console.log(r.n)") as usize;
  assert(loan!.until !== undefined && loan!.until! >= used && loan!.until! <= used + "console.log(r.n)".length, `the loan lasts until ${loan!.until ?? 0}, not r's last use at ${used}`);
}, { timeout: 30_000 });

test("a check that fails gives what it logged for explain-borrows with its error", () => {
  const src = `${HEAD}function main() {
  const a = new P(1);
  take(a);
  console.log(a.n);
}
`;
  const { events, error } = logged(src);
  assert(error !== undefined && error.code === "E0201", `expected a use after move, got: ${error?.message ?? "a check"}`);
  const moved = src.indexOf("take(a)") as usize + 5;
  assert(events.some((e) => e.kind === "move" && e.start === moved), `no move at 'a': ${listed(events)}`);
}, { timeout: 30_000 });

test("a check not asked to logs nothing for explain-borrows", () => {
  const dir = scratch("fish-explain-");
  const src = `${HEAD}function main() { take(new P(1)); const a = new P(2); take(a); }\n`;
  try {
    const file = join(dir, "main.fsh");
    writeFileSync(file, src);
    const made = analyze(cachedSession(), src, file);
    assert(made.checked.tables.session.borrows === undefined, "a session with no log was given one");
  } catch (e) {
    assert(false, `the check failed: ${e.message}`);
  }
  removed(dir);
}, { timeout: 30_000 });

const SHOWN = `function main() {
  const a = make();
  take(a); const r = b;
  console.log(
    a,
    r);
}
`;

// Where `text` starts in SHOWN, `skip` characters in.
function at(text: string, skip: usize = 0): usize {
  return (SHOWN.indexOf(text) as usize) + skip;
}

const MOVED = "'a' moved here: passing it to 'take' hands it over";

function shownEvents(): BorrowEvent[] {
  return [
    { kind: "lend", start: at("= b", 2), end: at("= b", 3), text: "'b' is lent to 'r'", until: at("r);") },
    { kind: "move", start: at("take(a)", 5), end: at("take(a)", 6), text: MOVED },
    { kind: "move", start: at("take(a)", 5), end: at("take(a)", 6), text: MOVED },
    { kind: "lend", start: at("console"), end: at("r);", 2), text: "'x' is lent to 'log' for this call" },
    { kind: "lend", start: at("console"), end: at("r);", 2), text: "'x' is lent mutably to 'log' for this call" },
  ];
}

test("explain-borrows prints events and errors under the lines they are on", () => {
  const error = new CompileError("E0201", "'a' was moved, so it can't be used here", at("    a,", 4), at("    a,", 5), { message: MOVED, start: at("take(a)", 5), end: at("take(a)", 6) });
  same(explainBorrows(SHOWN, "t.fsh", shownEvents(), [error]), ` 1 | function main() {
 2 |   const a = make();
 3 |   take(a); const r = b;
   |        ^ 'a' moved here: passing it to 'take' hands it over
   |                      ^ 'b' is lent to 'r' until line 6
 4 |   console.log(
   |   ^^^^^^^^^^^^ 'x' is lent mutably to 'log' for this call
 5 |     a,
   |     ^ error[E0201]: 'a' was moved, so it can't be used here
   |       line 3: 'a' moved here: passing it to 'take' hands it over
   |       the rest of this function isn't analysed past this error
 6 |     r);
 7 | }`, "the whole file");
});

test("explain-borrows prints only a range's lines and what is on them", () => {
  same(explainBorrows(SHOWN, "t.fsh", shownEvents(), [], { start: at("take"), end: at("= b;", 4) }), ` 3 |   take(a); const r = b;
   |        ^ 'a' moved here: passing it to 'take' hands it over
   |                      ^ 'b' is lent to 'r' until line 6`, "one line");
  same(explainBorrows(SHOWN, "t.fsh", shownEvents(), [], { start: 0, end: at("{", 1) }), "nothing moves or is lent in lines 1 to 1 of t.fsh", "a line with nothing on it");
});

test("explain-borrows says when a loan ends on its own line, and fits the gutter to the last line's number", () => {
  const src = `${"//\n".repeat(9)}const r = b; use(r);\n`;
  const b = src.indexOf("= b") as usize + 2;
  const events: BorrowEvent[] = [{ kind: "lend", start: b, end: b + 1, text: "'b' is lent to 'r'", until: src.indexOf("r);") as usize }];
  const lines = explainBorrows(src, "t.fsh", events, []).split("\n");
  same(lines.slice(8).join("\n"), `  9 | //
 10 | const r = b; use(r);
    |           ^ 'b' is lent to 'r' to the end of this line`, "the last lines");
});

test("explain-borrows says when a file has nothing to show", () => {
  same(explainBorrows(SHOWN, "t.fsh", [], []), "nothing moves or is lent in t.fsh", "no events");
});

// A use after a move and a change during a borrow, each in a function of its own.
function program(): string {
  return `${HEAD}function moved(): void {
  const a = new P(1);
  take(a);
  console.log(a.n);
}
function lent(): void {
  let b = new P(2);
  const r: Ref<P> = b;
  b = new P(3);
  console.log(r.n);
}
function main() {
  moved();
  lent();
}
`;
}

// A directory holding `src` as main.fsh.
function fixture(src: string): string {
  const dir = scratch("fish-explain-");
  try {
    writeFileSync(join(dir, "main.fsh"), src);
  } catch (e) {
    assert(false, `can't write the fixture: ${e.message}`);
  }
  return dir;
}

const MOVE_NOTE = "'a' moved here: passing it to 'take' hands it over, as if 'take' kept it; pass 'a.clone()' to keep a copy";
const REST = "the rest of this function isn't analysed past this error";

function movedLines(): string {
  return `  3 | function moved(): void {
  4 |   const a = new P(1);
  5 |   take(a);
    |        ^ ${MOVE_NOTE}
  6 |   console.log(a.n);
    |               ^^^ error[E0201]: 'a.n' can't be used here because 'a' was moved
    |                   line 5: ${MOVE_NOTE}
    |                   ${REST}
  7 | }`;
}

function lentLines(): string {
  return `  8 | function lent(): void {
  9 |   let b = new P(2);
 10 |   const r: Ref<P> = b;
    |                     ^ 'b' is lent to 'r' until line 12
 11 |   b = new P(3);
    |   ^ error[E0203]: cannot change 'b' while 'r' borrows 'b' and is used later
    |     line 10: 'b' is lent here, so it can't change or move until the borrow's last use
    |     ${REST}
 12 |   console.log(r.n);
 13 | }`;
}

test("fishc explain-borrows prints a file with its moves, loans and ownership errors", () => {
  const dir = fixture(program());
  ran(fishc(dir, ["explain-borrows", "main.fsh"]), 0, `  1 | class P { n: i64; constructor(n: i64) { this.n = n; } }
  2 | function take(p: P): void { console.log(p.n); }
${movedLines()}
${lentLines()}
 14 | function main() {
 15 |   moved();
 16 |   lent();
 17 | }
`, "", "the whole file");
  removed(dir);
}, { timeout: 60_000 });

test("fishc explain-borrows --fn prints one function", () => {
  const dir = fixture(program());
  ran(fishc(dir, ["explain-borrows", "main.fsh", "--fn", "lent"]), 0, `${lentLines()}\n`, "", "--fn lent");
  ran(fishc(dir, ["explain-borrows", "main.fsh", "--fn", "main"]), 0, "nothing moves or is lent in lines 14 to 17 of main.fsh\n", "", "--fn main");
  ran(fishc(dir, ["explain-borrows", "main.fsh", "--fn", "gone"]), 2, "", "fishc explain-borrows: 'main.fsh' has no function 'gone'; it has P.constructor, take, moved, lent, main\n", "a function the file lacks");
  removed(dir);
}, { timeout: 60_000 });

test("fishc explain-borrows leaves other errors to be printed as fishc check prints them", () => {
  const dir = fixture(`function main() { const x: i64 = "no"; }\n`);
  const bad = fishc(dir, ["explain-borrows", "main.fsh"]);
  assert(bad.code === 1 && bad.out === "", `exited with ${bad.code}, printing: ${bad.out}`);
  assert(bad.err.includes(`error[E0101]`) && bad.err.includes("main.fsh:1:34:"), `stderr: ${bad.err}`);
  removed(dir);
}, { timeout: 60_000 });

test("fishc explain-borrows with nothing to show, or no file, says so", () => {
  const dir = fixture(`function main() { console.log(1); }\n`);
  ran(fishc(dir, ["explain-borrows", "main.fsh"]), 0, "nothing moves or is lent in main.fsh\n", "", "a file with no moves");
  ran(fishc(dir, ["explain-borrows"]), 2, "", "usage: fishc explain-borrows <file.fsh> [--fn <name>]\n", "no file");
  ran(fishc(dir, ["explain-borrows", "main.fsh", "--release"]), 2, "", "usage: fishc explain-borrows <file.fsh> [--fn <name>]\n", "a flag it doesn't take");
  removed(dir);
}, { timeout: 60_000 });
