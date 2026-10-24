// expect: 2 7
// A generic function taking a Generator<T> infers T from what the generator yields.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function collect<T>(g: Generator<T>): T[] {
  let out: T[] = [];
  for (const x of g) out.push(x);
  return out;
}
function* gen(): Generator<P> { yield new P(1); yield new P(7); }
function main() {
  const ps = collect(gen());
  console.log(ps.length, ps[1].n);
}
