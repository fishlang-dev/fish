// expect: 2
// a macro gives an exported declaration, imported by another file
import { made } from "./lib.fsh";
function main() { console.log(made()); }
