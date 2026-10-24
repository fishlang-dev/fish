import { make } from "./build.fsh";
export macro function described(input: AstStmt): Ast[] {
  return [input, make()];
}
