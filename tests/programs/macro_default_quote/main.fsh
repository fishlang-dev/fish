// expect: 10
// the default quote is the macro's code, so LIMIT means a.fsh's (5), giving 10
import { addFn } from "./a.fsh";
const LIMIT = 1000;
@addFn("got") function f() {}
function main() { console.log(got()); }
