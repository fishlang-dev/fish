function bad(r: Ref<i64>): Ref<i64> {
  return 3
}

function main() {}
// error: can't return a reference to a temporary
