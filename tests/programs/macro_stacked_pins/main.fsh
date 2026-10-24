// expect: 1 from macros
import { withLabel, keep } from "./macros.fsh";
@keep @withLabel function one(): i64 { return 1; }
function main() { console.log(one(), described()); }
