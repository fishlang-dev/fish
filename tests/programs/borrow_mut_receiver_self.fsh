class C {
  n: i64 = 1
  add(this: Mut<this>, o: Ref<C>) {
    this.n = this.n + o.n
  }
}

function main() {
  let c = new C()
  let r: Mut<C> = c
  r.add(r)
}
// error: cannot mutably lend 'r' while 'r' is lent to 'add' for this call
