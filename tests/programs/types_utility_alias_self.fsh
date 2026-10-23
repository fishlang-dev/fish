// error: 'Pick' of 'Node' is needed while the field types of 'Node' are being worked out
// An alias over a class can't be used in that class's own fields.
type V = Pick<Node, "a">;
class Node { a: i64 = 1; v: V | null = null; }
function main() {}
