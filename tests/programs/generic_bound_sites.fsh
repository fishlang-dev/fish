// A call's view of the type parameters it passed belongs to the instance making it, and an
// inferred return holding a generic class is seen through the caller's parameters.
interface H {
  a: i64
}

class C {
  a: i64 = 7
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
}

function id<T>(t: T): T {
  return t
}

function f<T extends H>(t: T): i64 {
  const r: T = id(t)
  return r.a
}

function mk<T>(t: T) {
  return new Box(t)
}

function k<U extends H>(u: U): i64 {
  return mk(u).v.a
}

function main() {
  print(f(new C()), k(new C()), k({ a: 3 }))
}

// Declared after main, so the definition check of the call inside f comes after its instance.
function later<U extends H>(u: U): i64 {
  return f(u)
}
// expect: 7 7 3
