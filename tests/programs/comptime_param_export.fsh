// error: an exported function can't take a comptime parameter, since C calls it with run-time values
// An exported function is called from C, with run-time values.
export function lib(comptime n: i64): i64 { return n; }
function main() { console.log(lib(1)); }
