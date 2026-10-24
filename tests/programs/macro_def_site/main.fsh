// expect: from macros
// The quote calls the macro file's fmt; main declares its own fmt.
import { described } from "./macros.fsh";
function fmt(): string { return "from main"; }
@described function f() {}
function main() {
  console.log(describe());
}
