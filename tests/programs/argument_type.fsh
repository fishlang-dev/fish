function twice(n: i64): i64 {
  return n * 2
}

function main() {
  print(twice(true))  // error: argument of type 'boolean' is not assignable to parameter of type 'i64'
}
