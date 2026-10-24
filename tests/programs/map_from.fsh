// expect: 2 3 a,b1 2 x,y1 2
// expect: 1 v1
// expect: 2 1
// new Map(entries) and new Set(xs) take over an array's pairs or members, a later key replacing
// an earlier, with their types written, expected or taken from the array.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function f<T>(x: T): Map<string, T> { return new Map([["k", x]]); }
function main() {
  const m = new Map([["a", 1], ["b" + 1, 2], ["a", 3]]);
  const s = new Set(["x", "y" + 1, "x"]);
  const ps = new Map<string, P>([["p", new P(1)], ["p", new P(2)]]);
  const g = ps.get("p");
  console.log(m.size, m.get("a"), m.keys().join(), s.size, s.values().join(), g === null ? 0 : g.n);
  const k = f("v" + 1);
  console.log(k.size, k.get("k"));
  const ns: i64[] = [3, 1, 3];
  const unique = new Set(ns);
  const lists: Map<string, string[]> = new Map([["k", ["v" + 1]]]);
  console.log(unique.size, lists.size);
}
