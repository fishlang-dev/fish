// `fishc explain-borrows`: what the move checker logs for it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, type BorrowEvent } from "../../src/diag.fsh";
import { analyze } from "../../src/main.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { removed, scratch } from "./support.fsh";

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
      out.error = e;
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

test("a check logging borrows gives each move and each loan with its holder's last use", () => {
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

test("a check that fails gives what it logged with its error", () => {
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

test("a check not asked to logs nothing", () => {
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
