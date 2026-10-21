// Optional parameters come last.
function f(a?: i64, b: i64): i64 { return b + 1 }
function main() { print(f(5)) }
// error: a required parameter can't follow an optional one
