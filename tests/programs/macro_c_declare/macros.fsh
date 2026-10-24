export macro function withAbs(input: AstStmt): Ast[] {
  return [input, quote`declare function labs(x: i64): i64;`];
}
