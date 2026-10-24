// expect: 19 10 4 1
// expect: x1 x1 3
// expect: 7
// expect: 1
// expect: 5
// expect: a1 1
// expect: b 2
// FixedArray holds its elements inline: literals and filled, copies of Copy elements, indexing
// and writes, length, and for...of with patterns.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(a: FixedArray<i64, 4>): i64 {
  let t = 0;
  for (const x of a) t += x;
  return t;
}
function make(): FixedArray<string, 3> { return FixedArray.filled<string, 3>("x" + 1); }
function main() {
  let a: FixedArray<i64, 4> = [1, 2, 3, 4];
  const b = a;
  a[0] = 10;
  console.log(sum(a), sum(b), a.length, b[0]);
  const ws = make();
  console.log(ws[0], ws[2], ws.length);
  const filled: FixedArray<i64, 3> = FixedArray.filled(7);
  console.log(filled[1]);
  let ps: FixedArray<P, 2> = [new P(1), new P(2)];
  ps[1].n = 5;
  for (const p of ps) console.log(p.n);
  const pairs: FixedArray<[string, i64], 2> = [["a" + 1, 1], ["b", 2]];
  for (const [k, v] of pairs) console.log(k, v);
}
