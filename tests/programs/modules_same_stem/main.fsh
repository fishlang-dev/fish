// expect: 0 1 2
import { one } from "./x-y";
import { two } from "./x_y";
function helper(): i64 { return 0; }
function main() { console.log(helper(), one(), two()); }
