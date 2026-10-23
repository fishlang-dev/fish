// expect: x1 3
// expect: y2 4
// expect: 30
// expect: 40
// expect: 14
// expect: p1 1
// expect: q2 5
// expect: a1 1
// expect: b2 2
// expect: 7 seven
// expect: 7 2 2
// Patterns in a for...of head: tuple and object elements taken apart, holes and renames, parts
// of borrowed elements borrowed so the arrays stay usable, and a generator's tuples.
class P { x: i64; y: i64; tag: string; constructor(x: i64, y: i64, tag: string) { this.x = x; this.y = y; this.tag = tag; } }
class Box { n: i64; constructor(n: i64) { this.n = n; } }
function* pairs(): Generator<[string, i64]> { yield ["a" + 1, 1]; yield ["b" + 2, 2]; }
function main() {
  const counts: [string, i64][] = [["x" + 1, 3], ["y" + 2, 4]];
  for (const [name, n] of counts) console.log(name, n);
  for (const [, n] of counts) console.log(n * 10);
  const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  let total = 0;
  for (const { x, y } of points) total += x * y;
  console.log(total);
  const ps = [new P(1, 2, "p" + 1), new P(5, 6, "q" + 2)];
  for (const { tag: label, x } of ps) console.log(label, x);
  for (const [k, v] of pairs()) console.log(k, v);
  const boxes: [Box, string][] = [[new Box(7), "seven"]];
  for (const [b, s] of boxes) console.log(b.n, s);
  console.log(boxes[0][0].n, counts.length, ps.length);
}
