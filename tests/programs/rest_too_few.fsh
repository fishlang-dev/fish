// error: expected at least 1 argument, but got 0
function f(a: i64, ...xs: i64[]): usize { return xs.length; } function main() { console.log(f()); }
