// error: this comptime code nests calls more than 1000 deep
// Comptime recursion that never ends stops at the depth limit.
function deep(n: i64): i64 { return deep(n + 1); }
function main() { console.log(comptime deep(0)); }
