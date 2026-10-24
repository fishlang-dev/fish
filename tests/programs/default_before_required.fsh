// error: a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments
function f(a = 1, b: i64): i64 { return a + b; } function main() {}
