// expect: 10 15
// A generic class's comptime method called through 'this' gets its value.
class G<T> { x: T; constructor(x: T) { this.x = x; } rep(comptime n: i64, y: i64): i64 { return n * y; } twice(): i64 { return this.rep(2, 5); } }
function main() { const g = new G<string>("a"); console.log(g.twice(), g.rep(3, 5)); }
