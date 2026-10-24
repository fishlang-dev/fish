// case: argument_count
function add(a: i64, b: i64): i64 {
  return a + b
}

function main() {
  print(add(1))  // error: expected 2 arguments, but got 1
}
// case: argument_type
function twice(n: i64): i64 {
  return n * 2
}

function main() {
  print(twice(true))  // error: argument of type 'boolean' is not assignable to parameter of type 'i64'
}
