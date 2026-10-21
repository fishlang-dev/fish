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
