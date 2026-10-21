// An optional parameter of an object type is an Option too.
type P = { x: i64 }
function g(b?: P): i64 { return 1 }
function main() { print(g({ x: 2 }), g()) }
// expect: 1 1
