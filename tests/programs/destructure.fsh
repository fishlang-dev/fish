// case: destructure_array_moves
// error: an array pattern reads each element as 'xs[i]', and a 'P' would be moved out of the array, leaving a hole
class P { n: i64 = 1; } function main() { const ps = [new P()]; const [p] = ps; }
// case: destructure_array_short
// panic: index out of bounds: the len is 2 but the index is 2
function main() { const [a, b, c] = "x,y".split(","); console.log(a, b, c); }
// case: destructure_declarations
// expect: 1 ann1 none 5 2 bee
// expect: s1 3
// expect: x y missing 0
// expect: 10
// expect: 1 w2 3
// Object and array patterns in declarations: renames, defaults for null fields, nesting, rest,
// holes, tuples, arrays of copies with defaults and rest, and let names that change.
class P { n: i64; constructor(n: i64) { this.n = n; } }
type User = { id: i64; name: string; tag: string | null; pet: P; extra: { a: i64; b: string } };
function main() {
  const u: User = { id: 1, name: "ann" + 1, tag: null, pet: new P(5), extra: { a: 2, b: "bee" } };
  const { id, name: label, tag = "none", pet, extra: { a, b }, ...rest } = u;
  console.log(id, label, tag, pet.n, a, b);
  const t: [string, i64, P] = ["s" + 1, 2, new P(3)];
  const [first, , third] = t;
  console.log(first, third.n);
  const parts = "x,y,z".split(",");
  const [p0, p1 = "d", , p3 = "missing", ...others] = parts;
  console.log(p0, p1, p3, others.length);
  let { n } = new P(9);
  n = n + 1;
  console.log(n);
  const v = { q: 1, r: "w" + 2, s: 3 };
  const { q, ...left } = v;
  console.log(q, left.r, left.s);
}
// case: destructure_index_once
// expect: 1 2 1
// expect: f
// expect: 3 4
// expect: 3
// An index along a destructured path runs once, however many parts read through it.
type Pt = { x: i64; y: i64 };
function f(): usize { console.log("f"); return 1; }
function main() {
  const ps: Pt[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  let i: usize = 0;
  const { x, y } = ps[i++];
  console.log(x, y, i);
  const { x: a, y: b } = ps[f()];
  console.log(a, b);
  const { x: c } = ps[1 + 0];
  console.log(c);
}
// case: destructure_missing_field
// error: property 'zz' does not exist on type '{ a: i64 }'
function main() { const { zz } = { a: 1 }; }
// case: destructure_moved
// error: 'o.p.n' can't be used here because 'o.p' was moved
class P { n: i64 = 1; } function main() { const o = { p: new P(), k: 3 }; const { p } = o; console.log(o.p.n); }
// case: destructure_moves
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
// case: destructure_not_object
// error: '{ ... }' destructures an object or an instance, not 'i64'
function main() { const { a } = 5; }
// case: destructure_param_default
// error: a destructured parameter can't have a default yet; give the default to the parts
type Point = { x: i64 }; function f({ x }: Point = { x: 1 }): i64 { return x; } function main() {}
// case: destructure_params
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
// case: destructure_property
// error: a parameter property can't be destructured; it names one field
class C { constructor(public { a }: { a: i64 }) {} } function main() {}
// case: destructure_sources
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
// case: destructure_tuple_rest
// error: rest elements in tuple patterns are not supported yet
function main() { const t: [i64, i64, i64] = [1, 2, 3]; const [a, ...r] = t; }
// case: destructuring_assignment
// expect: b2 a1
// expect: p1 2
// expect: 5 0 6
// expect: 1 2
// expect: 1 20
// expect: in1 9
// expect: 2 1
// expect: 7 8
// expect: 5 8
class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) { this.x = x; this.y = y; }
  flip(this: Mut<this>): void { [this.x, this.y] = [this.y, this.x]; }
}
function pair(): [string, i64] { return ["p" + 1, 2]; }
function main() {
  let a = "a" + 1;
  let b = "b" + 2;
  [a, b] = [b, a];
  console.log(a, b);
  let n = 0;
  let s = "";
  [s, n] = pair();
  console.log(s, n);
  let x = 0, y = 0, z = 0;
  ({ x, y: z } = { x: 5, y: 6 });
  console.log(x, y, z);
  let first = 0;
  let rest: i64[] = [];
  [first, ...rest] = [1, 2, 3];
  console.log(first, rest.length);
  let d = 0;
  let e = 0;
  [d = 10, e = 20] = [1];
  console.log(d, e);
  let deep = "";
  let k = 0;
  const inner: [string[], { k: i64 }] = [["in" + 1], { k: 9 }];
  [[deep], { k }] = inner;
  console.log(deep, k);
  let p = new Point(1, 2);
  p.flip();
  console.log(p.x, p.y);
  let xs = [0, 0];
  [xs[0], xs[1]] = [7, 8];
  console.log(xs[0], xs[1]);
  let i = 0, j = 1;
  for (let t = 0; t < 5; t++) [i, j] = [j, i + j];
  console.log(i, j);
}
// case: destructuring_assignment_value
// error: a destructuring assignment can only be a statement of its own, as in '[a, b] = [b, a];', since its value can't be used here
function main() {
  let a = 1, b = 2;
  console.log([a, b] = [b, a]);
}
// case: destructuring_assignment_constant
// error: cannot assign to 'a' because it is a constant
function main() {
  const a = 1;
  let b = 2;
  [a, b] = [3, 4];
}
// case: destructuring_assignment_readonly
// error: cannot assign to 'x' because it is a read-only property
class P {
  readonly x: i64 = 1;
}
function main() {
  let p = new P();
  [p.x] = [2];
}
// case: destructuring_assignment_forupdate
// error: a destructuring assignment can only be a statement of its own, as in '[a, b] = [b, a];', since its value can't be used here
function main() {
  let i = 0, j = 1;
  for (let t = 0; t < 3; [i, j] = [j, i + j]) t++;
}
// case: destructuring_assignment_review_def
// expect: 5 5
// expect: 7 7
function main() {
  let a = 0, b = 0;
  [a, b = a] = [5];
  console.log(a, b);
  let x = 0, y = 0;
  const src: { x: i64; y?: i64 } = { x: 7 };
  ({ x, y = x } = src);
  console.log(x, y);
}
// case: destructuring_assignment_review_buf
// expect: 1 0
function main() {
  let prev: i64[] = [0, 0];
  let curr: i64[] = [1, 1];
  [prev, curr] = [curr, prev];
  console.log(prev[0], curr[0]);
}
// case: destructuring_assignment_review_mixed
// expect: x 1
function main() {
  let s = "";
  let n = 0;
  [s, n] = ["x", 1];
  console.log(s, n);
}
// case: destructuring_assignment_review_lit_u8
// expect: 1
function main() {
  let a: u8 = 0;
  [a] = [1];
  console.log(a);
}
// case: destructuring_assignment_review_lit_union
// expect: on
function main() {
  let k: "on" | "off" = "off";
  [k] = ["on"];
  console.log(k);
}
// case: destructuring_assignment_review_narrow
// expect: 5
function main() {
  let v: string | i64 = "s" + 1;
  if (typeof v === "string") {
    [v] = [5];
  }
  console.log(v);
}
// case: destructuring_assignment_review_ctor
// expect: a1 2
// expect: b1 3
class P {
  x: string;
  y: i64;
  constructor(x: string, y: i64) { [this.x, this.y] = [x, y]; }
}
class Q {
  x: string;
  y: i64;
  constructor(x: string, y: i64) { ({ x: this.x, y: this.y } = { x, y }); }
}
function main() {
  const p = new P("a" + 1, 2);
  console.log(p.x, p.y);
  const q = new Q("b" + 1, 3);
  console.log(q.x, q.y);
}
// case: destructuring_assignment_review_ref
// expect: x
class C { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let x = new C("x");
  let r: Ref<C> = x;
  ({ r } = { r: x });
  console.log(r.s);
}
// case: destructuring_assignment_rereview_place
// expect: 1 2 1
// expect: m1 n2 m1
function main() {
  const point = { x: 1, y: 2 };
  let x = 0, y = 0;
  ({ x, y } = point);
  console.log(x, y, point.x);
  const pair: [string, string] = ["m" + 1, "n" + 2];
  let u = "", w = "";
  [u, w] = pair;
  console.log(u, w, pair[0]);
}
// case: destructuring_assignment_rereview_t1
// expect: q2 p1
// expect: m1 n2 m1 n2
// expect: X1 Y2 X1
function main() {
  let s1 = "p" + 1, s2 = "q" + 2;
  [s1, s2] = [s2, s1];
  console.log(s1, s2);
  // place source
  let pair: [string, string] = ["m" + 1, "n" + 2];
  let u = "", w = "";
  [u, w] = pair;
  console.log(u, w, pair[0], pair[1]);
  // object source
  let pt = { x: "X" + 1, y: "Y" + 2 };
  let px = "", py = "";
  ({ x: px, y: py } = pt);
  console.log(px, py, pt.x);
}
// case: destructuring_assignment_rereview_own
// expect: t0 t1
// expect: took m0
// expect: m1
// expect: q0 p0
// expect: u1
// expect: k0 1 1
class C { s: string; constructor(s: string) { this.s = s; } }
function take(c: C): void { console.log("took", c.s); }
function main() {
  // tuple of instances, place source: partial move
  let t: [C, C] = [new C("t" + 0), new C("t" + 1)];
  let a = new C("a" + 0);
  let b = new C("b" + 0);
  [a, b] = t;
  console.log(a.s, b.s);
  // moved target re-assigned
  let m = new C("m" + 0);
  take(m);
  ({ m } = { m: new C("m" + 1) });
  console.log(m.s);
  // swap through a tuple-typed temporary
  let p = new C("p" + 0), q = new C("q" + 0);
  const sw: [C, C] = [q, p];
  [p, q] = sw;
  console.log(p.s, q.s);
  // object source with instance fields, temporary
  let u = new C("u" + 0);
  ({ u } = { u: new C("u" + 1) });
  console.log(u.s);
  // object place source, partial move
  let o = { k: new C("k" + 0), n: 1 };
  let kk = new C("kk");
  let nn = 0;
  ({ k: kk, n: nn } = o);
  console.log(kk.s, nn, o.n);
}
// case: destructuring_assignment_rereview_r2e
// expect: 3
// expect: d3
// expect: 5
function pick<T>(x: T, init: T, d: T): T {
  let b = init;
  [b = d] = [x];
  return b;
}
function main() {
  console.log(pick<i64 | null>(null, 1, 3));
  console.log(pick<string | null>(null, "i" + 1, "d" + 3));
  console.log(pick<i64>(5, 1, 3));
}
// case: destructuring_assignment_rereview_r2b
// expect: 7
// expect: 2
// expect: q1
// expect: v1
class C { s: string; constructor(s: string) { this.s = s; } }
function pick<T>(xs: [T, T], fallback: T): T {
  let a = fallback.clone();
  let b = fallback;
  [a, b = a] = xs;
  return b;
}
function main() {
  const n: [i64 | null, i64 | null] = [7, null];
  console.log(pick<i64 | null>(n, 0));
  console.log(pick<i64>([1, 2], 0));
  const m: [string | null, string | null] = ["q" + 1, null];
  console.log(pick<string | null>(m, "f"));
  console.log(pick<string>(["u" + 1, "v" + 1], "f"));
}
// case: destructuring_assignment_rereview_nested
// expect: n m
class C { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let x = new C("a"), b = new C("b");
  [[x], b] = [[new C("n")], new C("m")];
  console.log(x.s, b.s);
}
// case: destructuring_assignment_rereview_r2a
// expect: mk
// expect: a1 b1
// expect: mk
// expect: b1
// expect: mk
// expect: a1 c1
// expect: obj
// expect: p1 r1
// expect: obj
// expect: p1 q1 r1
// expect: q2 tt1 u1 1
class C { s: string; constructor(s: string) { this.s = s; } }
function mk(): [C, C, C] { console.log("mk"); return [new C("a" + 1), new C("b" + 1), new C("c" + 1)]; }
function obj(): { p: C; q: C; r: string } { console.log("obj"); return { p: new C("p" + 1), q: new C("q" + 1), r: "r" + 1 }; }
function main() {
  let a = new C("x"), b = new C("y");
  [a, b] = mk();
  console.log(a.s, b.s);
  [, b] = mk();
  console.log(b.s);
  [a, , b] = mk();
  console.log(a.s, b.s);
  let p = new C("p"), r = "";
  ({ p, r } = obj());
  console.log(p.s, r);
  let rest = { q: new C("z"), r: "" };
  ({ p, ...rest } = obj());
  console.log(p.s, rest.q.s, rest.r);
  let n1 = [new C("n")];
  let x = new C("x0");
  let t: [C, string] = [new C("t"), "s"];
  [a, t] = [new C("q" + 2), [new C("tt" + 1), "u" + 1]];
  console.log(a.s, t[0].s, t[1], n1.length);
}
// case: destructuring_assignment_rereview_r2l
// expect: a
// expect: c
// expect: b
// expect: 1 2
// expect: get
// expect: get
// expect: g1 2
// expect: x
// expect: y
// expect: z
// expect: 7 8
function f(tag: string, n: i64): i64 { console.log(tag); return n; }
class G { get pair(): [string, i64] { console.log("get"); return ["g" + 1, 2]; } }
function main() {
  let a = 0, b = 0;
  ({ b, a } = { a: f("a", 1), c: f("c", 3), b: f("b", 2) });
  console.log(a, b);
  const g = new G();
  let s = "";
  let n = 0;
  [s, n] = g.pair;
  console.log(s, n);
  [a, b] = [f("x", 7), f("y", 8), f("z", 9)];
  console.log(a, b);
}
// case: destructuring_assignment_rereview_r2h
// expect: 5
// expect: z1 9
// expect: q1 1
function at(f: () => usize): usize { return f(); }
function put<T>(xs: Mut<T[]>, v: T): void {
  let k: usize = 1;
  [xs[at((): usize => k)]] = [v];
}
class Box { items: string[] = ["a" + 1, "b" + 1]; n: usize = 0;
  set(this: Mut<this>, s: string): void { [this.items[at((): usize => 0)], this.n] = [s, 1]; }
}
function main() {
  let xs: i64[] = [0, 0];
  let k: usize = 1;
  [xs[at((): usize => k)]] = [5];
  console.log(xs[1]);
  let ss = ["x" + 1, "y" + 1];
  put<string>(ss, "z" + 1);
  put<i64>(xs, 9);
  console.log(ss[1], xs[1]);
  let b = new Box();
  b.set("q" + 1);
  console.log(b.items[0], b.n);
}
// case: destructuring_assignment_rereview_r2f
// error: type '"str"' is not assignable to type 'i64 | null', what 'i64 | null' holds
function pick<T>(x: T, init: T): T {
  let b = init;
  [b = "str"] = [x];
  return b;
}
function main() {
  console.log(pick<i64 | null>(null, 1));
}
// case: destructuring_assignment_rereview_r2d
// error: 'fallback' was moved, so it can't be used here
function pick<T>(x: T, fallback: T): T {
  let b = fallback;
  [b = fallback] = [x];
  return b;
}
function main() {
  console.log(pick<i64 | null>(null, 3));
  console.log(pick<i64>(1, 3));
}
