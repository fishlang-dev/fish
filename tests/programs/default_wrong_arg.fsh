// error: argument of type '"x"' is not assignable to parameter of type 'i64'
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, "x")); }
