// expect: 5 12 area 6
// A program in several files: functions, a const and a class imported from other files, one
// through a directory's index.fsh, with the extension written or left out.
import { add, LIMIT } from "./math";
import { mul } from "./more.fsh";
import { Rect } from "./geometry";
function main() {
  const r = new Rect(2, 3);
  console.log(add(2, 3), mul(LIMIT, 4), r.label(), r.area());
}
