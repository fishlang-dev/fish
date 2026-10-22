// error: 'A' needs its own value to compute its value
// Consts that need each other's values can't be computed.
const A: i64 = B + 1;
const B: i64 = A + 1;
function main() { console.log(A); }
