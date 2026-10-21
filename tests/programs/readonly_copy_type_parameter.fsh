// So may a copy given to a type parameter.
class A { readonly id: i64 = 1 }
function bump<T extends { id: i64 }>(x: T): i64 { let c = x; c.id = 5; return c.id }
function main() { const a = new A(); print(bump(a)) }
// expect: 5
