// A method taking `this: Own<this>` takes its object over: it may move fields out, change it
// and return it, and the caller can't use the object afterwards.
class Inner {
  v = 1
}

class File {
  inner = new Inner()
  n = 0
  close(this: Own<this>): Inner {
    return this.inner
  }
  bump(this: Own<this>): File {
    this.n = this.n + 1
    return this
  }
  again(this: Own<this>): File {
    return this.bump().bump()
  }
}

function main() {
  const f = new File()
  const inner = f.close()
  const g = new File().again()
  print(inner.v, g.n)
}
// expect: 1 2
