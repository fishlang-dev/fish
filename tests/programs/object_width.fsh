type Point = { x: i64; y: i64 }
type Named = { name: { id: i64 } }

function sum(p: Point): i64 {
  return p.x + p.y
}

function flatten(p: { x: i64; y: i64; z: i64 }): Point {
  return p
}

function id(n: Named): i64 {
  return n.name.id
}

function main() {
  const wide = { x: 1, y: 2, z: 3 }
  print(sum(wide.clone()))
  const narrow: Point = wide.clone()
  print(narrow.x, narrow.y)
  let stored: Point = { x: 0, y: 0 }
  stored = wide.clone()
  print(stored.y)
  print(flatten(wide.clone()).y)
  // Nested fields are copied down too.
  const deep = { name: { id: 7, extra: true }, more: 1 }
  print(id(deep))
  let holder = { at: narrow }
  holder.at = wide
  print(holder.at.x)
}
// expect: 3
// expect: 1 2
// expect: 2
// expect: 2
// expect: 7
// expect: 1
