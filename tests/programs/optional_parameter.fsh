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
