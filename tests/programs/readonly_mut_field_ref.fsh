// And one a generic class holds mutably.
class A { readonly id: i64 = 1 }
class Box<T> { constructor(public m: Mut<T>) {} }
function f<T extends { id: i64 }>(b: Box<T>) { b.m.id = 5 }
function main() { let a = new A(); f(new Box(a)); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
