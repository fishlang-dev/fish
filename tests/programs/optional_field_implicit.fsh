// A value without an object type's optional field is copied into it, with the field empty.
class C { a: i64 = 1; constructor() {} }
type O = { a: i64; b?: i64 }
function f(o: O): i64 { return o.a + (o.b ?? 10) }
function main() { print(f(new C())) }
// expect: 11
