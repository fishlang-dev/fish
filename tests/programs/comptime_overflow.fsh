// error: this comptime code panicked: attempt to add with overflow
// A panic while compiling is a compile error at the comptime site.
function grow(): i64 { let x: i8 = 100; return (x + 100) as i64; }
function main() { console.log(comptime grow()); }
