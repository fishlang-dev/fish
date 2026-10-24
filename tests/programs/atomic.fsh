// case: atomic_add_boolean
// error: 'add' needs an integer 'Atomic', not 'Atomic<boolean>'
function main() {
  const a = new Atomic(true);
  a.add(true);
}
// case: atomic_clone
// error: can't clone an 'Atomic', which is changed in place wherever it is shared
function main() {
  const a = new Atomic(1);
  const b = a.clone();
  console.log(b.load());
}
// case: atomic_holder_clone
// error: can't clone a value holding an 'Atomic'
class Counter {
  hits: Atomic<i64> = new Atomic(0);
}

function main() {
  const c = new Counter();
  const d = c.clone();
}
// case: atomic_in_union_field
// error: 'add' works on the 'Atomic' where it lives, so call it on a variable or a field; narrow a union to one member first
type U = { k: "a"; c: Atomic<i64> } | { k: "b"; c: Atomic<i64> };
function main() {
  const u: U = { k: "a", c: new Atomic(1) };
  u.c.add(5);
  console.log(u.c.load());
}
// case: atomic_methods
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
// case: atomic_of_string
// error: 'Atomic' holds an integer or a boolean, not 'string'; use a 'Lock' for other values
function main() {
  const a = new Atomic("one");
}
// case: atomic_through_unwrap
// error: 'add' works on the 'Atomic' where it lives, so call it on a variable or a field; narrow the Option
function main() {
  const a: Option<Atomic<i64>> = new Atomic(1);
  a!.add(2);
  console.log(a!.load());
  const b: Option<Atomic<boolean>> = new Atomic(true);
  b!.store(false);
  console.log(b!.load());
  const c: Option<Lock<i64>> = new Lock(1);
  c!.update((v) => { v += 5; });
  console.log(c!.update((v) => v + 0));
  const d: Option<Cell<i64>> = new Cell(1);
  d!.set(7);
  console.log(d!.get());
}
// case: atomic_wrong_argument
// error: is not assignable to parameter of type 'i64'
function main() {
  const a = new Atomic(1);
  a.store("two");
}
