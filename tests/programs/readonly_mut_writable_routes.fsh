// With a writable field, each of these writes through.
class A { id: i64 = 1 }
class K<T extends { id: i64 }> { put(x: Mut<T>) { x.id = 2 } }
function main() { let a = new A(); const k = new K<A>(); k.put(a); print(a.id) }
// expect: 2
