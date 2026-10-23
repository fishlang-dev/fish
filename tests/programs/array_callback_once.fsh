// error: 'map' calls its callback once per element, but this closure moves 'owned' out, so it can run only once
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function take(p: P): string { return p.name; }
function main() {
  const owned = new P(4, "own" + 1);
  const xs = [1, 2, 3];
  const r = xs.map((x) => take(owned));
  console.log(r.join());
}
