// expect: 0 a1
// expect: 1 b
// expect: 0 1
// expect: 1 2
// expect: 0,1,
// expect: a1
// expect: b
// expect: 0 a1
// expect: 2 2
// entries, keys and values iterate an array, in for...of with patterns and through next(),
// each element a clone.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const ws = ["a" + 1, "b"];
  for (const [i, w] of ws.entries()) console.log(i, w);
  let ps = [new P(1), new P(2)];
  for (const [i, p] of ps.entries()) console.log(i, p.n);
  let keys = "";
  for (const k of ps.keys()) keys += `${k},`;
  console.log(keys);
  for (const v of ws.values()) console.log(v);
  let it = ws.entries();
  const first = it.next();
  if (first.done === false) console.log(first.value[0], first.value[1]);
  console.log(ps.length, ws.length);
}
