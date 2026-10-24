// case: own_receiver
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
// case: own_receiver_borrowed_this
class File {
  n = 0
  close(this: Own<this>): i64 {
    return this.n
  }
  peek(): i64 {
    return this.close()
  }
}

function main() {}
// error: can't call 'close' on 'this' here: it takes its object over, and this method only borrows 'this'
// case: own_receiver_moved
class File {
  n = 0
  close(this: Own<this>): i64 {
    return this.n
  }
}

function main() {
  const f = new File()
  f.close()
  print(f.n)
}
// error: 'f.n' can't be used here because 'f' was moved
// error: note: 'f' moved here: 'close' takes its object over
// case: own_receiver_reference
class File {
  n = 0
  close(this: Own<this>): i64 {
    return this.n
  }
}

function shut(f: Ref<File>): i64 {
  return f.close()
}

function main() {}
// error: can't call 'close' through the reference 'f': it takes its object over
// case: own_returns_reference
class File {
  n = 0
  leak(this: Own<this>): Ref<i64> {
    return this.n
  }
}

function main() {}
// error: this function returns a reference but borrows nothing it could point into
// case: own_super
class Base {
  n = 1
  close(this: Own<this>): i64 {
    return this.n
  }
}

class D extends Base {
  peek(this: Mut<this>): i64 {
    return super.close()
  }
}

function main() {}
// error: can't call 'close' on 'this' here: it takes its object over, and this method only borrows 'this'
