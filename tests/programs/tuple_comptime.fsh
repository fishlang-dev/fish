// expect: 3 ct 9
// Top-level consts computed from functions giving tuples.
function mk(): [i64, string] { return [3, "ct"]; }
const T = mk();
const U: [i64, i64] = [4, 5];
function main() { console.log(T[0], T[1], U[0] + U[1]); }
