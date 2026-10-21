class C {
  n: i64 = 1
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

function main() {
  let c = new C()
  let r: Mut<C> = c
  const s: Ref<C> = r
  r.bump()
  print(s.n)
}
// error: cannot mutably lend 'r' while 's' borrows 'r' and is used later
