// So is a generic class's.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  constructor(public m: Mut<T>) {}
  set(this: Mut<this>) { this.m.id = 7 }
}
function main() { let a = new A(); let b = new Box(a); b.set(); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
