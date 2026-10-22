// A function returning a function type gives a boxed closure.
function make(): (x: i64) => i64 {
  return (x) => x
}
function main() {
  print(make()(4))
}
// expect: 4
