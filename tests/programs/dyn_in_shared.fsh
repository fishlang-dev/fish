// expect: 800 800
interface Counter { bump(): i64; get(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
  get(): i64 { return this.n.load(); }
}
class Plain {
  hits: Hits = new Hits();
}
async function work(st: shared<{ h: Dyn<Counter>; p: Plain }>): Promise<i64> {
  for (let i = 0; i < 100; i++) { st.h.bump(); st.p.hits.bump(); await yieldNow(); }
  return 0;
}
async function main() {
  const d: Dyn<Counter> = new Hits();
  const st = shared({ h: d, p: new Plain() });
  let ts: JoinHandle<i64>[] = [];
  for (let k = 0; k < 8; k++) ts.push(spawn(work(st.clone())));
  while (ts.length > 0) { const t = ts.pop()!; await t; }
  console.log(st.h.get(), st.p.hits.get());
}
