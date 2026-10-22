// panic: can't be copied
// A Dyn whose interface changes its value is copied by cloning; one holding an Atomic can't
// be, so the copy an async callable makes for its call panics rather than split the state.
interface Counter { label: string; bump(this: Mut<this>): i64; }
class Ticks { label: string = "ticks"; n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } }
type Fn = () => Promise<string>;
async function main(): Promise<void> {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const f: Fn = async () => holder.counter.label;
  const r = await f();
  console.log(r);
}
