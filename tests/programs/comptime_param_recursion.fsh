// error: instantiating 'down' never ends: each instance needs another with a different comptime value
// Recursing with a new comptime value each time stops at the instantiation limit.
function down(comptime n: i64): i64 { return n === 0 ? 0 : down(n - 1); }
function main() { console.log(down(3)); }
