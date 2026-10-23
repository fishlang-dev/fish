// error: 'concat' joins arrays of the same element type, 'i64[]', not 'i64'; to add single values, push them
function main() { const xs = [1]; console.log(xs.concat(2).length); }
