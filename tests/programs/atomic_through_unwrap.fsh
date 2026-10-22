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
