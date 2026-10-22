// panic: can't be copied
// A copy that panics part way through a value drops what it already copied.
interface Counter { bump(this: Mut<this>): i64; }
class Hits { n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } }
interface Plain { get(): i64; }
class P { get(): i64 { return 1; } }
interface Outer { total(): i64; poke(this: Mut<this>): void; }
class O {
  a: string; b: Dyn<Plain>; c: string[]; z: Dyn<Counter>;
  constructor(c: Dyn<Counter>) { this.a = "o" + String(1); this.b = new P(); this.c = ["x" + String(2)]; this.z = c; }
  total(): i64 { return this.a.length as i64; }
  poke(this: Mut<this>) { this.z.bump(); }
}
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  let o: Dyn<Outer> = new O(new Hits());
  const holder = { o: o };
  const f: Fn = async () => holder.o.total();
  const n = await f();
  console.log(n);
}
