// expect: 5 2 1
// expect: 1 3
// expect: 3 s3 3
// Destructuring a place moves only the parts it names, as Rust's let does; copies leave it whole,
// and a borrowed value lends its parts.
class P { n: i64 = 1; }
class Q { n: i64; s: string; constructor(n: i64) { this.n = n; this.s = "s" + n; } }
function show(q: Ref<Q>): string { const { n, s } = q; return `${n} ${s}`; }
function main() {
  const o = { a: 1, b: 2 };
  let { a, b } = o;
  a = 5;
  console.log(a, b, o.a);
  const h = { p: new P(), k: 3 };
  const { p } = h;
  console.log(p.n, h.k);
  const q = new Q(3);
  console.log(show(q), q.n);
}
