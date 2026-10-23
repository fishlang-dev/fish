// error: 'Partial' of 'Node' can't be used in the types of the class's own fields yet
// A class's fields aren't known while its own field types are being worked out.
class Node {
  value: i64 = 0;
  patch: Partial<Node> | null = null;
}
function main() {}
