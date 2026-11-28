// case: inferred_reads
// A function only the program calls, by name, borrows a parameter it only reads, so its caller
// keeps what it passes.
type Point = { x: i64; y: i64 }

function sum(p: Point): i64 {
  return p.x + p.y
}

function main() {
  const p: Point = { x: 1, y: 2 }
  print(sum(p), sum(p), p.x)
}
// expect: 3 3 1
// case: inferred_class_fields
class User {
  name: string
  age: i64
  constructor(name: string, age: i64) {
    this.name = name
    this.age = age
  }
}

function describe(u: User): string {
  return `${u.name} is ${u.age}`
}

function main() {
  const u = new User("Ada", 36)
  console.log(describe(u))
  console.log(describe(u), u.name.length)
}
// expect: Ada is 36
// expect: Ada is 36 3
// case: inferred_array
function total(xs: i64[]): i64 {
  let sum = 0
  for (const x of xs) sum += x
  return sum + (xs.length as i64)
}

function main() {
  const nums = [10, 20, 30]
  print(total(nums), nums.length, nums[0])
}
// expect: 63 3 10
// case: inferred_nested_fields
type Inner = { v: i64; tags: string[] }
type Outer = { inner: Inner; items: Inner[] }

function weigh(o: Outer): i64 {
  if (o.items.length === 0) return o.inner.v
  return o.inner.v + o.items[0].v + (o.inner.tags.length as i64)
}

function main() {
  const o: Outer = { inner: { v: 1, tags: ["a"] }, items: [{ v: 5, tags: [] }] }
  print(weigh(o), weigh(o), o.inner.v)
}
// expect: 7 7 1
// case: inferred_passed_on
// A parameter passed on to another function that only reads it is only read too.
type Box = { n: i64 }

function inner(b: Box): i64 {
  return b.n * 2
}

function outer(b: Box): i64 {
  return inner(b) + 1
}

function main() {
  const b: Box = { n: 4 }
  print(outer(b), inner(b), b.n)
}
// expect: 9 8 4
// case: inferred_recursive
type List = { values: i64[] }

function sumFrom(l: List, i: usize): i64 {
  if (i >= l.values.length) return 0
  return l.values[i] + sumFrom(l, i + 1)
}

function main() {
  const l: List = { values: [1, 2, 3] }
  print(sumFrom(l, 0), l.values.length)
}
// expect: 6 3
// case: inferred_temporary
type Point = { x: i64; y: i64 }

function sum(p: Point): i64 {
  return p.x + p.y
}

function main() {
  print(sum({ x: 3, y: 4 }))
}
// expect: 7
// case: inferred_mut
// A parameter of a class the function changes is lent mutably when every caller passes a `let`
// variable holding exactly that class.
class Counter {
  n: i64 = 0
  hits: i64[] = []
}

function bump(c: Counter) {
  c.n++
  c.hits.push(c.n)
}

function main() {
  let c = new Counter()
  bump(c)
  bump(c)
  print(c.n, c.hits.length)
}
// expect: 2 2
// case: inferred_mut_const_caller
// A caller's constant can't be lent mutably, so the parameter stays owned.
class Counter {
  n: i64 = 0
}

function bump(c: Counter) {
  c.n++
}

function main() {
  const c = new Counter()
  bump(c)
  print(c.n)
}
// error: 'c.n' can't be used here because 'c' was moved
// case: inferred_kept_owned
// A parameter returned is handed over, so it stays owned.
type Point = { x: i64 }

function keep(p: Point): Point {
  return p
}

function main() {
  const p: Point = { x: 1 }
  const q = keep(p)
  print(q.x, p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: inferred_stored_owned
// A parameter stored in what the function gives back is handed over, so it stays owned.
type Point = { x: i64 }

function wrap(p: Point): { p: Point } {
  return { p }
}

function main() {
  const p: Point = { x: 1 }
  const w = wrap(p)
  print(w.p.x, p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: inferred_exported
// An exported function's signature stays as written.
type Point = { x: i64 }

export function show(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  print(show(p), p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
// case: inferred_function_value
// A function used as a value keeps its signature as written, since its type is part of it.
type Point = { x: i64 }

function show(p: Point): i64 {
  return p.x
}

function main() {
  const f = show
  const p: Point = { x: 1 }
  print(show(p), p.x, f({ x: 2 }))
}
// error: 'p.x' can't be used here because 'p' was moved
// case: inferred_written_wins
// A written reference is what the function takes, though it only reads.
type Point = { x: i64 }

function show(p: Mut<Point>): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  print(show(p))
}
// error: is a constant
