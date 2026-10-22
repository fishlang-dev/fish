// error: can't clone a value holding an 'Atomic'
class Counter {
  hits: Atomic<i64> = new Atomic(0);
}

function main() {
  const c = new Counter();
  const d = c.clone();
}
