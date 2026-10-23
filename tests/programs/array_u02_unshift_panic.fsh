// panic: attempt to divide by zero
// A panicking argument drops what the call was already handed.
function boom(): string[] { const z = 1 / (0 * 1); return ["never" + z]; }
function boomS(): string { const z = 1 / (0 * 1); return "never" + z; }
function boomI(): i64 { return 1 / (0 * 1); }
function main() { let a = ["a" + 1]; a.unshift("u" + 1, boomS()); console.log(a.length); }
