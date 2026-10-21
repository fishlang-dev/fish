// A closure reads what it captures where it lives: variables, parameters, a narrowed
// variable, `this`, and through nested closures.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
class Box {
  n = 7
  scaled(k: i64): i64 {
    const by = (m: i64) => m * this.n + k
    return by(2)
  }
}
function f(base: i64, u: P | Q): i64 {
  let extra = 100
  const add = (a: i64) => a + base + extra
  const nested = () => {
    const deeper = (b: i64) => add(b) * 2
    return deeper(1)
  }
  if (u.kind === "p") {
    const read = () => u.x
    return add(read()) + nested()
  }
  return 0
}
function main() {
  print(f(10, { kind: "p", x: 5 }), new Box().scaled(3))
}
// expect: 337 17
