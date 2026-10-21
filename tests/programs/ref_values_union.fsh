function f(u: Ref<i64> | boolean): i64 {
  return 1
}

function main() {}
// error: unions holding references are not supported yet
