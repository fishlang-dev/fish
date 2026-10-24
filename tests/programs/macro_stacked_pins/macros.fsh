function label(): string { return "from macros"; }
export macro function withLabel(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("described")}(): string { return label(); }`];
}
export macro function keep(input: Ast): Ast { return input; }
