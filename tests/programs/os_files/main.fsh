// expect: true true true
// expect: true
import * as system from "os";
import { where } from "./lib.fsh";
function main() {
  const p = system.platform();
  console.log(p === "darwin" || p === "linux", where() === p, system.availableParallelism() >= 1);
  console.log(system.homedir().length > 0);
}
