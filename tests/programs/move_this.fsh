class Node {
  n: i64 = 1
  me(): Node {
    return this
  }
}

function main() {
  print(new Node().me().n)
}
// error: 'this' can't be moved, since a method only borrows it; use 'this.clone()' to hand over a copy
