// expect: 1 2
import { withTwin } from "./macros.fsh";
@withTwin function one(): i64 { return 1; }
function main() {
  console.log(one(), twin());
}
