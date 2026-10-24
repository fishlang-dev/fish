// error: a spread argument fills only a rest parameter, as in 'function f(...xs: T[])', since an array's length isn't known while compiling
function f(a: i64, b: i64): i64 { return a + b; } function main() { const xs = [1, 2]; console.log(f(...xs)); }
