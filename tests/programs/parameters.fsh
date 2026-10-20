function add(a: i64, b: i64): i64 {
  return a + b
}

function scale(n: i64, by: i64) {
  const result = n * by
  return result
}

function show(label: i64) {
  print("label", label)
}

function main() {
  print(add(2, 3), add(add(1, 2), scale(4, 5)))  // expect: 5 23
  show(7)                                        // expect: label 7
}
