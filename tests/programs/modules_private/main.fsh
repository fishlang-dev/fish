// expect: main 1 a 2 b 3
// Each file's unexported names are its own: three files each declare 'helper' and 'Box', and
// each sees only its own.
import { fromA } from "./a";
import { fromB } from "./b";
class Box { n: i64; constructor(n: i64) { this.n = n; } }
function helper(): string { return "main"; }
function main() {
  const box = new Box(1);
  console.log(helper(), box.n, fromA(), fromB());
}
