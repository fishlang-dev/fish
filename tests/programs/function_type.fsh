// A function type describes closures; a value that isn't one doesn't fit it.
function main() {
  let f: (x: i64) => i64 = 1
}
// error: type 'i64' is not assignable to type '(x: i64) => i64'
