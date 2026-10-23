// error: type '{ "0": i64; "1": i64 }' is not assignable to type '[i64, i64]'
function main() { const t: [i64, i64] = { 0: 3, 1: 4 }; console.log(t[0]); }
