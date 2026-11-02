// case: conditional
function classify(n: i64): i64 {
  return n < 0 ? -1 : n === 0 ? 0 : 1
}

function main() {
  const zero = 0
  // Only the chosen side runs, so the division never happens.
  print(zero === 0 ? 0 : 10 / zero)
  print(classify(-5), classify(0), classify(9))
  const big = classify(3) > 0 ? true : false
  print(big)
  let n = 1
  n = n > 0 ? n + 1 : n - 1
  print(n)
}
// expect: 0
// expect: -1 0 1
// expect: true
// expect: 2
// case: conditional_types
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
// case: conditional_literal_union
// Each side of a `?:` meets a union of literals on its own, as a literal alone does.
type Loop = "forIn" | "forOf"
function loop(word: string): Loop {
  return word === "in" ? "forIn" : "forOf"
}
function main() {
  const k: Loop = loop("of") === "forOf" ? "forIn" : "forOf"
  print(loop("in"), k)
}
// expect: forIn forIn
// case: conditional_literal_union_unfit
// error: type 'string' is not assignable to type '"a" | "b"'
function main() {
  const n = 1
  const k: "a" | "b" = n === 1 ? "a" : "c"
  print(k)
}
