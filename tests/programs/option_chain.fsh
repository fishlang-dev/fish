// '?.' reads a field or calls a method through an Option; an empty one gives an empty
// result and skips the rest of the chain, the call included. Every argument runs before
// anything prints.
type Inner = { x: i64 }
type Outer = { inner: Inner; tag?: i64 }
class Acc {
  total = 0
  add(this: Mut<this>, n: i64): i64 {
    this.total += n
    print("add ran")
    return this.total
  }
  get double(): i64 { return this.total * 2 }
}
function main() {
  const some: Outer | null = { inner: { x: 5 } }
  const none: Outer | null = null
  print(some?.inner.x, none?.inner.x, some?.tag, none?.tag)
  const sx = some?.inner.x
  print(sx ?? -1, none?.inner.x ?? -1)
  let a: Acc | null = new Acc()
  print(a?.add(3), a?.add(4), a?.double)
  let b: Acc | null = null
  print(b?.add(1), b?.double)
}
// expect: 5 null null null
// expect: 5 -1
// expect: add ran
// expect: add ran
// expect: 3 7 14
// expect: null null
