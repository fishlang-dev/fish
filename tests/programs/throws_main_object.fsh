// An error that can't be printed shows its type.
class Bad { constructor(public code: i64) {} }
function main() throws Bad {
  throw new Bad(3)
}
// fails: Error: Bad
