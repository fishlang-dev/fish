// case: non_null_read
// A '!' on a value that can't be empty is that value.
type Box = { n: i64; name: string }
function seven(): i64 { return 7 }
function main() {
  const xs: i64[] = [1, 2, 3]
  const names = ["ann", "bo"]
  const s = "fish"
  const b: Box = { n: 4, name: "box" }
  print(xs[1]!, names[0]!, s[2]!, b.n!, b.name!, seven()!, xs[0]! + xs[2]!)
  const o: i64 | null = 5
  print(o!, xs.length!)
}
// expect: 2 ann s 4 box 7 4
// expect: 5 3
// case: non_null_write
// Writing through a '!' writes the place itself.
type Pt = { x: i64 }
type Path = { items: Pt[] }
function main() {
  let xs: i64[] = [1, 2, 3]
  xs[1]! = 20
  xs[2]! += 5
  let p: Path = { items: [{ x: 1 }, { x: 2 }] }
  p.items[1]!.x = 3
  p.items[0]!.x++
  print(xs[0], xs[1], xs[2], p.items[0]!.x, p.items[1]!.x)
}
// expect: 1 20 8 2 3
// case: non_null_mutating_call
// A mutating call through a '!' changes the element where it lives.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function main() {
  let xs: i64[][] = [[1], [2, 3]]
  xs[0]!.push(9)
  xs[1]!.pop()
  let cs: C[] = [new C()]
  cs[0]!.next()
  print(xs[0]!.length, xs[1]!.length, cs[0]!.next())
}
// expect: 2 1 2
// case: non_null_lend
// A '!' that can't fail lends the place mutably, where a real Option's would lend a copy.
class C { n: i64 = 0 }
function bump(c: Mut<C>) { c.n += 10 }
function main() {
  let cs: C[] = [new C()]
  bump(cs[0]!)
  print(cs[0]!.n)
}
// expect: 10
// case: non_null_variables
// Variables written through a '!', the old value dropped as without it.
type Pt = { x: i64; tag: string }
function main() {
  let n = 1
  n! = 2
  n!++
  n! += 3
  let s = "a"
  s! = "b" + s
  let ps: Pt[] = [{ x: 1, tag: "p" }]
  ps[0]!.tag = "q"
  ps[0]! = { x: 9, tag: "r" + ps[0]!.tag }
  print(n, s, ps[0]!.x, ps[0]!.tag)
}
// expect: 6 ba 9 rq
// case: non_null_index_once
// An index along a target written through a '!' runs once, before the value.
type Pt = { x: i64 }
function at(n: Mut<i64>): usize { n += 1; return 0 }
function main() {
  let calls = 0
  let xs: i64[] = [1, 2]
  xs[at(calls)]! += 5
  let ps: Pt[] = [{ x: 1 }]
  ps[at(calls)]!.x += 1
  print(xs[0], ps[0]!.x, calls)
}
// expect: 6 2 2
// case: non_null_move
// Moving out through a '!' moves the value itself.
class P { x: i64; constructor(x: i64) { this.x = x } }
type Holder = { p: P }
function take(p: P) { print(p.x) }
function main() {
  const h: Holder = { p: new P(1) }
  take(h.p!)
  print(h.p!.x)
}
// error: because 'h.p' was moved
// case: non_null_borrow_conflict
// A borrow through a '!' conflicts as the place's own does.
type P = { x: i64 }
function main() {
  let ps: P[] = [{ x: 1 }]
  const r: Ref<P> = ps[0]!
  ps[0]!.x = 3
  print(r.x)
}
// error: cannot change 'ps[0]!.x' while 'r' borrows 'ps[...]' and is used later
// case: non_null_release
// mode: release
type Pt = { x: i64 }
function main() {
  let xs: i64[] = [1, 2, 3]
  xs[0]! = 10
  let ps: Pt[] = [{ x: 1 }]
  ps[0]!.x = 5
  const s = "abc"
  print(xs[0]!, ps[0]!.x, s[1]!)
}
// expect: 10 5 b
// case: non_null_comptime
// A '!' that can't fail is the value while compiling too, read and written.
function second(xs: i64[]): i64 { return xs[1]! * 10 }
function fill(n: i64): i64[] {
  let xs: i64[] = [0, 0, 0]
  xs[1]! = n
  xs[2]! += n
  xs[0]!++
  let nested: i64[][] = [[]]
  nested[0]!.push(n)
  xs.push(nested[0]![0]!)
  return xs
}
const n = comptime second([4, 5, 6])
const made = comptime fill(4)
function main() {
  const m = comptime second([1, 2])
  print(n, m, made[0]!, made[1]!, made[2]!, made[3]!)
}
// expect: 50 20 1 4 4 4
