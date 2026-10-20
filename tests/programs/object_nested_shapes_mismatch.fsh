function deep(p: { a: { x: i64; y: i64 } }): i64 {
  return p.a.y
}

function main() {
  deep({ a: { x: 10 }, y: 20 })
}
// error: argument of type '{ a: { x: i64 }; y: i64 }' is not assignable to parameter of type '{ a: { x: i64; y: i64 } }'
