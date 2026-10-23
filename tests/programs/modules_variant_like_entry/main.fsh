// expect: ok 1 7
import { show, Res } from "./b";
function Ok(): i64 { return 7; }
function main() { console.log(show(Res.Ok(1)), Ok()); }
