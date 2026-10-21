class C {
  n: i64 = 1
  add(this: Mut<this>, k: i64) {
    this.n = this.n + k
  }
}

function main() {
  let a = new C()
  let b = new C()
  const c = true
  ;(c ? a : b).add(5)
}
// error: can't call 'add' on a '?:', which would change a copy; call it in each branch
