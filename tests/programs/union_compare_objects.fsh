class C {}

function main() {
  const c = new C()
  const a: C | i64 = c
  const b: C | i64 = c
  print(a === b)
}
// error: comparisons of objects are not supported yet
