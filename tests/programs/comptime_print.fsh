// error: printing can't run while compiling: comptime code only computes values
// Comptime code computes values: printing is refused.
function say(): i64 { console.log("hi"); return 1; }
function main() { console.log(comptime say()); }
