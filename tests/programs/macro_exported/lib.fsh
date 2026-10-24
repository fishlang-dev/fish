macro function exporting(input: AstStmt): Ast[] {
  return [input, quote`export function ${ident("made")}(): i64 { return 2; }`];
}
@exporting function f() {}
