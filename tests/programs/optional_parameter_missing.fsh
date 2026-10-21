// A call gives at least the parameters that aren't optional.
function g(a: i64, b?: i64) {}
function main() {
  g()
}
// error: expected 1-2 arguments, but got 0
