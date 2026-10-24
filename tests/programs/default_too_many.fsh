// error: expected 1-2 arguments, but got 3
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, 2, 3)); }
