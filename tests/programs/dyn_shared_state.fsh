// expect: 0 1 2
// expect: 3
// A Dyn whose interface changes nothing is shared by its copies, so state it keeps in an Atomic
// is one state, through an async callable's calls too.
interface Counter { next(): i64; }
class Ticks { n: Atomic<i64> = new Atomic(0); next(): i64 { return this.n.add(1); } }
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const f: Fn = async () => holder.counter.next();
  const a = await f();
  const b = await f();
  const c = await f();
  console.log(a, b, c);
  const g = f.clone();
  const d = await g();
  console.log(d);
}
