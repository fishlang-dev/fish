function fmt(): string { return "from macros"; }
export macro function described(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("describe")}(): string { return fmt(); }`];
}
