// A reference to a union narrows like the union, and reads the member it points to.
type Circle = { kind: "c"; r: i64 }
type Square = { kind: "s"; side: i64 }
type Shape = Circle | Square

function area(s: Ref<Shape>): i64 {
  if (s.kind === "c") return s.r * s.r * 3
  return s.side * s.side
}

function ru(u: Ref<i64 | boolean>): i64 {
  if (typeof u === "number") return u + 1
  return u ? 100 : 200
}

function main() {
  const c: Shape = { kind: "c", r: 2 }
  const q: Shape = { kind: "s", side: 3 }
  const n: i64 | boolean = 4
  const t: i64 | boolean = true
  print(area(c), area(q), ru(n), ru(t))
}
// expect: 12 9 5 100
