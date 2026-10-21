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
