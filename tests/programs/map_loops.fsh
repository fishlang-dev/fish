// expect: a 1
// expect: c 3
// expect: b 4
// expect: a c b
// expect: 3 1 2
// expect: t 1
// expect: 3
// expect: p!
// expect: q!
// for...of over a Map's entries and a Set's members in insertion order, through a Ref, in a
// generator, and over a Map made for the loop.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(m: Ref<Map<string, i64>>): i64 {
  let t = 0;
  for (const [_, v] of m) t += v;
  return t;
}
function* marked(s: Ref<Set<string>>): Generator<string> {
  for (const x of s) yield x + "!";
}
function main() {
  let m = new Map<string, P>();
  m.set("a", new P(1));
  m.set("b", new P(2));
  m.set("c", new P(3));
  m.delete("b");
  m.set("b", new P(4));
  for (const [k, v] of m) console.log(k, v.n);
  let keys: string[] = [];
  for (const e of m) keys.push(e[0]);
  console.log(keys.join(" "));
  let order: i64[] = [];
  for (const x of new Set([3, 1, 2])) order.push(x);
  console.log(order.join(" "));
  for (const [k, v] of new Map([["t", 1]])) console.log(k, v);
  console.log(sum(new Map([["a", 1], ["b", 2]])));
  const s = new Set(["p", "q"]);
  for (const y of marked(s)) console.log(y);
}
