function f<T>(t: T & { a: i64 }): i64 {
  return t.a
}

function main() {}
// error: intersections with type parameters are not supported yet
