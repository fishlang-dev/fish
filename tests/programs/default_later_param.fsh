// error: cannot find name 'b'
function f(a: i64 = b, b: i64 = 1): i64 { return a; } function main() { f(); }
