// error: 'Pick' of 'A' is needed while the field types of 'A' are being worked out
// Two classes whose fields pick from each other can't be worked out in either order.
class A { y: i64 = 1; b: Pick<B, "x"> | null = null; }
class B { x: i64 = 2; a: Pick<A, "y"> | null = null; }
function main() {}
