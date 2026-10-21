class File {
  n = 0
  leak(this: Own<this>): Ref<i64> {
    return this.n
  }
}

function main() {}
// error: this function returns a reference but borrows nothing it could point into
