// A getter or method called on a field every member of a union shares reads a copy of it.
class C {
  n: i64 = 4
  get twice(): i64 {
    return this.n * 2
  }
  plus(k: i64): i64 {
    return this.n + k
  }
}

type U = { kind: "a"; c: C } | { kind: "b"; c: C; z: i64 }

function main() {
  const u: U = { kind: "b", c: new C(), z: 1 }
  print(u.c.twice, u.c.plus(1))
}
// expect: 8 5
