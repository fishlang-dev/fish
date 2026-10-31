// case: optional_callback
// error: 'map' always passes its callback this argument, so the parameter can't be optional or have a default
function main() { const ys = [1, 2, 3].map((x, i?: i64) => x + (i ?? 0)); }
// case: optional_field
// A class's optional field is empty until assigned.
class C {
  n = 1
  tag?: boolean
}
function main() {
  const c = new C()
  print(c.n, c.tag)
}
// expect: 1 null
// case: optional_field_implicit
// A value without an object type's optional field is copied into it, with the field empty.
class C { a: i64 = 1; constructor() {} }
type O = { a: i64; b?: i64 }
function f(o: O): i64 { return o.a + (o.b ?? 10) }
function main() { print(f(new C())) }
// expect: 11
// case: optional_field_implicit_reference
// A reference to a value without an optional field can't fill it in.
type O = { a: i64; b?: i64 }
function f(o: Mut<O>) { o.b = 5; o.a = 2 }
function main() { let p = { a: 1 }; f(p); print(p.a) }
// error: it has no 'b', which a reference can't fill in
// case: optional_field_implicit_variable
// So is a variable holding one.
type O = { a: i64; b?: i64 }
function f(o: O): i64 { return o.b ?? 7 }
function main() { let p = { a: 1 }; print(f(p)) }
// expect: 7
// case: optional_field_nested
// A value lacking a nested optional field is copied in with it empty.
type In = { v: i64; w?: i64 }
type P = { a: i64; i: In }
function g(p: P): i64 { let x = p; x.i.w = 5; return x.i.w ?? 0 }
function main() {
  const q = { a: 1, i: { v: 2 } }
  print(g(q))
}
// expect: 5
// case: optional_field_nested_reference
// A reference can't fill in a nested optional field either.
type In = { v: i64; w?: i64 }
type P = { a: i64; i: In }
function g(p: Mut<P>) { p.i.w = 5 }
function main() {
  let q = { a: 1, i: { v: 2 } }
  g(q)
  print(q.a)
}
// error: it has no 'i.w', which a reference can't fill in
// case: optional_parameter
// A call may leave out an optional parameter, and an object or class an optional field;
// each is then an empty Option.
type Opts = { size: i64; label?: i64 }
function greet(n: i64, times?: i64) {
  if (times === undefined) print(n)
  else print(n * times)
}
function size(o: Opts): i64 {
  const l = o.label
  if (l === null) return o.size
  return o.size + l
}
class Node {
  value: i64
  next?: i64
  constructor(v: i64, next?: i64) {
    this.value = v
    this.next = next
  }
}
function main() {
  greet(5)
  greet(5, 3)
  print(size({ size: 2 }), size({ size: 2, label: 40 }))
  const o: Opts = { size: 1 }
  print(o.label)
  const a = new Node(1)
  const b = new Node(2, 9)
  print(a.next, b.next)
  const f = (x: i64, y?: i64) => y === undefined ? x : x + y
  print(f(1), f(1, 2))
}
// expect: 5
// expect: 15
// expect: 2 42
// expect: null
// expect: null 9
// expect: 1 3
// case: optional_parameter_missing
// A call gives at least the parameters that aren't optional.
function g(a: i64, b?: i64) {}
function main() {
  g()
}
// error: expected 1-2 arguments, but got 0
// case: optional_parameter_object
// An optional parameter of an object type is an Option too.
type P = { x: i64 }
function g(b?: P): i64 { return 1 }
function main() { print(g({ x: 2 }), g()) }
// expect: 1 1
// case: optional_parameter_order
// Optional parameters come last.
function f(a?: i64, b: i64): i64 { return b + 1 }
function main() { print(f(5)) }
// error: a required parameter can't follow an optional one
// case: optional_parameter_property
// An optional parameter property is an Option.
class C { constructor(public a: i64, public b?: i64) {} }
function main() { const c = new C(1); print(c.a, c.b) }
// expect: 1 null
// case: optional_field_in_class_array
// A class's array of objects with an optional field reads as the type the field declares.
type Token = { start: usize; raw?: string; subs?: usize[] }
class Tokens {
  list: Token[] = [{ start: 1, subs: [7, 8] }, { start: 2 }]
  last(): Token { return { ...this.list[this.list.length - 1]! } }
}
function main() {
  const t = new Tokens()
  print(t.list.length, t.list[0]!.start, t.list[0]!.subs!.length, t.last().start, t.last().raw ?? "none")
}
// expect: 2 1 2 2 none
