// case: in_narrowing
type Fish = { swim: i64 }
type Bird = { fly: i64 }

function move(a: Fish | Bird): i64 {
  if ("swim" in a) return a.swim
  return a.fly
}

function moveRef(a: Ref<Fish | Bird>): i64 {
  if (!("fly" in a)) return a.swim * 10
  return a.fly * 10
}

function main() {
  print(move({ swim: 1 }), move({ fly: 2 }))
  const b: Fish | Bird = { fly: 3 }
  print(moveRef(b), "swim" in b, "fly" in b)
  const f: Fish | Bird = { swim: 4 }
  print("swim" in f && f.swim > 3, "fly" in f ? f.fly : -1)
}
// expect: 1 2
// expect: 30 false true
// expect: true -1

// case: in_optional
type Cat = { meow: i64; lives?: i64 }
type Dog = { bark: i64 }

// A member whose field is optional stays on both sides: it has the key when the field holds a value.
function lives(a: Cat | Dog): string {
  if ("lives" in a) return `lives ${a.meow}`
  if ("bark" in a) return `bark ${a.bark}`
  return `cat without lives ${a.meow}`
}

function main() {
  print(lives({ meow: 1, lives: 9 }), lives({ meow: 2 }), lives({ bark: 3 }))
  const c: Cat = { meow: 5 }
  print("lives" in c, "meow" in c, "bark" in c)
}
// expect: lives 1 cat without lives 2 bark 3
// expect: false true false

// case: in_classes
class Duck {
  name = "duck"
  quack(): string {
    return "quack"
  }
}

class Robot {
  get serial(): i64 {
    return 42
  }
}

class Mallard extends Duck {}

function sound(x: Duck | Robot): string {
  if ("quack" in x) return x.quack()
  return `${x.serial}`
}

function main() {
  print(sound(new Duck()), sound(new Robot()))
  const r: Duck | Robot = new Robot()
  print("serial" in r, "name" in r, "quack" in r)
  // A base's members are the instance's keys too.
  const m: Mallard | Robot = new Mallard()
  print("quack" in m, "name" in m, "serial" in m)
}
// expect: quack 42
// expect: true false false
// expect: true true false

// case: in_recursive
type Tree = { leaf: i64 } | { left: Tree; right: Tree }

function sum(t: Tree): i64 {
  if ("leaf" in t) return t.leaf
  return sum(t.left) + sum(t.right)
}

function main() {
  const t: Tree = { left: { leaf: 1 }, right: { left: { leaf: 2 }, right: { leaf: 3 } } }
  print(sum(t))
}
// expect: 6

// case: in_comptime
type Fish = { swim: i64 }
type Bird = { fly: i64; name?: string }

function speed(a: Fish | Bird): i64 {
  if ("swim" in a) return a.swim
  return "name" in a ? a.fly * 2 : a.fly
}

const FAST = comptime speed({ fly: 4, name: "kite" })
const SLOW = comptime speed({ fly: 4 })
const SWIM = comptime speed({ swim: 7 })

function main() {
  print(FAST, SLOW, SWIM)
}
// expect: 8 4 7

// case: in_mut_generic
type A = { a: i64 }
type B = { b: string }

function bump(x: Mut<A | B>) {
  if ("a" in x) x.a = x.a + 1
}

function first<T extends { a: i64 }>(x: T | B): i64 {
  if ("a" in x) return x.a
  return -1
}

function main() {
  let v: A | B = { a: 1 }
  bump(v)
  print("a" in v ? v.a : 0)
  print(first<A>({ a: 5 }), first<A>({ b: "x" }))
  let n = 0
  const w: A | B = { b: "y" }
  while (!("a" in w)) { n++; if (n > 2) break }
  print(n)
}
// expect: 2
// expect: 5 -1
// expect: 3
