// error: 'g' was moved
function* gen(): Generator<i64> { yield 1; } function main() { let g = gen(); const xs = [...g]; g.next(); }
