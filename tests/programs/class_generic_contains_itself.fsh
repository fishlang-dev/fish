// error: class 'Node<T>' contains itself, so it would have infinite size
// A generic class holding itself inline is refused like a plain one, not left to overflow.
class Node<T> { v: T; next: Node<T> | null; constructor(v: T) { this.v = v; this.next = null; } }
function main() { const n = new Node<i64>(1); console.log(n.next === null); }
