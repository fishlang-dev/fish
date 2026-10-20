function sum(n: i64): i64 {
  let total = 0
  for (let i = 1; i <= n; i++) total += i
  return total
}

function forever(): i64 {
  for (;;) {}
}

function main() {
  print(sum(10))
  let j = 3
  for (j = 0; j < 2; j += 1) {
    print("j", j)
  }
  print(j)
  for (let i = 0; i < 3; print("update", i++)) {}
  let runs = 0
  do {
    runs++
  } while (false)
  print(runs)
  do runs *= 2; while (runs < 50)
  print(runs)
  const x = 1
  {
    const x = 2
    print(x)
  }
  print(x)
}
// expect: 55
// expect: j 0
// expect: j 1
// expect: 2
// expect: update 0
// expect: update 1
// expect: update 2
// expect: 1
// expect: 64
// expect: 2
// expect: 1
