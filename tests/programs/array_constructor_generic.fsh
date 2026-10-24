// expect: a1!,b2! a1,b2 2
// expect: 0 0 2 1
// expect: 0,0,0 0,1,2 0,1,2
// Array.from over a generator in generic code, Array.of with a written element type, and
// lengths given as a usize or by shorthand.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<string> { yield "a" + 1; yield "b" + 2; }
function all(g: Generator<string>): string[] { return Array.from(g, (s) => s + "!"); }
function allT<T>(g: Generator<T>): T[] { return Array.from(g); }
function main() {
  const g = gen();
  console.log(all(gen()).join(), allT(gen()).join(), allT<string>(g).length);
  const o = Array.of<i64 | null>(null, 1);
  const u = Array.of<u8>(1, 2);
  const w: u8 = u[0];
  console.log(Array.of<P>().length, Array.of<i64>().length, o.length, w);
  const xs = [1, 2, 3];
  const length = 3;
  console.log(new Array(xs.length).fill(0).join(), Array.from({ length: xs.length }, (_, i) => i).join(), Array.from({ length }, (_, i) => i).join());
}
