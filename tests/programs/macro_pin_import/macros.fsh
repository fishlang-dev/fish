import { fmt } from "./util.fsh";
export macro function described(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("describe")}(): string { return fmt(); }`];
}
