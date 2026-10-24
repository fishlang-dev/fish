// error: a FixedArray has no method 'map' yet; loop over it with 'for...of', or read 'length'
function main() { const a: FixedArray<i64, 2> = [1, 2]; a.map((x) => x); }
