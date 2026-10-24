// error: defaults on parameters of type '(n: i64) => i64' are not supported yet
function f(cb: (n: i64) => i64 = (n) => n): i64 { return cb(1); } function main() {}
