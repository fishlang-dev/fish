class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }

  twice() {
    this.bump()
  }
}

function main() {}
// error: cannot call 'bump' on 'this' because 'this' is read-only here; declare 'this: Mut<this>'
