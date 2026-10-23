// error: 'k' is only known when the program runs, so comptime code can't read it
// A comptime parameter's argument must be known while compiling.
function rep(comptime n: i64): i64 { return n; }
function main() { const k = 3; console.log(rep(k)); }
