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
