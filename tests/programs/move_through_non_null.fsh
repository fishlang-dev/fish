class P { x: i64; constructor(x: i64) { this.x = x } }
type B = { p: P };
function take(p: P) { console.log(p.x) }
function main() { let o: B | null = { p: new P(3) }; take(o!.p); console.log(o!.p.x); }
// error: 'o!.p.x' can't be used here because 'o.p' was moved
