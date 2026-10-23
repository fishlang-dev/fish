// error: only tuples, like '[i64, string]', can be destructured so far, not 'i64[]'
function main() { const xs = [1, 2]; const [a, b] = xs; }
