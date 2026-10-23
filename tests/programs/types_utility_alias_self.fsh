// error: type 'V' reads a class's fields while that class's own field types are being worked out from it
// An alias over a class can't be used in that class's own fields.
type V = Pick<Node, "a">;
class Node { a: i64 = 1; v: V | null = null; }
function main() {}
