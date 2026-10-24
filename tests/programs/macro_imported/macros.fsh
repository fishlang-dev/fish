export macro function withTwin(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("twin")}(): i64 { return 2; }`];
}
