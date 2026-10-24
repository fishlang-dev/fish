// error: a parameter that may be null can have only 'null' as its default so far
function f(a: Option<i64> = 3): i64 { return a ?? 0; } function main() {}
