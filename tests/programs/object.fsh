// case: object_compare
function main() {
  const a = { x: 1 }
  print(a === a)
}
// error: comparisons of objects are not supported yet
// case: object_const_field
function main() {
  const p = { inner: { n: 1 } }
  p.inner.n = 2
}
// error: cannot assign to 'p.inner.n' because 'p' is a constant
// case: object_duplicate_property
function main() {
  const p = { x: 1, x: 2 }
}
// error: duplicate property 'x'
// error:   const p = { x: 1, x: 2 }
// error:                     ^^^^
// case: object_excess
type Point = { x: i64; y: i64 }

function main() {
  const p: Point = { x: 1, y: 2, z: 3 }
}
// error: object literal may only specify known properties, and 'z' does not exist in type '{ x: i64; y: i64 }'
// error:   const p: Point = { x: 1, y: 2, z: 3 }
// error:                                  ^^^^
// case: object_excess_nested
function f(p: { inner: { n: i64 } }) {}

function main() {
  f({ inner: { n: 1, m: 2 } })
}
// error: object literal may only specify known properties, and 'm' does not exist in type '{ n: i64 }'
// case: object_field_type
function main() {
  let p = { n: 1 }
  p.n = true
}
// error: type 'boolean' is not assignable to type 'i64'
// case: object_missing_property
function main() {
  const p: { x: i64 } = { y: 1 }
}
// error: type '{ y: i64 }' is not assignable to type '{ x: i64 }'
// case: object_narrow_argument
function f(p: { x: i64; y: i64 }) {}

function main() {
  const p = { x: 1 }
  f(p)
}
// error: argument of type '{ x: i64 }' is not assignable to parameter of type '{ x: i64; y: i64 }'
// case: object_nested_shapes
function deep(p: { a: { x: i64; y: i64 } }): i64 {
  return p.a.y
}

function main() {
  const p = { a: { x: 1, y: 2 } }
  const q = { a: { x: 10 }, y: 20 }
  print(deep(p), q.y, q.a.x)
}
// expect: 2 20 10
// case: object_nested_shapes_mismatch
function deep(p: { a: { x: i64; y: i64 } }): i64 {
  return p.a.y
}

function main() {
  deep({ a: { x: 10 }, y: 20 })
}
// error: argument of type '{ a: { x: i64 }; y: i64 }' is not assignable to parameter of type '{ a: { x: i64; y: i64 } }'
// case: object_parameter_field
function reset(p: { n: i64 }) {
  p.n = 0
}

function main() {}
// error: assigning to a parameter is not supported yet; copy it into a 'let'
// case: object_primitive_property
function main() {
  const n = 1
  print(n.x)
}
// error: property 'x' does not exist on type 'i64'
// case: object_print
function main() {
  print({ x: 1 })
}
// error: printing an object is not supported yet; print its fields
// case: object_string_widens
type K = "a" | "b";
type O = { k: K; n: i64 };
type T = { tag: "t"; name: string };
type U = { tag: "t" | "u"; name: string };

function main() {
  let o = { name: "x", n: 1 };
  o.name = "y" + 1;
  const typed: O = { k: "b", n: 2 };
  const t: T = { tag: "t", name: "x" };
  const u: U = { tag: "u", name: "z" + 1 };
  console.log(o.name, typed.k, t.tag, t.name, u.tag, u.name);
}
// expect: y1 b t x u z1
// case: object_switch
function main() {
  switch ({ x: 1 }) {}
}
// error: comparisons of objects are not supported yet
// case: object_type
function main() {
  let p: { x: i64 } = 1
}
// error: type 'i64' is not assignable to type '{ x: i64 }'
// error:   let p: { x: i64 } = 1
// error:                       ^
// case: object_type_duplicate
function f(p: { x: i64; x: boolean }) {}

function main() {}
// error: duplicate property 'x'
// error: function f(p: { x: i64; x: boolean }) {}
// error:                         ^^^^^^^^^^
// case: object_unknown_property
function main() {
  const p = { x: 1 }
  print(p.z)
}
// error: property 'z' does not exist on type '{ x: i64 }'
// error:   print(p.z)
// error:         ^^^
// case: object_width
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
// case: object_writes
type Point = { x: i64; y: i64 }

function main() {
  let p: Point = { x: 1, y: 2 }
  p.x = 10
  p.y += 5
  p.x++
  print(p.x, p.y)
  let line = { from: p.clone(), to: { x: 0, y: 0 }, label: { visible: false } }
  line.to.x = 3
  line.from.y *= 2
  line.label.visible = true
  ++line.to.y
  print(line.from.x, line.from.y, line.to.x, line.to.y, line.label.visible)
  // The line holds a copy: changing it leaves p alone.
  print(p.y)
  line.to = { x: 8, y: 9 }
  print(line.to.x, line.to.y)
  print(p.x = 4, p.x)
}
// expect: 11 7
// expect: 11 14 3 1 true
// expect: 7
// expect: 8 9
// expect: 4 4
