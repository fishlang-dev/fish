// expect: 1
// A directory imports its parent's index.fsh with '..'.
import { f } from "./sub";
function main() { console.log(f()); }
