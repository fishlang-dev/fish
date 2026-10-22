// expect: 0
// panic: this Dyn's value can't be cloned
// A callable capturing a Dyn whose value holds an Atomic can't be cloned: the clone panics.
interface Counter { next(): i64; }
class Ticks { n: Atomic<i64> = new Atomic(0); next(): i64 { return this.n.add(1); } }
type Fn = () => i64;
function main() {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const tick: Fn = () => holder.counter.next();
  console.log(tick());
  const again = tick.clone();
  console.log(again());
}
