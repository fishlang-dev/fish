// error: a field can't have the interface type 'Shape'
interface Shape { area(): i64 }
function f(t: [Shape, i64]): i64 { return t[0].area() + t[1]; }
function main() { console.log(1); }
