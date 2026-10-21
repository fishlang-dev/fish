// A closure nested in a closure in a constructor can't use `this` before every field is set.
class C {
  n: i64
  m: i64
  constructor() {
    this.n = 1
    const a = () => { const b = () => this.m; return b() }
    print(a())
    this.m = 2
  }
}
function main() { new C() }
// error: 'this' can't be used until every field is assigned
