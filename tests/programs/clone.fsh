// case: clone
// `.clone()` copies an object, an instance or a union; a class's own `clone()` runs instead,
// through a type parameter too.
type Point = { x: i64; y: i64 }

class Counter {
  n: i64 = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

class Tracked {
  copies: i64 = 0
  clone(): Tracked {
    let t = new Tracked()
    t.copies = this.copies + 1
    return t
  }
}

interface Shape {
  sides: i64
}

function twin<T>(t: T): T {
  return t.clone()
}

function main() {
  let p: Point = { x: 1, y: 2 }
  let q = p.clone()
  q.x = 9
  let c = new Counter()
  let d = c.clone()
  d.bump()
  d.bump()
  const u: Point | i64 = { x: 3, y: 4 }
  const v = u.clone()
  const t = new Tracked().clone().clone()
  const w = twin(new Tracked())
  const z = twin({ x: 5, y: 6 })
  print(p.x, q.x, c.n, d.n, typeof v === "number" ? 0 : v.y, t.copies, w.copies, z.y)
}
// expect: 1 9 0 2 4 2 1 6
// case: clone_inherited
// A base's own clone() makes a base, so a derived class without one gets the compiler's copy;
// Copy values clone too.
class Base {
  n: i64 = 1
  clone(): Base {
    let b = new Base()
    b.n = this.n + 100
    return b
  }
}

class Derived extends Base {
  m: i64 = 2
}

function main() {
  const d = new Derived()
  const e: Derived = d.clone()
  const five = 5
  print(e.n, e.m, d.clone().n, new Base().clone().n, five.clone())
}
// expect: 1 2 1 101 5
// case: clone_shape
class Tracked {
  copies: i64 = 0
  clone(extra: i64): Tracked {
    return new Tracked()
  }
}

function main() {}
// error: a 'clone' method must take no parameters and return 'Tracked', since it replaces the compiler's copy
