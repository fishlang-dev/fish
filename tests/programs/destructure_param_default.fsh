// error: a destructured parameter can't have a default yet; give the default to the parts
type Point = { x: i64 }; function f({ x }: Point = { x: 1 }): i64 { return x; } function main() {}
