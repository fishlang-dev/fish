class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }
}

function grow(c: Counter) {
  c.bump()
}

function main() {}
// error: calling a mutating method on a parameter is not supported yet; copy it into a 'let'
