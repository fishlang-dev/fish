class C {
  n = 1
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type RC = { r: Ref<C> }

function main() {
  let c = new C()
  let h: RC = { r: c }
  h.r.bump()
}
// error: cannot call 'bump' on 'h.r' because it is a shared reference ('Ref'), which only reads
