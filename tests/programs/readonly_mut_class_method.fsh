// A class's type parameter in a method keeps what it stands for read-only.
class A { readonly id: i64 = 1 }
class K<T extends { id: i64 }> { put(x: Mut<T>) { x.id = 2 } }
function main() { let a = new A(); const k = new K<A>(); k.put(a); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
