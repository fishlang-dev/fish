// So is a variable holding one.
type O = { a: i64; b?: i64 }
function f(o: O): i64 { return o.b ?? 7 }
function main() { let p = { a: 1 }; print(f(p)) }
// expect: 7
