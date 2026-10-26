import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// Values printed by a Fish program and by the same program in JavaScript under node, which
// must print the same text. A data enum has no JavaScript form, so its line is written out.
const tmp = mkdtempSync(join(tmpdir(), "fish-print-"));

const FISH = String.raw`type P = { name: string; tags: string[]; n?: i64; v: i64 | null };
class Point { constructor(public x: i64, public y: i64) {} }
class Named extends Point { #hidden: i64 = 1; constructor(public label: string) { super(1, 2); } }
enum Color { Red = "red", Green = "green" }
enum Num { One = 1, Two = 2 }
enum Shape { Circle(f64), Rect(i64, i64), Dot }
type Tree = { v: i64; kids: Tree[] };
function main() {
  const p: P = { name: "ann", tags: ["a", "b"], v: null };
  console.log(p);
  console.log(new Point(1, 2), new Named("n"));
  console.log([1, 2, 3], ["x", "y"], [[1, [2, [3, [4]]]]]);
  let m = new Map<string, Point>();
  m.set("a", new Point(3, 4));
  let s = new Set<string>();
  s.add("q");
  console.log(m, s);
  console.log(Color.Red, Num.Two, { c: Color.Green, n: Num.One });
  console.log(Shape.Circle(2.5), Shape.Rect(1, 2), Shape.Dot, [Shape.Dot, Shape.Circle(1)]);
  const t: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  console.log(t);
  const u: i64 | string | Point = new Point(5, 6);
  const w: i64 | string | Point = "raw";
  console.log(u, w, "top", 1.5, true);
  const tup: [i64, string] = [1, "s"];
  console.log(tup, { tup });
  let big: i64[] = [];
  for (let i = 0; i < 130; i++) big.push(i);
  console.log(big);
}
`;

const NODE = String.raw`class Point { constructor(x, y) { this.x = x; this.y = y; } }
class Named extends Point { #hidden = 1; constructor(label) { super(1, 2); this.label = label; } }
const p = { name: "ann", tags: ["a", "b"], v: null };
console.log(p);
console.log(new Point(1, 2), new Named("n"));
console.log([1, 2, 3], ["x", "y"], [[1, [2, [3, [4]]]]]);
const m = new Map([["a", new Point(3, 4)]]); const s = new Set(["q"]);
console.log(m, s);
console.log("red", 2, { c: "green", n: 1 });
console.log("Circle(2.5) Rect(1, 2) Dot [ Dot, Circle(1) ]");
console.log({ kids: [{ kids: [], v: 2 }], v: 1 });
console.log(new Point(5, 6), "raw", "top", 1.5, true);
console.log([1, "s"], { tup: [1, "s"] });
console.log(Array.from({ length: 130 }, (_, i) => i));
`;

test("console.log prints values as node prints them", () => {
  const program = join(tmp, "main.fsh");
  writeFileSync(program, FISH);
  const out = join(tmp, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const node = Bun.spawnSync(["node", "-e", NODE]);
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
  expect(fish.stderr.toString()).toBe("");
});
