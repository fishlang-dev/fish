// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function f(a: i64 = 1): i64 { return a; } function main() { const o: i64 | null = null; console.log(f(o)); }
