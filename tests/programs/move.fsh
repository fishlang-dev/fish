// case: move_after_call
type Point = { x: i64; y: i64 }

function sum(p: Point): i64 {
  return p.x + p.y
}

function main() {
  const p: Point = { x: 1, y: 2 }
  print(sum(p))
  print(p.x)
}
// error: 10:9: error: 'p.x' can't be used here because 'p' was moved
// error: 9:13: note: 'p' moved here: passing it to 'sum' hands it over, as if 'sum' kept it; pass 'p.clone()' to keep a copy
// case: move_after_let
class Box {
  n: i64 = 1
}

function main() {
  const a = new Box()
  const b = a
  print(a.n + b.n)
}
// error: 'a.n' can't be used here because 'a' was moved
// error: note: 'a' moved here: 'b' owns it now; use 'a.clone()' to keep a copy
// case: move_assign_into_moved
type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function take(p: Pair): i64 {
  return p.left.v
}

function main() {
  let p: Pair = { left: { v: 1 }, right: { v: 2 } }
  take(p)
  p.left = { v: 3 }
}
// error: can't assign to 'p.left' because 'p' was moved
// case: move_assignment_value
type Point = { x: i64 }

function main() {
  const p: Point = { x: 1 }
  let b: Point = { x: 2 }
  const a = (b = p)
  print(a.x, b.x)
}
// error: 'b.x' can't be used here because 'b' was moved
// case: move_branch
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  const sure = true
  if (sure) {
    take(p)
  }
  print(p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: move_break
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  outer: while (true) {
    while (true) {
      take(p)
      break outer
    }
  }
  print(p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: move_conditional
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  const sure = true
  const n = sure && take(p) > 0
  print(n, p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: move_fallthrough
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  const n = 1
  switch (n) {
    case 1:
      take(p)
    case 2:
      print(p.x)
      break
  }
}
// error: 'p.x' can't be used here because 'p' was moved
// case: move_field_inside
type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function main() {
  const p: Pair = { left: { v: 1 }, right: { v: 2 } }
  const l = p.left
  print(p.left.v, l.v)
}
// error: 'p.left.v' can't be used here because 'p.left' was moved
// case: move_field_whole
type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function take(i: Inner): i64 {
  return i.v
}

function sum(p: Pair): i64 {
  return p.left.v + p.right.v
}

function main() {
  const p: Pair = { left: { v: 1 }, right: { v: 2 } }
  take(p.left)
  print(sum(p))
}
// error: 'p' can't be used as a whole here because 'p.left' was moved out of it
// error: note: 'p.left' moved here: passing it to 'take' hands it over
// case: move_fields
// A field can be moved out of a variable or parameter that owns it; the other fields stay
// usable, and assigning the moved field makes the whole usable again.
type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner; n: i64 }

function take(i: Inner): i64 {
  return i.v
}

function split(p: Pair): i64 {
  const l = take(p.left)
  return l * 10 + p.right.v + p.n
}

function whole(p: Pair): i64 {
  return p.left.v + p.right.v
}

function main() {
  let p: Pair = { left: { v: 1 }, right: { v: 2 }, n: 3 }
  const a = take(p.left)
  const b = p.right.v + p.n
  p.left = { v: 4 }
  print(a, b, whole(p), split({ left: { v: 5 }, right: { v: 6 }, n: 7 }))
}
// expect: 1 5 6 63
// case: move_flow
// A move counts only on the paths it happens on: a branch that leaves takes its move with it,
// and a variable assigned again each time round a loop can be moved each time.
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function pick(p: Point, early: boolean): i64 {
  if (early) {
    return take(p)
  }
  return p.x + 100
}

function main() {
  let p: Point = { x: 1 }
  let total = 0
  let i = 0
  while (i < 3) {
    total = total + take(p)
    p = { x: i + 2 }
    i++
  }
  const q: Point = { x: 7 }
  for (let j = 0; j < 5; j++) {
    if (j === 2) {
      total = total + take(q)
      break
    }
  }
  const r: Point = { x: 9 }
  switch (total) {
    case 0:
      take(r)
      break
    default:
      total = total + r.x
  }
  print(pick({ x: 4 }, true), pick({ x: 4 }, false), total, p.x)
}
// expect: 4 104 22 4
// case: move_for_update
type P = { x: i64 }

function take(p: P): i64 {
  return p.x
}

function main() {
  const p: P = { x: 1 }
  for (let i = 0; i < 3; i = i + take(p)) {
    print(p.x)
  }
}
// error: 'p.x' can't be used here because 'p' was moved (in an earlier pass through this loop)
// case: move_into_array
type Box = { s: string };
function take(b: Box): string { return b.s; }
function main() {
  const b: Box = { s: "a" + "b" };
  console.log(take(b));
  const ys = [b];
  console.log(ys[0].s);
}
// error: 'b' was moved, so it can't be used here
// case: move_into_object
type Point = { x: i64; y: i64 }

function main() {
  const p: Point = { x: 1, y: 2 }
  const line = { p, q: { x: 0, y: 0 } }
  print(line.p.x, p.y)
}
// error: 'p.y' can't be used here because 'p' was moved
// error: note: 'p' moved here into the new object; use 'p.clone()' to keep a copy
// case: move_loop
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  let i = 0
  while (i < 3) {
    print(take(p))
    i++
  }
}
// error: 'p' was moved, so it can't be used here (in an earlier pass through this loop)
// case: move_loop_late
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  for (let i = 0; i < 3; i++) {
    print(p.x)
    if (i === 1) {
      continue
    }
    take(p)
  }
}
// error: 'p.x' can't be used here because 'p' was moved (in an earlier pass through this loop)
// case: move_loops
// Declarations inside a loop are fresh each pass; `while (true)` ends only by its `break`;
// `do...while`, labels and Copy values passed twice all behave.
type P = { x: i64 }

