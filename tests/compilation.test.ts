import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/main.ts";
import { newTimings, timed } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";

const session = cachedSession();

// Each compilation has its own state, so a program compiles the same whatever the process
// compiled before it. These programs use what a compilation numbers or interns as it goes:
// enums, macro expansions, local generic functions, destructuring assignments, local classes,
// derived equality over a base, and object, union and closure types.

const A = `macro function withExtra(input: AstStmt): Ast[] {
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

const B = `enum Size { Small = 10, Large = 20 }
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

const dir = mkdtempSync(join(tmpdir(), "fish-compilation-"));
const ir = (name: string, src: string) => {
  const file = join(dir, name);
  writeFileSync(file, src);
  return compile(session, src, file);
};

test("a program compiles the same twice in one process", () => {
  expect(ir("a.fsh", A)).toBe(ir("a.fsh", A));
});

test("two programs compiled alternately in one process each compile the same every time", () => {
  const [a, b] = [ir("a.fsh", A), ir("b.fsh", B)];
  expect(ir("a.fsh", A)).toBe(a);
  expect(ir("b.fsh", B)).toBe(b);
  expect(ir("a.fsh", A)).toBe(a);
});

// A stage timed inside another counts only toward itself, and the outer stage keeps the rest,
// however deeply nested, repeated, or ended by a throw.
test("timed gives each stage its own time, nested stages taken out of their parents", () => {
  let clock = 0;
  const t = newTimings(() => clock);
  const spend = (ms: number) => (clock += ms);
  timed(t, "check", () => {
    spend(10);
    timed(t, "moves", () => spend(3));
    timed(t, "comptime", () => {
      spend(2);
      timed(t, "check", () => {
        spend(4);
        timed(t, "moves", () => spend(1));
      });
    });
    expect(() =>
      timed(t, "comptime", () => {
        spend(5);
        throw new Error("stop");
      }),
    ).toThrow("stop");
    spend(6);
  });
  timed(t, "codegen", () => spend(7));
  expect(Object.fromEntries(t.ms)).toEqual({ check: 20, moves: 4, comptime: 7, codegen: 7 });
  expect(t.inner).toBe(38);
  expect(timed(undefined, "check", () => 5)).toBe(5);
});
