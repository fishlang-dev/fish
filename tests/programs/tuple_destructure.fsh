// expect: 3 2
// expect: 2 x1 1 x1
// expect: 4 s1
// expect: 1
// expect: x1 1
// expect: b2 2 10,20
// Destructuring tuples into names, holes skipping elements, and tuples in arrays.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function divmod(a: i64, b: i64): [i64, i64] { return [a / b, a % b]; }
function both(): [P, string] { return [new P(4), "s" + 1]; }
function swap<A, B>(t: [A, B]): [B, A] { const [a, b] = t; return [b, a]; }
function main() {
  const [q, r] = divmod(17, 5);
  console.log(q, r);
  const t: [i64, string] = [1, "x" + 1];
  let [n, s] = t;
  n += 1;
  console.log(n, s, t[0], t[1]);
  const [p, label] = both();
  console.log(p.n, label);
  const [, only] = divmod(9, 4);
  console.log(only);
  const sw = swap<i64, string>(t);
  console.log(sw[0], sw[1]);
  const pairs: [string, i64][] = [["a", 1], ["b" + 2, 2]];
  console.log(pairs[1][0], pairs.length, pairs.map((x) => x[1] * 10).join());
}
