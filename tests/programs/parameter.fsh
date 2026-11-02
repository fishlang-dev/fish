// case: parameter_annotation
function f(a) {  // error: parameter 'a' implicitly has an 'any' type; add a type annotation
}

function main() {
}
// case: parameter_assign
function count(n: i64): i64 {
  let total = 0
  while (n > 0) {
    total += n
    n--
  }
  n = n + 10
  n++
  return total + n
}

function main() {
  console.log(count(4))
}
// expect: 21
// case: parameter_cursor
// A parameter used as a cursor moves through the loop.
function skipSpaces(src: string, pos: usize): usize {
  while (pos < src.length && src[pos] === " ") pos++
  return pos
}

function main() {
  console.log(skipSpaces("   x", 0))
}
// expect: 3
// case: parameter_assign_owned
// The old value is dropped when an owned parameter takes a new one.
function grow(xs: string[], s: string): string[] {
  xs.push(s)
  xs = [...xs, "end"]
  s = s + "!"
  s += "?"
  xs.push(s)
  return xs
}

function main() {
  console.log(grow(["a"], "b").join(","))
}
// expect: a,b,end,b!?
// case: parameter_assign_field
class Counter {
  count = 0
  bump(this: Mut<this>) {
    this.count++
  }
}

function bumped(c: Counter, p: { n: i64 }): i64 {
  c.bump()
  c.count += 5
  p.n *= 2
  return c.count + p.n
}

function main() {
  console.log(bumped(new Counter(), { n: 4 }))
}
// expect: 14
// case: parameter_revive
// Assigning a parameter after moving it out gives it a value again.
function take(xs: string[]) {
  console.log(xs.length)
}

function revive(xs: string[]): usize {
  take(xs)
  xs = ["a", "b", "c"]
  return xs.length
}

function main() {
  console.log(revive(["x"]))
}
// expect: 1
// expect: 3
// case: parameter_moved_read
function take(xs: string[]) {
  console.log(xs.length)
}

function f(xs: string[]) {
  take(xs)
  console.log(xs.length)  // error: 'xs.length' can't be used here because 'xs' was moved
}

function main() {}
// case: parameter_ref_rebind
function f(r: Ref<string>) {
  const s = "x"
  r = s  // error: cannot point the reference parameter 'r' elsewhere; it borrows what the caller passed, so declare a 'let' for another reference
}

function main() {}
// case: parameter_mut_write
// Assigning a 'Mut' parameter writes through it, to what the caller lent.
function f(r: Mut<i64[]>) {
  r.push(1)
  r = [2, 3]
}

function main() {
  let a = [1]
  f(a)
  console.log(a.length)
}
// expect: 2
// case: parameter_mut_replace
// Unlike TypeScript, where it would only rebind the local, assigning a 'Mut' parameter a new
// object replaces the caller's.
class T {
  constructor(public n: i64) {}
}

function f(p: Mut<T>) {
  p = new T(9)
}

function main() {
  let t = new T(1)
  f(t)
  console.log(t.n)
}
// expect: 9
// case: parameter_shadowed_narrow
// An inner binding of the same name being assigned doesn't stop the parameter narrowing.
function f(n: i64 | null): i64 {
  if (n === null) return 0
  {
    let n = 2
    n = 3
    console.log(n)
  }
  const g = (n: i64): i64 => {
    n = n + 1
    return n
  }
  return g(n) + 1
}

function main() {
  console.log(f(4))
}
// expect: 3
// expect: 6
// case: parameter_shape_assign
type O = { s: string }
function h(o: O): string {
  o = { s: "x" }  // error: 'o' takes any value with the members of '{ s: string }', which may have more, so it can't be given a '{ s: string }'
  return o.s
}

function main() {}
// case: parameter_readonly_array
function f(xs: readonly i64[]) {
  xs = []  // error: cannot point the reference parameter 'xs' elsewhere
}

function main() {}
// case: parameter_holding_ref
function f(o: Ref<string> | null) {
  o = null  // error: assigning to a parameter holding a reference is not supported yet; copy it into a 'let'
}

function main() {}
// case: parameter_default_assign
function next(n: i64 = 5): i64 {
  n++
  return n
}

function main() {
  console.log(next())
  console.log(next(1))
}
// expect: 6
// expect: 2
// case: parameter_destructured_assign
function label({ a, b }: { a: i64; b: string }, [x]: string[]): string {
  a++
  b = `${b}${a}`
  x += b
  return x
}

function main() {
  console.log(label({ a: 1, b: "s" }, ["x"]))
}
// expect: xs2
// case: parameter_rest_assign
function last(...xs: i64[]): i64 {
  xs.push(10)
  xs = [xs.length as i64]
  return xs[0]!
}

function main() {
  console.log(last(1, 2))
}
// expect: 3
// case: parameter_property_assign
class P {
  constructor(public n: i64) {
    n = n + 1
    this.n += n
  }
}

function main() {
  console.log(new P(1).n)
}
// expect: 3
// case: parameter_async_assign
async function later(n: i64): Promise<i64> {
  n = n * 2
  await sleep(1)
  n++
  return n
}

async function main() {
  const v = await later(3)
  console.log(v)
}
// expect: 7
// case: parameter_generator_assign
function* down(n: i64): Generator<i64> {
  while (n > 0) {
    yield n
    n -= 1
  }
}

function main() {
  for (const x of down(3)) console.log(x)
}
// expect: 3
// expect: 2
// expect: 1
// case: parameter_closure_assign
// A closure that captures a parameter changes it where it was made; a move closure changes
// its own copy.
function f(n: i64): i64 {
  const bump = () => {
    n += 2
  }
  bump()
  function step() {
    n -= 1
  }
  step()
  let copy = move () => {
    n = 100
    return n
  }
  console.log(copy())
  return n
}

function main() {
  console.log(f(1))
}
// expect: 100
// expect: 2
// case: parameter_async_nested_copy
async function f(n: i64): Promise<i64> {
  async function g() { return n }  // error: the async nested function 'g' takes its own copy of 'n' when it is made, so a change to it wouldn't reach the function; pass 'n' as a parameter, or leave it unchanged
  n = 3
  const v = await g()
  return v
}

async function main() {}
// case: parameter_async_nested_unchanged
async function f(n: i64): Promise<i64> {
  async function g() { return n }
  const v = await g()
  return v
}

async function main() {
  const v = await f(4)
  console.log(v)
}
// expect: 4
