class Counter {
  count = 0

  bump() {
    this.count++
  }
}

function main() {}
// error: cannot assign to 'this.count' because 'this' is read-only here; declare 'this: Mut<this>'
