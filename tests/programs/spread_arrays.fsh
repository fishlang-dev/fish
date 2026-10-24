// expect: 1,2,3,1,2 2
// expect: 1 9 3
// expect: m1,m2,x a|€|b g1,g2
// expect: 3,1 2 k,j
// expect: 3 3
// expect: only
// Spreads of arrays (cloned, or taken over when made for the spread), strings, generators,
// Maps and Sets, typed by their elements or by the array they go into.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<string> { yield "g" + 1; yield "g2"; }
function make(): string[] { return ["m" + 1, "m2"]; }
function main() {
  const a = [1, 2];
  const b = [...a, 3, ...a];
  console.log(b.join(), a.length);
  let ps = [new P(1), new P(2)];
  let qs = [...ps, new P(3)];
  qs[0].n = 9;
  console.log(ps[0].n, qs[0].n, qs.length);
  console.log([...make(), "x"].join(), [..."a€b"].join("|"), [...gen()].join());
  const m = new Map([["k", 1], ["j", 2]]);
  const s = new Set([3, 1, 3]);
  console.log([...s].join(), [...m].length, [...m.keys()].join());
  const bytes: u8[] = [1, 2];
  const more = [...bytes, 3];
  const ns: (i64 | null)[] = [...a, null];
  console.log(more.length, ns.length);
  const empty: string[] = [];
  console.log([...empty, "only"].join());
}
