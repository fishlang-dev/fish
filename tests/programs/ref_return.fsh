// A function can return the reference it was given, elided to its only reference parameter.
function same(r: Ref<i64>): Ref<i64> {
  return r
}

function main() {
  const n = 4
  print(same(n) + 1)
}
// expect: 5
