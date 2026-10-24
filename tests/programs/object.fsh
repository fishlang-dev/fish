// case: object_compare
function main() {
  const a = { x: 1 }
  print(a === a)
}
// expect: true
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
// case: object_spread
// expect: d1 8080 99 1 8000 true
// expect: over 1 7
// expect: h1 9
// expect: x2 2 1
// Spreads of named objects (cloned), temporaries (taken over), instances (their public fields)
// and nested literals, mixed with properties in any order, a later one winning.
class P { n: i64; constructor(n: i64) { this.n = n; } }
class C { host: string = "h" + 1; port: i64 = 80; #secret: i64 = 1; }
type Opts = { host: string; port: i64; p: P };
function make(): Opts { return { host: "m" + 1, port: 1, p: new P(7) }; }
function main() {
  const d: Opts = { host: "d" + 1, port: 8000, p: new P(1) };
  let o = { ...d, port: 8080 };
  const q = { port: 1, ...d, extra: true };
  o.p.n = 99;
  console.log(o.host, o.port, o.p.n, d.p.n, q.port, q.extra);
  const t = { ...make(), host: "over" };
  console.log(t.host, t.port, t.p.n);
  const c = { ...new C(), port: 9 };
  console.log(c.host, c.port);
  const two = { ...d, ...{ port: 2, host: "x" + 2 } };
  console.log(two.host, two.port, two.p.n);
}
// case: object_spread_borrowed
// expect: x12 x1
// expect: w2
// A spread of a borrowed object reads its fields through the borrow, in each instance its own way.
type T = { a: string; b: i64 };
function f(t: Ref<T>): string { const o = { ...t, b: 2 }; return `${o.a}${o.b}`; }
function main() {
  const t: T = { a: "x" + 1, b: 1 };
  console.log(f(t), t.a);
  const w = { a: "w", b: 5, c: true };
  console.log(f(w));
}
// case: object_spread_class
// expect: 2
// A literal with a spread can still make a class instance where one is expected.
class K { a: i64 = 1; }
function main() { const k: K = { ...{ a: 2 } }; console.log(k.a); }
// case: object_spread_array
// error: '...' in an object literal spreads an object or an instance, not 'i64[]'
function main() { const xs = [1]; const o = { ...xs }; }
// case: object_spread_option
// error: '...' in an object literal spreads an object or an instance, not 'null | { a: i64 }'
function main() { const o: { a: i64 } | null = null; const p = { ...o }; }
// case: object_spread_duplicate
// error: duplicate property 'a'
function main() { const d = { a: 1 }; const o = { a: 2, a: 3, ...d }; }
// case: object_spread_snapshot
// expect: x1 5 y2
// A named spread is cloned when the literal reaches it, before a later part changes it.
type O = { s: string; n: i64 };
function set(o: Mut<O>): i64 { o.s = "y" + 2; return 5; }
function main() {
  let d: O = { s: "x" + 1, n: 1 };
  const r = { ...d, k: set(d) };
  console.log(r.s, r.k, d.s);
}
// case: object_spread_private
// expect: 1 2
// A spread takes an instance's public fields only, so an earlier property keeps its name.
class C { private x: i64 = 42; y: i64 = 2; }
function main() {
  const r = { x: 1, ...new C() };
  console.log(r.x, r.y);
}
// case: object_spread_overridden
// expect: x1 1
// A property a later spread replaces is dropped.
type O = { s: string; n: i64 };
function main() {
  const d: O = { s: "x" + 1, n: 1 };
  const r = { s: "p" + 2, ...d };
  console.log(r.s, r.n);
}
// case: object_spread_borrow_live
// error: cannot change 'list' while 'r' borrows 'list[...]' and is used later
type O = { s: string; n: i64 };
function main() {
  let list: O[] = [{ s: "x" + 1, n: 1 }];
  const r: Ref<O> = list[0];
  for (let i = 0; i < 50; i++) list.push({ s: "p" + i, n: i });
  list.shift();
  const o = { ...r };
  console.log(o.s);
}
// case: object_spread_no_adapt
// error: type '{ n: i64 }' is not assignable to type '{ n: u8 }'
function main() {
  const d = { n: 300 };
  const o: { n: u8 } = { n: 1, ...d };
  console.log(o.n);
  const p: { n: u8 } = { n: 1, ...{ n: 70000 } };
  console.log(p.n);
}
// case: object_spread_adapts_last
// expect: 7 4 2 0
// expect: a1 0
function main() {
  const o: { n: u8; m: i64 } = { ...{ m: 4 }, n: 7 };
  const q: { n: u8; xs: string[] } = { n: 300 - 299, ...{ n: 2 as u8 }, xs: [] };
  console.log(o.n, o.m, q.n, q.xs.length);
  const d = { s: "a" + 1 };
  const r: { s: string; xs: string[] } = { ...d, xs: [] };
  console.log(r.s, r.xs.length);
}
// case: object_spread_lends_shorthand
// expect: a1 1
type O = { s: string };
function main() {
  const a: O = { s: "a" + 1 };
  const o: { a: Ref<O>; k: i64 } = { a, ...{ k: 1 } };
  console.log(o.a.s, o.k);
}
// case: object_spread_lend_overridden
// error: type '{ a: { s: string }; k: i64 }' is not assignable to type '{ a: Ref<{ s: string }>; k: i64 }'
type O = { s: string };
function main() {
  const a: O = { s: "a" + 1 };
  const b: O = { s: "b" + 1 };
  const o: { a: Ref<O>; k: i64 } = { a, ...{ a: b, k: 1 } };
  console.log(o.a.s);
}
// case: object_spread_generic_adapts
// expect: 1
type HasM = { m: i64 };
function g<T extends HasM>(t: T): u8 {
  const o: { n: u8; m: i64 } = { n: 1, ...t };
  return o.n;
}
function main() {
  console.log(g({ m: 1 }));
}
// case: object_spread_generic_supplies
// error: type '{ m: i64; n: i64 }' is not assignable to type '{ m: i64; n: u8 }'
type HasM = { m: i64 };
function g<T extends HasM>(t: T): u8 {
  const o: { n: u8; m: i64 } = { n: 1, ...t };
  return o.n;
}
function main() {
  console.log(g({ m: 1, n: 300 }));
}
