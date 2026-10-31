// error: unknown function 'helo'; did you mean 'hello'?
import { greeting as hello } from "./lib.fsh";
function main() {
  helo();
}
