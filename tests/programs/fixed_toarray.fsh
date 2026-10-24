// error: argument of type 'FixedArray<i64, 2>' is not assignable to parameter of type 'i64[]'
function f(xs: i64[]) {} function main() { const a: FixedArray<i64, 2> = [1, 2]; f(a); }
