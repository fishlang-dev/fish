// expect: 11 21
// expect: 11 21
// A stored callable capturing other callables clones each of them through its own vtable.
type Fn = (n: i64) => i64;
function main() {
  let fns: Fn[] = [];
  fns.push((n: i64) => n + 1);
  fns.push((n: i64) => n * 2 + 1);
  const holder = { fns: fns };
  const both: Fn = (n: i64) => holder.fns[0](n) * 100 + holder.fns[1](n);
  const again = both.clone();
  console.log(both(10) / 100, both(10) % 100);
  console.log(again(10) / 100, again(10) % 100);
}
