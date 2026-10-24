// expect: 0 50 102 50
// expect: 7 0,1,2,3,4,5,6 999
// expect: a1,b
// Maps owning instances and arrays: replaced, deleted and cleared values are dropped, a clone is
// deep, and the table grows and compacts without losing order.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let ps = new Map<i64, P>();
  for (let i = 0; i < 100; i++) ps.set(i, new P(i * 2));
  for (let i = 0; i < 100; i += 2) ps.delete(i);
  const copy = ps.clone();
  ps.clear();
  const got = copy.get(51);
  console.log(ps.size, copy.size, got === null ? -1 : got.n, copy.keys().length);
  for (let i = 0; i < 1000; i++) ps.set(i % 7, new P(i));
  const last = ps.get(5);
  console.log(ps.size, ps.keys().join(), last === null ? -1 : last.n);
  let lists = new Map<i64, string[]>();
  lists.set(1, ["a" + 1]);
  lists.update(1, (v) => { v.push("b"); });
  const v = lists.get(1);
  console.log(v === null ? "" : v.join());
}
