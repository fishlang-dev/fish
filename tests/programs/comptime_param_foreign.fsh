// error: a C function can't take a comptime parameter
// C takes every argument at run time.
declare function abs(comptime n: i32): i32;
function main() { console.log(unsafe { abs(-5) }); }
