// error: this comptime code panicked: attempt to divide by zero
// Division by zero while compiling is a compile error.
function div(a: i64, b: i64): i64 { return a / b; }
function main() { console.log(comptime div(1, 0)); }
