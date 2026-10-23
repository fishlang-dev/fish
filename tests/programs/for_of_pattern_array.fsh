// error: only tuples, like '[i64, string]', can be destructured so far, not 'i64[]'
function main() { const grid: i64[][] = [[1, 2]]; for (const [a, b] of grid) console.log(a, b); }
