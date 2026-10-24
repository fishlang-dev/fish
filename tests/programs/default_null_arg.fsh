// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, null)); }
