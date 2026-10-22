// panic: can't be copied
// A copy that panics part way through a value drops what it already copied.
interface Counter { bump(this: Mut<this>): i64; size(): i64; }
class Hits { n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } size(): i64 { return 1; } }
class Q { bump(this: Mut<this>): i64 { return 0; } size(): i64 { return 2; } }
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  let cs: Dyn<Counter>[] = [];
  cs.push(new Q());
  cs.push(new Q());
  cs.push(new Hits());
  const holder = { cs: cs };
  const f: Fn = async () => holder.cs[0].size();
  const n = await f();
  console.log(n);
}
