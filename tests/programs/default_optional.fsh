// error: a parameter can't be both optional and have a default; the default already lets callers leave it out
function f(x?: i64 = 1): i64 { return 1; } function main() {}
