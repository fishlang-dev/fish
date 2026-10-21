// '??' gives a default only when an Option is empty, and runs it only then; '!' takes the
// value out, and panics when there is none.
function find(n: i64): i64 | null {
  if (n < 0) return null
  return n
}
function loud(n: i64): i64 {
  print("default ran")
  return n
}
function main() {
  print(find(3) ?? 0, find(-1) ?? 0)
  print(find(5) ?? loud(9))
  print(find(-5) ?? loud(9))
  const both = find(-1) ?? find(2)
  print(both, find(-1) ?? find(-2))
  const w: u8 | null = null
  print(w ?? 255)
  print(find(4)!)
  print(find(-4)!)
}
// expect: 3 0
// expect: 5
// expect: default ran
// expect: 9
// expect: 2 null
// expect: 255
// expect: 4
// panic: called `Option::unwrap()` on a `None` value
