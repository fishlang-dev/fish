// expect: util
// the quote calls fmt, which the macro's file imports
import { described } from "./macros.fsh";
@described function f() {}
function main() { console.log(describe()); }
