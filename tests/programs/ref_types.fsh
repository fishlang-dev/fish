// `Ref<T>` and `Mut<T>` annotate parameters and locals.
type P = { x: i64 }

function look(r: Ref<P>, m: Mut<P>, n: Ref<i64>): i64 {
  return 1
}

function main() {
  print(2)
}
// expect: 2
