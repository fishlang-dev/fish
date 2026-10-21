// A throw expression raises where a value goes, in '??' and '?:', propagating or caught.
function find(n: i64): i64 | null {
  return n > 0 ? n : null
}
function need(n: i64): i64 throws i64 {
  const v = find(n) ?? throw -1
  return v * 10
}
function positive(n: i64): i64 throws boolean {
  return n > 0 ? n : throw false
}
function main() throws i64 | boolean {
  print(need(3))
  try {
    print(need(-2))
  } catch (e) {
    print("caught", e)
  }
  print(positive(4))
  try {
    const w = find(0) ?? throw 9
    print(w)
  } catch (e) {
    print("local", e)
  }
  print(positive(-1))
}
// expect: 30
// expect: caught -1
// expect: 4
// expect: local 9
// fails: Error: false
