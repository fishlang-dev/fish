// error: callbacks passed to 'map' by name
function double(x: i64): i64 { return x * 2; }
function main() { const xs = [1]; console.log(xs.map(double).length); }
