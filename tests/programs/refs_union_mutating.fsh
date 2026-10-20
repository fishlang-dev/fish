class C {
  n: i64 = 4
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type U = { kind: "a"; c: C } | { kind: "b"; c: C; z: i64 }

function main() {
  let u: U = { kind: "b", c: new C(), z: 1 }
  u.c.bump()
}
// error: can't call 'bump' on 'c' through
