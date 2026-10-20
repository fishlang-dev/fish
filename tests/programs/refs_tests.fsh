// Tag checks, comparisons, printing and switch read through references.
class A {
  a: i64 = 1
}

class B {
  b: i64 = 2
}

enum Color {
  Red,
  Green,
  Blue,
}

function f(r: Ref<A>, b: Ref<boolean>, k: Ref<i64>) {
  print(r instanceof A, typeof b === "boolean", typeof k === "number")
}

function rc(c: Ref<Color>): i64 {
  if (c === Color.Green) return 1
  return c
}

function ru(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function rl(l: Ref<"hi" | "yo">): i64 {
  return l === "hi" ? 1 : 2
}

function rab(x: Ref<A | B>): i64 {
  return x instanceof A ? 1 : 0
}

function shown(b: Ref<boolean>, c: Ref<Color>, u: Ref<i64 | boolean>, l: Ref<"hi" | "yo">) {
  print(b, c, u, l)
}

function sw(k: Ref<i64>): i64 {
  switch (k) {
    case 1:
      return 10
    default:
      return 20
  }
}

function main() {
  f(new A(), true, 3)
  const x: A | B = new A()
  const u: i64 | boolean = 41
  const v: i64 | boolean = false
  print(rc(Color.Blue), ru(u), ru(v), rl("yo"), rab(x))
  shown(true, Color.Green, false, "yo")
  print(sw(1), sw(2))
}
// expect: true true true
// expect: 2 3 2 2 1
// expect: true 1 false yo
// expect: 10 20
