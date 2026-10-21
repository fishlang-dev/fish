class C {
  n: i64 = 1
  add(this: Mut<this>, o: Ref<C>) {
    this.n = this.n + o.n
  }
}

function main() {
  let c = new C()
  const s: Ref<C> = c
  c.add(s)
}
// error: cannot mutably lend 'c' while 's' borrows 'c' and is used later
