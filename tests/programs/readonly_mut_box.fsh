// And one inside a mutably borrowed generic class.
class A { readonly id: i64 = 1 }
class Box<T> { constructor(public v: T) {} }
function f<T extends { id: i64 }>(b: Mut<Box<T>>) { b.v.id = 5 }
function main() { let b = new Box(new A()); f(b); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
