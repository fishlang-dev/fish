// expect: 1
// expect: h1
// A Dyn holding pinned state whose class has its own clone copies through that clone.
interface Counter { name: string; bump(this: Mut<this>): i64; }
class Hits {
  name: string = "h" + String(1);
  n: Atomic<i64> = new Atomic(0);
  bump(this: Mut<this>): i64 { return this.n.add(1); }
  clone(): Hits { let h = new Hits(); h.n.store(this.n.load()); return h; }
}
type Fn = () => Promise<string>;
async function main(): Promise<void> {
  let c: Dyn<Counter> = new Hits();
  c.bump();
  let d = c.clone();
  console.log(d.bump());
  const holder = { c: c };
  const f: Fn = async () => holder.c.name;
  const s = await f();
  console.log(s);
}
