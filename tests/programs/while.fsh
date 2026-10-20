function factorial(n: i64): i64 {
  let result = 1
  let i = 2
  while (i <= n) {
    result *= i
    i++
  }
  return result
}

function fib(n: i64): i64 {
  if (n < 2) return n
  return fib(n - 1) + fib(n - 2)
}

// The loop never finishes, so the function needs no return after it.
function forever(): i64 {
  while (true) {
    return 7
  }
}

function main() {
  print(factorial(20), fib(20), forever())  // expect: 2432902008176640000 6765 7
  let i = 0
  while (i < 3) {
    print("tick", i)
    i++
  }
  // expect: tick 0
  // expect: tick 1
  // expect: tick 2
}
