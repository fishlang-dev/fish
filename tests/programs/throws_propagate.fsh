// A throwing function's error propagates through a function that declares it, and out of main, which prints it and exits 1.
function parse(n: i64): i64 throws i64 {
  if (n < 0) throw 7
  return n * 2
}
function twice(n: i64): i64 throws i64 {
  const a = parse(n)
  return a + parse(a)
}
class Store {
  limit = 10
  check(n: i64): boolean throws boolean {
    if (n > this.limit) throw false
    return true
  }
}
function main() throws i64 | boolean {
  print(twice(3))
  print(new Store().check(3))
  print(twice(-1))
  print("not reached")
}
// expect: 18
// expect: true
// fails: Error: 7
