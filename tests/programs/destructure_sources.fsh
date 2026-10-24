// expect: get
// expect: 1 2 3
// expect: 3 s3
// expect: s4 4
// expect: 8
// expect: 1 2
// expect: 5 6
// expect: 1
// expect: 1 2 1
// Patterns over a getter's result (read once), an instance with rest, a borrowed array with a
// default, a derived constructor's destructured parameter, a top-level const and an element.
class P { n: i64; constructor(n: i64) { this.n = n; } }
class S { get inner(): { o: { x: i64; y: i64; p: P } } { console.log("get"); return { o: { x: 1, y: 2, p: new P(3) } }; } }
class Q { n: i64; s: string; constructor(n: i64) { this.n = n; this.s = "s" + n; } }
type Pt = { x: i64; y: i64 };
class B { x: i64; constructor(x: i64) { this.x = x; } }
class D extends B { y: i64; constructor({ x, y }: Pt) { super(x); this.y = y; } }
class E { constructor(public k: i64, { x }: Pt) { console.log(k, x); } }
const CFG = { a: 1, s: "x", inner: { xs: [1, 2] } };
function f(xs: Ref<i64[]>): i64 { const [a, b = 7] = xs; return a + b; }
function main() {
  const s = new S();
  const { x, y, p } = s.inner.o;
  console.log(x, y, p.n);
  const q = new Q(3);
  const { n, ...r } = q;
  console.log(n, r.s);
  const { s: t, ...r2 } = new Q(4);
  console.log(t, r2.n);
  console.log(f([1]));
  const d = new D({ x: 1, y: 2 });
  console.log(d.x, d.y);
  new E(5, { x: 6, y: 7 });
  const { inner } = CFG;
  console.log(inner.xs[0]);
  const ps: Pt[] = [{ x: 1, y: 2 }];
  const { x: px, y: py } = ps[0];
  console.log(px, py, ps.length);
}
