// expect: 3 2
// expect: n3 6 n3
// expect: 5 b2
// expect: 1 2
// expect: y2
// Tuples as return values, annotations and generic results: elements read and written by
// index, and a tuple of Copy elements copied.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function divmod(a: i64, b: i64): [i64, i64] { return [a / b, a % b]; }
function named(n: i64): [string, i64] { return ["n" + n, n * 2]; }
function pair<T>(x: T, y: T): [T, T] { return [x, y]; }
function main() {
  const r = divmod(17, 5);
  console.log(r[0], r[1]);
  const t: [string, i64] = named(3);
  const u = t;
  console.log(t[0], t[1], u[0]);
  let m: [i64, string] = [1, "a" + 1];
  m[0] = 5;
  m[1] = "b" + 2;
  console.log(m[0], m[1]);
  const pp = pair(new P(1), new P(2));
  console.log(pp[0].n, pp[1].n);
  const ps = pair("x" + 1, "y" + 2);
  console.log(ps[1]);
}
