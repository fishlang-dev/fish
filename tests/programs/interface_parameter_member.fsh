interface Animal {
  speak(): i64
}

function describe(a: Animal): i64 {
  return a.legs
}

function main() {}
// error: property 'legs' does not exist on type 'Animal'