enum Color {
  Red,
  Green,
}

function take(p: P): i64 {
  return p.x
}

function shade(c: Color, n: 1 | 2): i64 {
  return c === Color.Green ? n : 0
}

function main() {
  let total = 0
  let i = 0
  while (i < 3) {
    const q: P = { x: i }
    total = total + take(q)
    for (let r: P = { x: 1 }; r.x < 2; r = { x: r.x + 1 }) {
      total = total + 1
    }
    i++
  }
  let p: P = { x: 0 }
  let n = 0
  while (true) {
    p = { x: n }
    n++
    if (n > 3) {
      break
    }
    total = total + take(p)
  }
  let k = 0
  do {
    const d: P = { x: k }
    total = total + take(d)
    k++
  } while (k < 2)
  outer: for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      const e: P = { x: 10 }
      if (b === 1) {
        continue outer
      }
      total = total + take(e)
    }
  }
  const c = Color.Green
  const one: 1 | 2 = 2
  print(total, p.x, shade(c, one) + shade(c, one))
}
// expect: 30 3 4
// case: move_out_of_this
type Inner = { v: i64 }

class Holder {
  inner: Inner = { v: 1 }
  get(): Inner {
    return this.inner
  }
}

function main() {
  print(new Holder().get().v)
}
// error: 'this.inner' can't be moved out of 'this', since it is only borrowed here; use 'this.inner.clone()'
// case: move_setter_copy
// A setter assignment of a Copy value can still be used as a value.
class Holder {
  #n: i64 = 0
  get n(): i64 {
    return this.#n
  }
  set n(v: i64) {
    this.#n = v
  }
}

function main() {
  let h = new Holder()
  print(h.n = 4, h.n)
}
// expect: 4 4
// case: move_setter_read
type P = { x: i64 }

class Holder {
  #p: P = { x: 0 }
  get p(): P {
    return this.#p.clone()
  }
  set p(v: P) {
    this.#p = v
  }
}

function main() {
  let h = new Holder()
  const r: P = { x: 4 }
  print((h.p = r).x)
}
// error: 'h.p' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone
// case: move_setter_statement
// A setter assignment whose value is thrown away, on its own or in a branch of a `?:`
// statement, keeps nothing twice.
type P = { x: i64 }

class Holder {
  #p: P = { x: 0 }
  get p(): P {
    return this.#p.clone()
  }
  set p(v: P) {
    this.#p = v
  }
}

function main() {
  let h = new Holder()
  const r: P = { x: 4 }
  const sure = true
  sure ? (h.p = r) : (h.p = { x: 1 })
  print(h.p.x)
}
// expect: 4
// case: move_setter_value
// A setter keeps the value assigned to it, so the assignment can't also hand it on.
type P = { x: i64 }

class Holder {
  #p: P = { x: 0 }
  get p(): P {
    return this.#p.clone()
  }
  set p(v: P) {
    this.#p = v
  }
}

function keep(p: P): i64 {
  return p.x
}

function main() {
  let h = new Holder()
  const r: P = { x: 4 }
  print(keep(h.p = r), h.p.x)
}
// error: 'h.p' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone
// case: move_shorthand_narrowed
// A shorthand of a narrowed variable holds the narrowed value, which may be Copy.
type P = { x: i64 }

function main() {
  const u: P | i64 = 5
  if (typeof u === "number") {
    const o = { u }
    print(o.u, u)
  }
}
// expect: 5 5
// case: move_this
class Node {
  n: i64 = 1
  me(): Node {
    return this
  }
}

function main() {
  print(new Node().me().n)
}
// error: 'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy
// case: move_through_non_null
class P { x: i64; constructor(x: i64) { this.x = x } }
type B = { p: P };
function take(p: P) { console.log(p.x) }
function main() { let o: B | null = { p: new P(3) }; take(o!.p); console.log(o!.p.x); }
// error: 'o!.p.x' can't be used here because 'o.p' was moved
// case: move_type_parameter
function both<T>(t: T): T {
  const a = t
  return t
}

function main() {
  print(both(1))
}
// error: 't' was moved, so it can't be used here
