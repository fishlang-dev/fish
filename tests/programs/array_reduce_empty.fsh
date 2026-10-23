// panic: reduce of empty array with no initial value
function main() { const xs: i64[] = []; console.log(xs.reduce((a, x) => a + x)); }
