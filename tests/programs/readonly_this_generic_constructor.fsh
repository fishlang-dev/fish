// Its constructor can't write a read-only field of a value it was given.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  v: T
  constructor(v: T) { this.v = v; this.v.id = 7 }
}
function main() { let b = new Box(new A()); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
