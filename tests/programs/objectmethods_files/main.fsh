// expect: 4
import { use } from "./a.fsh";
class B { constructor(public v: i64) {} get(): i64 { return this.v; } }
function main(): void { const d: Dyn<{ get(): i64 }> = new B(4); console.log(use(d)); }
