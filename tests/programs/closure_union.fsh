// A union can't hold a function yet.
function main() {
  let u: i64 | (() => i64) = 1
}
// error: unions holding functions are not supported yet
