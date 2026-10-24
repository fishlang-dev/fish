// expect: 1,2,3 1 0
// expect: 0,0,0 n1,n1 0
// expect: 9 1
// expect: a|€|😀 a0,b1
// expect: 2 10,20
// expect: 0,1,4,9 2,3
// Array.of, new Array(n).fill(x), and Array.from over arrays (clones), strings, generators and
// { length }, with and without a map function.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<P> { yield new P(1); yield new P(2); }
function main() {
  console.log(Array.of(1, 2, 3).join(), Array.of("a" + 1).length, Array.of<string>().length);
  const zeros = new Array(3).fill(0);
  const names = new Array<string>(2).fill("n" + 1);
  console.log(zeros.join(), names.join(), new Array(0).fill(5).length);
  let ps = [new P(1), new P(2)];
  let copy = Array.from(ps);
  copy[0].n = 9;
  console.log(copy[0].n, ps[0].n);
  console.log(Array.from("a€😀").join("|"), Array.from("ab", (c, i) => c + i).join());
  console.log(Array.from(gen()).length, Array.from(gen(), (p) => p.n * 10).join());
  console.log(Array.from({ length: 4 }, (_, i) => i * i).join(), Array.from([1, 2], (x) => x + 1).join());
}
