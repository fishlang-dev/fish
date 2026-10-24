// error: a default of type '"x"' is not assignable to parameter of type 'i64'
function f(b: i64 = "x"): i64 { return b; } function main() { f(); }
