interface Animal {
  speak(): i64
}

function make(): Animal {
  return { legs: 4 }
}

function main() {}
// error: type '{ legs: i64 }' is not assignable to return type 'Animal': method 'speak' is missing in type '{ legs: i64 }' but required in type 'Animal'
