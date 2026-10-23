// error: type 'string' is not assignable to type '`${number}px`'
// Writing a field declared with a pattern asks the value to match it.
type Px = `${number}px`;
function f(s: string): i64 { let o: { w: Px } = { w: "1px" }; o.w = s; return 1; }
function main() {}
