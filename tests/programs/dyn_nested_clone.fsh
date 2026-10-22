// panic: this Dyn's value can't be cloned
interface Counter { bump(): i64; }
interface Outerish { total(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
}
class Outer {
  inner: Dyn<Counter>;
  constructor(c: Dyn<Counter>) { this.inner = c; }
  total(): i64 { return this.inner.bump(); }
}
function main() {
  const d: Dyn<Outerish> = new Outer(new Hits());
  const a = d.total();
  const b = d.total();
  const e = d.clone();
  const x = d.total();
  const y = e.total();
  const z = d.total();
  console.log(a, b, x, y, z);
  const h: Dyn<Counter> = new Hits();
  const h1 = h.bump();
  const h2 = h.bump();
  console.log(h1, h2);
}
