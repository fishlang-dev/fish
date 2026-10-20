function f(p: { a: i64 } & ({ b: i64 } | { c: i64 })): i64 {
  return p.a
}

function main() {}
// error: intersections with unions are not supported yet
