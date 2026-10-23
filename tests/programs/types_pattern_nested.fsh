// error: is not assignable to type '{ a: `${number}px` }'
// A pattern inside an object still asks its fields to match.
type Px = `${number}px`;
function f(o: { a: string }): i64 { const p: { a: Px } = o; return 1; }
function main() {}
