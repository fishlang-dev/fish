function show(n: i64): i64 {
  print(n)
  return n
}

function main() {
  let a = 0
  let b = 0
  a = b = 3
  print(a, b)
  let x = 1
  show(x += 2)
  print(x)
  let i = 5
  print(i++, i)
  print(++i, i)
  print(i--, --i)
  let flag = false
  print(flag = true)
  // The target is read before the right side runs.
  let y = 10
  y -= y = 4
  print(y)
  x * 2
}
// expect: 3 3
// expect: 3
// expect: 3
// expect: 5 6
// expect: 7 7
// expect: 7 5
// expect: true
// expect: 6
