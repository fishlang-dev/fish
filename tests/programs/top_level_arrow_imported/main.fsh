// expect: 200 hi fish 1
// expect: [ 100 ]
// Arrow consts exported from one file are called and passed in another.
import { scale, greet, count } from "./util.fsh";
async function main() {
  const g = await greet("fish");
  console.log(scale(2), g, count(["a"]));
  console.log([1].map(scale));
}
