// panic: this Dyn's value can't be cloned
// A Dyn whose interface changes its value clones it, and an Atomic can't be cloned.
interface Counter {
  count(this: Mut<this>): i64;
}

class Hits {
  n: Atomic<i64> = new Atomic(0);
  count(this: Mut<this>): i64 {
    return this.n.load();
  }
}

function main() {
  const d: Dyn<Counter> = new Hits();
  const e = d.clone();
}
