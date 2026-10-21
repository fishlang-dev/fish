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
