type Dir = "up" | "down" | i64

function describe(x: i64 | boolean): i64 {
  if (typeof x === "number") {
    return x * 10
  }
  return x ? 1 : 0
}

function step(d: Dir): i64 {
  if (d === "up") return 1
  if (d === "down") return -1
  // Only the i64 is left.
  return d
}

function both(a: i64 | boolean, b: i64 | boolean): i64 {
  if (typeof a === "number" && typeof b === "number") return a + b
  if (typeof a === "boolean" || typeof b === "boolean") return -1
  return 0
}

function main() {
  print(describe(4), describe(true), describe(false))
  print(step("up"), step("down"), step(7))
  print(both(1, 2), both(true, 2))
  const x: i64 | boolean = 5
  const doubled = typeof x === "number" ? x * 2 : 0
  print(doubled, typeof x !== "boolean" && x > 3)
  let y: i64 | boolean = false
  if (!(typeof y === "number")) {
    print(y)
  }
  const d: Dir = 3
  while (typeof d === "number" && d < 0) {
    print(d)
  }
  print(d === 3, d === "up", d !== 4)
}
// expect: 40 1 0
// expect: 1 -1 7
// expect: 3 -1
// expect: 10 true
// expect: false
// expect: true false true
