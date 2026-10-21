// A nested read-only field can't be lent mutably as writable through a type parameter.
class In { readonly v: i64 = 1 }
class A { inner: In = new In() }
function forge<T extends { inner: { v: i64 } }>(x: Mut<T>) { x.inner.v = 9 }
function main() { let a = new A(); forge(a); print(a.inner.v) }
// error: 'inner.v' is read-only here, but 'forge' takes it mutably
