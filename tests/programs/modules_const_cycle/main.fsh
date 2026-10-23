// error: 'A' in 'main.fsh' reads 'B' in 'b.fsh', which reads 'A' in 'main.fsh'
import { B } from "./b";
export const A: i64 = B + 1;
function main() { console.log(A); }
