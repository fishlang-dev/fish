// Nor call a mutating method on a read-only field of one.
class C { n: i64 = 0; inc(this: Mut<this>) { this.n += 1 } }
class A { readonly c: C = new C() }
class Box<T extends { c: C }> {
  constructor(public v: T) {}
  set(this: Mut<this>) { this.v.c.inc() }
}
function main() { let b = new Box(new A()); b.set(); print(b.v.c.n) }
// error: cannot call 'inc' on 'c' because it is a read-only property
