// A closure holds what it moves out, or everything under `move`; one that only borrows or
// copies is itself copied, and `move(x)` without an arrow is a call.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) + f(v) }
function move(x: i64): i64 { return x + 1 }
function main() {
  const o = new O(5)
  const once = () => take(o)
  print(once())
  const p = new O(7)
  const keep = move () => p.n * 2
  print(keep(), keep())
  let n = 10
  const counter = move () => {
    n++
    return n
  }
  print(counter(), counter(), n)
  const base = 3
  const add = (x: i64) => x + base
  print(apply(add, 1), apply(add, 2))
  print(move(1))
}
// expect: 5
// expect: 14 14
// expect: 11 12 10
// expect: 8 10
// expect: 2
