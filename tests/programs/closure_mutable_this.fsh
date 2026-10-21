// A closure changes `this` only where `this` may change.
class C {
  n = 0
  get(): i64 {
    const f = () => { this.n = 1 }
    return 0
  }
}
function main() {}
// error: cannot assign to 'this.n' because 'this' is read-only here; declare 'this: Mut<this>'
