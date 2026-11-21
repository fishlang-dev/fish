// Each compilation has its own state, so a program compiles the
// same whatever the process compiled before it. These programs use what a compilation numbers or
// interns as it goes: enums, macro expansions, local generic functions, destructuring assignments,
// local classes, derived equality over a base, and object, union and closure types.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, formatError } from "../../src/diag.fsh";
import { compile } from "../../src/main.fsh";
import { newSession, newTimings, stageEnd, stageStart, timed, type Session, type Timings } from "../../src/compilation.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { removed, same, scratch } from "./support.fsh";

function programA(): string {
  return `macro function withExtra(input: AstStmt): Ast[] {
  return [input, quote\`function \${ident("extra")}(): i64 { return 2; }\`];
}
enum Color { Red, Green, Blue }
@derive(Eq)
class Base {
  constructor(public n: i64) {}
}
@derive(Eq)
class Point extends Base {
  constructor(n: i64, public y: i64) { super(n); }
}
@withExtra function one(): i64 { return 1; }
function main() {
  function same<T>(x: T): T { return x; }
  class Local { v: i64 = 4; }
  let a = "a" + one();
  let b = "b" + extra();
  [a, b] = [b, a];
  const c: Color | string = Color.Green;
  const pair = { left: same(3), right: same("x") };
  const pick = (k: i64): string | null => (k > 0 ? a : null);
  console.log(a, b, c, pair.left, pair.right, pick(1), new Local().v, new Point(1, 2) === new Point(1, 2));
}
`;
}

function programB(): string {
  return `enum Size { Small = 10, Large = 20 }
class Box<T> {
  constructor(public item: T) {}
  get(): Ref<T> { return this.item; }
}
function main() {
  function count<T>(xs: T[]): i64 { return xs.length as i64; }
  let [p, q] = [1, 2];
  [p, q] = [q, p];
  const boxes: Box<string>[] = [new Box<string>("s"), new Box<string>("t")];
  const total = (n: i64): i64 | boolean => (n > 1 ? n : false);
  console.log(Size.Large, count([p, q]), boxes[0].get(), total(p), { k: q, m: [true] });
}
`;
}

// The IR of `src` written as `name` in `dir`, compiled in this process.
function ir(dir: string, name: string, src: string): string {
  const file = join(dir, name);
  try {
    writeFileSync(file, src);
    const out = compile(cachedSession(), src, file);
    return out;
  } catch (e) {
    if (e instanceof CompileError) assert(false, formatError(e, name, src));
    else assert(false, (e as { message: string }).message);
    return "";
  }
}

test("a program compiles the same twice in one process", () => {
  const dir = scratch("fish-compilation-");
  const first = ir(dir, "a.fsh", programA());
  same(ir(dir, "a.fsh", programA()), first, "a.fsh compiled again");
  removed(dir);
});

test("two programs compiled alternately in one process each compile the same every time", () => {
  const dir = scratch("fish-compilation-");
  const a = ir(dir, "a.fsh", programA());
  const b = ir(dir, "b.fsh", programB());
  same(ir(dir, "a.fsh", programA()), a, "a.fsh the second time");
  same(ir(dir, "b.fsh", programB()), b, "b.fsh the second time");
  same(ir(dir, "a.fsh", programA()), a, "a.fsh the third time");
  removed(dir);
});

// Moves the hand-set clock of `session`'s timings on by `ms`.
function spend(session: Mut<Session>, ms: f64): void {
  if (session.timings === undefined) return;
  session.timings.manual = (session.timings.manual ?? 0) + ms;
}

// The stage ended by a throw: started, `ms` spent, then a throw, with the stage ended on the way out.
function thrownStage(session: Mut<Session>, ms: f64): void throws Error {
  const started = stageStart(session);
  try {
    spend(session, ms);
    throw new Error("stop");
  } finally {
    stageEnd(session, "comptime", started);
  }
}

// A stage timed inside another counts only toward itself, and the outer stage keeps the rest,
// however deeply nested, repeated, or ended by a throw. `timed` takes its timings by value, so the
// Fish compiler times its stages with `stageStart` and `stageEnd` on the session instead, and the
// nesting is checked through them.
test("timed gives each stage its own time, nested stages taken out of their parents", () => {
  let t = newTimings();
  t.manual = 0;
  let session = newSession();
  session.timings = t;
  const check = stageStart(session);
  spend(session, 10);
  const moves = stageStart(session);
  spend(session, 3);
  stageEnd(session, "moves", moves);
  const comptime = stageStart(session);
  spend(session, 2);
  const inner = stageStart(session);
  spend(session, 4);
  const innerMoves = stageStart(session);
  spend(session, 1);
  stageEnd(session, "moves", innerMoves);
  stageEnd(session, "check", inner);
  stageEnd(session, "comptime", comptime);
  let message = "";
  try {
    thrownStage(session, 5);
  } catch (e) {
    message = e.message;
  }
  same(message, "stop", "the throw");
  spend(session, 6);
  stageEnd(session, "check", check);
  const codegen = stageStart(session);
  spend(session, 7);
  stageEnd(session, "codegen", codegen);
  const timings: Ref<Timings> = session.timings!;
  const want: [string, f64][] = [["check", 20], ["moves", 4], ["comptime", 7], ["codegen", 7]];
  assert(timings.ms.size === want.length, `stages timed: ${JSON.stringify([...timings.ms.keys()])}`);
  for (const [stage, ms] of want) assert(timings.ms.get(stage) === ms, `${stage} took ${timings.ms.get(stage) ?? -1}, not ${ms}`);
  assert(timings.inner === 38, `inner is ${timings.inner}`);
  try {
    const five = timed(undefined, "check", () => 5);
    assert(five === 5, "timed without timings");
  } catch (e) {
    assert(false, e.message);
  }
});
