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
