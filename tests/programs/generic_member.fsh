interface Named {
  name: i64
}

function size<T extends Named>(x: T): i64 {
  return x.size
}

function main() {}
// error: property 'size' does not exist on type 'T'
