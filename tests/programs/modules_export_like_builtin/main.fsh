// expect: napped
// expect: 3
import { nap } from "./b";
export function sleep(n: i64): i64 { return n; }
async function main() { await nap(); console.log(sleep(3)); }
