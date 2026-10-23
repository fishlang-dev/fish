// error: tuple type '[i64, i64]' of length 2 has no element at index 2
function main() { const t: [i64, i64] = [1, 2]; const [a, b, c] = t; }
