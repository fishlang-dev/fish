// expect: 2 2
// A function with a comptime parameter may leave out a trailing optional parameter.
function app(comptime n: i64, s?: string): i64 { return n; }
function main() { console.log(app(2), app(2, "x")); }
