// panic: index out of bounds: the len is 2 but the index is 2
function main() { const a: FixedArray<i64, 2> = [1, 2]; let i: usize = 2; console.log(a[i]); }
