// error: an accessor can't take a comptime parameter
// An accessor is given its value at run time.
class C { v: i64 = 0; set x(comptime n: i64) { this.v = n; } }
function main() { let c = new C(); c.x = 5; console.log(c.v); }
