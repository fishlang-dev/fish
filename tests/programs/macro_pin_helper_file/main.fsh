// expect: from build
// the quote is in a helper in a third file and names that file's private function
import { described } from "./macros.fsh";
@described function f() {}
function main() { console.log(describe()); }
