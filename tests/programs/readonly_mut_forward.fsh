// A type parameter passed on to a writable view keeps its read-only fields.
class A { readonly id: i64 = 1 }
function inner(x: Mut<{ id: i64 }>) { x.id = 9 }
function outer<T extends { id: i64 }>(x: Mut<T>) { inner(x) }
function main() { let a = new A(); outer(a); print(a.id) }
// error: 'id' is read-only here, but 'inner' takes it mutably
