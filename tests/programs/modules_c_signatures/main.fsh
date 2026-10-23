// error: the C function 'labs' is declared in 'a.fsh' with other types
import { a } from "./a";
import { b } from "./b";
function main() { console.log(a(), b()); }
