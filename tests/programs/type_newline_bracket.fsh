// mode: parse
// The `[` starts a new statement, so this is an alias and then an array literal. Read as
// one indexed type, `B[1, 2]` would fail at the comma.
function main() {
  type A = B
  [1, 2]
}
