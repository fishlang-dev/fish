const LIMIT = 5;
export macro function addFn(input: AstStmt, name: string, e: AstExpr = quote`LIMIT * 2`): Ast[] {
  return [input, quote`function ${ident(name)}(): i64 { return ${e}; }`];
}
