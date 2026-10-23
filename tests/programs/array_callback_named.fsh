// error: 'map' takes an arrow function written in place; passing a function by name isn't supported yet
function double(x: i64): i64 { return x * 2; }
function main() { const xs = [1]; console.log(xs.map(double).length); }
