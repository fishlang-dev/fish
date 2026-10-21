// A type parameter's field is as read-only as the field of what it stands for.
class A { readonly id: i64 = 1 }
function forge<T extends { id: i64 }>(x: Mut<T>) { x.id = 999 }
function main() { let a = new A(); forge(a); print(a.id) }
// error: 'id' is read-only here, but 'forge' takes it mutably as '{ id: i64 }', which could change it
