// So does a type parameter held mutably in an object parameter.
class A { readonly id: i64 = 1 }
function f<T extends { id: i64 }>(h: { m: Mut<T> }) { h.m.id = 5 }
function main() { let a = new A(); f({ m: a }); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
