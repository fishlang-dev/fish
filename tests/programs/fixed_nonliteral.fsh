// error: a FixedArray's length is a number written in place, like 'FixedArray<i64, 4>'
function main() { const n = 2; const a: FixedArray<i64, n> = [1, 2]; }
