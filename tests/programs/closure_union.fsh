// expect: 1
// expect: 42
// A union holds a function as a stored callable.
function pick(u: i64 | ((n: i64) => i64)): i64 {
  if (typeof u === "number") return u;
  return u(21);
}
function main() {
  let u: i64 | ((n: i64) => i64) = 1;
  console.log(pick(u));
  const o = { f: (n: i64) => n * 2 };
  console.log(o.f(21));
}
