// expect: 2 a,b
// A Map in a shared value, changed from another task through update.
class S { m: Map<string, i64> = new Map(); }
async function main() {
  const s = shared(new S());
  s.update((x) => { x.m.set("a", 1); });
  const c = s.clone();
  const t = spawn(async () => { c.update((x) => { x.m.set("b", 2); }); });
  await t;
  s.update((x) => { console.log(x.m.size, x.m.keys().join()); });
}
