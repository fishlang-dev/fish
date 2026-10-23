// expect: 3 0
// expect: o1
// Tuples inside Options, as parameters and returns.
function f(o: [i64, i64] | null): i64 { if (o === null) return 0; return o[0] + o[1]; }
function main() { console.log(f([1, 2]), f(null)); const x: Option<[i64, string]> = [1, "o" + 1]; if (x !== null) console.log(x[1]); }
