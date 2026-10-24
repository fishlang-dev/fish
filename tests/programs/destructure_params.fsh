// expect: 25 a1
// expect: 2 7 2
// expect: a=1&b=2
// expect: 3
// expect: 5
// Destructured parameters on functions, constructors, methods and callbacks.
type Point = { x: i64; y: i64 };
class P { n: i64; constructor(n: i64) { this.n = n; } }
function len({ x, y }: Point): i64 { return x * x + y * y; }
function first([a, b]: [string, i64]): string { return `${a}${b}`; }
class Box { v: i64; constructor({ x }: Point) { this.v = x; } add({ y = 0 }: { y: i64 | null }): i64 { return this.v + y; } }
function own({ p, k }: { p: P; k: i64 }): i64 { return p.n + k; }
function main() {
  console.log(len({ x: 3, y: 4 }), first(["a", 1]));
  const b = new Box({ x: 2, y: 9 });
  console.log(b.v, b.add({ y: 5 }), b.add({ y: null }));
  const pairs: [string, i64][] = [["a", 1], ["b", 2]];
  console.log(pairs.map(([k, v]) => `${k}=${v}`).join("&"));
  const pts: Point[] = [{ x: 1, y: 2 }];
  console.log(pts.map(({ x, y }) => x + y).join());
  console.log(own({ p: new P(4), k: 1 }));
}
