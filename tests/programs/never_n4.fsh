// A never value is never read: code after a throw expression doesn't run.
function f(c: boolean): i64 throws i64 {
  return c ? throw 1 : throw 2
}
function main() throws i64 { print(f(true)) }
// fails: Error: 1
