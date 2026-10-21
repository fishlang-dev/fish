// A reference to a value without an optional field can't fill it in.
type O = { a: i64; b?: i64 }
function f(o: Mut<O>) { o.b = 5; o.a = 2 }
function main() { let p = { a: 1 }; f(p); print(p.a) }
// error: it has no 'b', which a reference can't fill in
