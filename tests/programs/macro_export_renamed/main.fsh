// expect: renamed
// a renaming macro on an exported function: is the new name exported?
import { namedRenamed } from "./lib.fsh";
function main() { console.log(namedRenamed()); }
