class Node<T> {
  constructor(public value: T, public next: Node<T>) {}
}

function main() {}
// error: contains itself, so it would have infinite size
