// expect: ok
// Destructurings with the same pattern, holes alone, may repeat.
function main() { const t: [i64, i64] = [1, 2]; const [, ] = t; const [] = t; const [,] = t; console.log("ok"); }
