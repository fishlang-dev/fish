// error: b.fsh:2:1: error: can't find the file './nowhere'
import { f } from "./b";
function main() { console.log(f()); }
