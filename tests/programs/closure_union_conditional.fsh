// A union can't hold two closures.
function apply(f: () => i64): i64 { return f() }
function main() {
  const c = true
  const f = c ? () => 1 : () => 2
  print(apply(f))
}
// error: unions holding functions are not supported yet
