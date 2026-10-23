// error: this comptime code calls 'h', which is still being checked, so it can't run yet
// A comptime argument can't run a function the checker is still in the middle of.
function rep(comptime n: i64): i64 { return n; }
function h(n: i64): i64 { if (n === 0) return rep(comptime h(1)); const y = n * 10; return y; }
function main() { console.log(h(0)); }
