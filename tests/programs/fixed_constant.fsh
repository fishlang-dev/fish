// error: cannot assign to 'a[...]' because 'a' is a constant
function main() { const a: FixedArray<i64, 2> = [1, 2]; a[0] = 3; }
