// expect: hi a num
// A union held by a top-level const is a comptime argument.
const U: i64 | string = "hi";
function f(comptime x: i64 | string): string { return typeof x === "string" ? x : "num"; }
function main() { console.log(f(U), f("a"), f(3)); }
