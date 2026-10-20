class Node {
  constructor(public value: i64, public next: Node | "none") {}
}

function main() {}
// error: class 'Node' contains itself, so it would have infinite size
