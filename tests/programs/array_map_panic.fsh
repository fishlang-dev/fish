// panic: attempt to divide by zero
// A callback panicking part way drops what map has built and what it captured.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const ps = [new P(1, "a" + 1), new P(2, "b" + 2), new P(3, "c" + 3), new P(4, "d" + 4)];
  const names = ["a" + 1, "b" + 2, "c" + 3];
  const cap = "cap" + 1;
  const r = ps.map((p) => { const z = 10 / (p.n - 3); return p.name + "!"; }); console.log(r.length);
  console.log(cap);
}
