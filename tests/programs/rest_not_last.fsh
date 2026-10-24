// error: a rest parameter has to be the last one, since it takes every argument after those before it
function f(...xs: i64[], y: i64): i64 { return y; } function main() {}
