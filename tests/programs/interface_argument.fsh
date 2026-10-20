interface Animal {
  speak(): i64
}

function describe(a: Animal): i64 {
  return a.speak()
}

function main() {
  describe({ legs: 4 })
}
// error: argument of type '{ legs: i64 }' is not assignable to parameter of type 'Animal': method 'speak' is missing in type '{ legs: i64 }' but required in type 'Animal'
