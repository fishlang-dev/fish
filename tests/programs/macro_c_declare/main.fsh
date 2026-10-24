// expect: 3 2
// a macro gives main a C declaration that another file also writes
import { withAbs } from "./macros.fsh";
import { viaOther } from "./other.fsh";
@withAbs function f() {}
function main() { const v = unsafe { labs(-3) }; console.log(v, viaOther()); }
