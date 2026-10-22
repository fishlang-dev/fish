// error: this comptime code took more than 10,000,000 steps
// Comptime code that never ends stops at the step limit.
function spin(): i64 { let n = 0; while (true) { n = n + 1; if (n < 0) return n; } }
function main() { console.log(comptime spin()); }
