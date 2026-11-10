// case: callback_shared_across_closures
// expect: 5 3
// expect: t4,t3,t2,t1
// expect: ab 2
function walk(n: i64, each: (x: i64) => boolean): i64 {
  if (n === 0) return 0;
  return (each(n) ? n : 0) + walk(n - 1, each);
}
function main() {
  let a = 1;
  let seen: string[] = [];
  const tag = "t";
  console.log(walk(3, (x) => x > a), walk(4, (x) => { seen.push(`${tag}${x}`); return x < 3; }));
  console.log(seen.join(","));
  const owned = "a" + "b";
  console.log(owned, walk(2, (x) => (owned.length as i64) === x));
}
// case: callback_shared_panics_in_the_callback
// panic: attempt to divide by zero
function walk(n: i64, each: (x: i64) => i64): i64 {
  if (n < 0) return 0;
  return each(n) + walk(n - 1, each);
}
function main() {
  const name = "z".repeat(3);
  let held: string[] = ["k".repeat(2)];
  console.log(walk(2, (x) => 10 / x + (name.length as i64)));
  console.log(walk(1, (x) => { held.push(name); return x; }));
}
// case: callback_shared_throws
// expect: caught bad 2
// expect: 3
function walk(n: i64, each: (x: i64) => i64 throws Error): i64 throws Error {
  if (n === 0) return 0;
  return each(n) + walk(n - 1, each);
}
function main() {
  const limit = 2;
  try {
    console.log(walk(3, (x) => { if (x === limit) throw new Error("bad " + String(x)); return x; }));
  } catch (e) {
    console.log("caught " + e.message);
  }
  try {
    console.log(walk(2, (x) => x));
  } catch (e) {
    console.log("no");
  }
}
// case: callback_shared_mutating_closures_handed_on
// expect: 2 2 20
function walk(n: i64, each: (x: i64) => void): void {
  if (n > 0) {
    each(n);
    walk(n - 1, each);
  }
}
function main() {
  let a: i64[] = [];
  let b: i64[] = [];
  walk(2, (x) => { a.push(x); });
  walk(2, (x) => { b.push(x * 10); });
  console.log(a.length, b.length, b[0]);
}
// case: callback_shared_handed_on_at_another_place
// expect: 2
// expect: 3
function two(n: i64, a: () => i64, b: () => i64): i64 {
  if (n === 0) return a();
  return two(n - 1, b, a);
}
function main() {
  console.log(two(1, () => 1, () => 2));
  console.log(two(2, () => 3, () => 4));
}
// case: callback_shared_generic_function_value_at_two_types
// expect: 1s
// expect: 2t
function both(f: <T>(x: T) => T, n: i64, s: string): string {
  const a = f(n);
  const b = f(s);
  return `${a}${b}`;
}
function id<T>(x: T): T { return x; }
function same<T>(x: T): T { return x; }
function main() {
  console.log(both(id, 1, "s"));
  console.log(both(same, 2, "t"));
}
// case: callback_shared_one_throwing_and_one_quiet
// expect: 1
// expect: bad
function walk(n: i64, each: (x: i64) => i64 throws Error): i64 throws Error {
  if (n === 0) return 0;
  return each(n) + walk(n - 1, each);
}
function main() {
  const quiet = (x: i64) => x;
  const loud = (_x: i64): i64 throws Error => { throw new Error("bad"); };
  try {
    console.log(walk(1, quiet));
    console.log(walk(1, loud));
  } catch (e) {
    console.log(e.message);
  }
}
// case: callback_shared_handed_on_before_a_call
// expect: aa 1
// expect: bb 1
function next(n: i64): i64 { return n - 1; }
function walk(each: (x: i64) => void, n: i64): void {
  if (n > 0) {
    each(n);
    walk(each, next(n));
  }
}
function main() {
  const s = "a".repeat(2);
  const t = "b".repeat(2);
  walk(move (x: i64) => console.log(s, x), 1);
  walk(move (x: i64) => console.log(t, x), 1);
}
// case: callback_shared_async_closures_called_for_a_future
// expect: end
async function wait(p: Promise<void>): Promise<void> { await p; }
function fire(f: () => Promise<void>): void { const _p = wait(f()); }
function main() {
  fire(async () => { console.log("a"); });
  fire(async () => { console.log("b"); });
  console.log("end");
}
