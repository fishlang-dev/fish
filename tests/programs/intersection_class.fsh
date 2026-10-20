class A {
  a = 1
}

function f(p: { b: i64 } & A): i64 {
  return p.b
}

function main() {}
// error: intersections with classes are not supported yet
