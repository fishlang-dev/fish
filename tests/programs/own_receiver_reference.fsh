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
