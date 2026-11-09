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
