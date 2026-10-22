// panic: this Dyn's value can't be cloned
interface Counter {
  count(): i64;
}

class Hits {
  n: Atomic<i64> = new Atomic(0);
  count(): i64 {
    return this.n.load();
  }
}

function main() {
  const d: Dyn<Counter> = new Hits();
  const e = d.clone();
}
