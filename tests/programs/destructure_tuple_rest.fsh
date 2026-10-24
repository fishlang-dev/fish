// error: rest elements in tuple patterns are not supported yet
function main() { const t: [i64, i64, i64] = [1, 2, 3]; const [a, ...r] = t; }
