// case: throw_expression
// A throw expression raises where a value goes, in '??' and '?:', propagating or caught.
function find(n: i64): i64 | null {
  return n > 0 ? n : null
}
function need(n: i64): i64 throws i64 {
  const v = find(n) ?? throw -1
  return v * 10
}
function positive(n: i64): i64 throws boolean {
  return n > 0 ? n : throw false
}
function main() throws i64 | boolean {
  print(need(3))
  try {
    print(need(-2))
  } catch (e) {
    print("caught", e)
  }
  print(positive(4))
  try {
    const w = find(0) ?? throw 9
    print(w)
  } catch (e) {
    print("local", e)
  }
  print(positive(-1))
}
// expect: 30
// expect: caught -1
// expect: 4
// expect: local 9
// fails: Error: false
// case: throw_expression_closure
// A throw expression in an arrow makes the arrow throw.
function main() throws i64 {
  const g = (x: i64) => x > 0 ? x : throw 1
  print(g(2))
}
// expect: 2
// case: throw_expression_unhandled
// A throw expression needs a 'throws' clause too.
function f(x: i64 | null): i64 {
  return x ?? throw 1
}
function main() {}
// error: 'f' must declare 'throws i64' after its return type to throw here
// case: throw_newline
function main() {
  throw
    1
}
// error: a line break is not allowed after 'throw'
// case: throw_reference
// A reference can't be thrown, even to a catch.
class P { constructor(public x: i64) {} }
class Box { constructor(public p: P) {} 
  get(this: Ref<this>): Ref<P> { return this.p } }
function take(b: Box) { print("took") }
function main() {
  const b = new Box(new P(1))
  try {
    throw b.get()
  } catch (e) {
    take(b)
    print(e.x)
  }
}
// error: errors holding references are not supported yet
