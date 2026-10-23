// error: nested destructuring patterns are not supported yet
function main() { const ps: [[i64, i64], i64][] = [[[1, 2], 3]]; for (const [[a, b], c] of ps) console.log(a); }
