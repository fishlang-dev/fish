// A generic class's own value of T keeps what it stands for read-only.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  constructor(public v: T) {}
  set(this: Mut<this>) { this.v.id = 7 }
}
function main() { let b = new Box(new A()); b.set(); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
