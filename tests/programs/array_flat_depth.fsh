// error: 'flat' flattens one level so far, so it takes no depth
function main() { const xs: i64[][] = [[1]]; console.log(xs.flat(2).length); }
