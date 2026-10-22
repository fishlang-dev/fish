// expect: 5 5 7 9 9 4
// expect: 4 false 4 true 11
// expect: 250 0 0
// expect: false true true false
// expect: 3
function bump(n: Ref<Atomic<i64>>) {
  n.add(1);
}

class Counter {
  hits: Atomic<i64> = new Atomic(0);
}

function main() {
  const a = new Atomic(5);
  const loaded = a.load();
  const before = a.add(2);
  const added = a.load();
  a.store(9);
  const stored = a.load();
  const swapped = a.exchange(4);
  console.log(loaded, before, added, stored, swapped, a.load());
  const failed = a.compareExchange(5, 10);
  const same = a.load() === 4;
  const won = a.compareExchange(4, 11);
  console.log(failed, !same, won, a.load() === 11, a.load());
  const b: Atomic<u8> = new Atomic(250);
  const old = b.add(6);
  console.log(old, b.load(), b.sub(1));
  const flag = new Atomic(false);
  console.log(flag.exchange(true), flag.load(), flag.compareExchange(true, false), flag.load());
  const c = new Counter();
  bump(c.hits);
  bump(c.hits);
  c.hits.add(1);
  console.log(c.hits.load());
}
