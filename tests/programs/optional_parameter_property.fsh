// An optional parameter property is an Option.
class C { constructor(public a: i64, public b?: i64) {} }
function main() { const c = new C(1); print(c.a, c.b) }
// expect: 1 null
