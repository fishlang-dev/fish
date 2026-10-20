function f(p: { x: i64; y: i64 }) {}

function main() {
  const p = { x: 1 }
  f(p)
}
// error: argument of type '{ x: i64 }' is not assignable to parameter of type '{ x: i64; y: i64 }'
