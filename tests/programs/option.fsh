// An Option is checked with === null or === undefined, which narrow it, and an empty one
// prints null and is "undefined" to typeof.
function find(n: i64): i64 | null {
  if (n < 0) return null
  return n * 2
}
function show(x: i64 | undefined) {
  if (x === undefined) {
    print("nothing")
    return
  }
  print(x + 1)
}
function main() {
  const a = find(3)
  const b = find(-1)
  print(a, b, typeof b === "undefined", typeof a === "number", typeof a === "undefined")
  if (a !== null) print(a + 100)
  show(4)
  show(undefined)
  let c: Option<i64 | null> = null
  print(c === null, c)
  c = 7
  const e: i64 | null = c
  print(c === null, e !== null && e > 5)
  const d: boolean | null = b === null ? true : null
  print(d)
  const u: u8 | null = 200
  print(u)
}
// expect: 6 null true true false
// expect: 106
// expect: 5
// expect: nothing
// expect: true null
// expect: false true
// expect: true
// expect: 200
