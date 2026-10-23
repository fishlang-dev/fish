// error: 'Partial' of 'Node' is needed while the field types of 'Node' are being worked out
// A class's fields aren't known while its own field types are being worked out.
class Node {
  value: i64 = 0;
  patch: Partial<Node> | null = null;
}
function main() {}
