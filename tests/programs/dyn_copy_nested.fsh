// expect: 1
// A Dyn whose interface changes it, holding another Dyn but nothing pinned, copies as values do.
interface Logger { log(s: string): i64; }
class L { log(s: string): i64 { return s.length as i64; } }
interface Stack { push(this: Mut<this>, x: i64): void; size(): i64; }
class S {
  items: i64[] = [];
  logger: Dyn<Logger>;
  constructor(l: Dyn<Logger>) { this.logger = l; }
  push(this: Mut<this>, x: i64) { this.items.push(x); }
  size(): i64 { return this.items.length as i64 + this.logger.log("") ; }
}
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const l: Dyn<Logger> = new L();
  let s: Dyn<Stack> = new S(l);
  s.push(1);
  const holder = { s: s };
  const f: Fn = async () => holder.s.size();
  const n = await f();
  console.log(n);
}
