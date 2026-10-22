// error: 'k' is only known when the program runs, so comptime code can't read it
// Comptime code can't read a run-time variable.
function main() { const k = 3; console.log(comptime k + 1); }
