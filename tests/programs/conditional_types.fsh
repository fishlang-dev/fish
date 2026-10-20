function pick(flag: boolean): i64 | boolean {
  return flag ? 1 : false
}

function main() {
  // Sides of different types make a union, as in TypeScript.
  print(true ? 1 : false, pick(false))
  const d = pick(true) === 1 ? "one" : "other"
  print(d)
}
// expect: 1 false
// expect: one
