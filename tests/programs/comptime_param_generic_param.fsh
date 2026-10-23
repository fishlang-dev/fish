// expect: 13 13
// A generic class's comptime method called through a type-parameter value gets its value.
class G<T> { x: T; constructor(x: T) { this.x = x; } rep(comptime n: i64, y: i64): i64 { return n * y; } }
function use<T>(g: G<T>): i64 { return g.rep(2, 5) + g.rep(3, 1); }
function main() { const g = new G<string>("a"); const h = new G<i64>(1); console.log(use(g), use(h)); }
