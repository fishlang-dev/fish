// case: if
function sign(n: i64): i64 {
  if (n < 0) {
    return -1
  } else if (n === 0) {
    return 0
  }
  return 1
}

function abs(n: i64): i64 {
  if (n < 0) return -n
  else return n
}

function main() {
  print(sign(-5), sign(0), sign(9), abs(-4), abs(4))  // expect: -1 0 1 4 4
  const x = 1
  if (x === 1) {
    const x = 2
    print("inner", x)  // expect: inner 2
  }
  print("outer", x)    // expect: outer 1
  if (x > 5) print("unreachable")
}
// case: if_missing_return
function positive(n: i64): i64 {  // error: not all code paths return a value
  if (n > 0) {
    return n
  }
}

function main() {
}
