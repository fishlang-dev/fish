// expect: 0 p1
// expect: 1 p2
// Iterating an array reached through a reference.
class P { s: string; constructor(n: i64) { this.s = "p" + n; } }
function iter(xs: Ref<P[]>): Generator<[i64, P]> { return xs.entries(); }
function main() {
  const ps = [new P(1), new P(2)];
  for (const [i, p] of iter(ps)) console.log(i, p.s);
}
