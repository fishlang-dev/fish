// A copy of a value with read-only fields may be changed through a writable type.
type Locked = { readonly id: i64 }
function bump(x: { id: i64 }): i64 { let c = x; c.id = 5; return c.id }
function main() { const l: Locked = { id: 1 }; print(bump(l)) }
// expect: 5
