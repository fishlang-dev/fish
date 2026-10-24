// case: never_n12
// A never value is never read: code after a throw expression doesn't run.
function main() throws i64 {
  let x = throw 1
  let y: i64 = x
  print(y)
}
// fails: Error: 1
// case: never_n4
// A never value is never read: code after a throw expression doesn't run.
function f(c: boolean): i64 throws i64 {
  return c ? throw 1 : throw 2
}
function main() throws i64 { print(f(true)) }
// fails: Error: 1
// case: never_t10
// A never value is never read: code after a throw expression doesn't run.
function f(): void throws i64 { return throw 5 }
function main() throws i64 { f() }
// fails: Error: 5
// case: never_t11
// A never value is never read: code after a throw expression doesn't run.
function show(v: i64 | boolean): i64 { return typeof v === "number" ? v : 0 }
function f(c: boolean): i64 | boolean throws i64 {
  return c ? true : throw 1
}
function g(c: boolean): i64 | boolean throws i64 {
  if (c) return true
  return throw 2
}
function main() throws i64 { print(f(true)); print(show(throw 3)) }
// expect: true
// fails: Error: 3
