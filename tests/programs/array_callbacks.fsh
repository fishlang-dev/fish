// expect: 2 8 4
// expect: 32
// expect: true true false
// expect: 2 4
// expect: 10 24
// expect: 3
// expect: a1! b2!
// expect: 99 2
// expect: 1
// expect: 3
// expect: y2? x1y2 true
// The callback methods over numbers, strings and instances: elements reach the callback as
// copies or shared borrows, filter and find give clones, and reduce starts from its initial
// value or the first element.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const xs = [1, 2, 3, 4];
  const doubled = xs.map((x) => x * 2);
  console.log(doubled[0], doubled[3], doubled.length);
  const withIndex = xs.map((x, i) => x * 10 + i);
  console.log(withIndex[2]);
  console.log(xs.some((x) => x > 3), xs.every((x) => x > 0), xs.every((x) => x > 1));
  const evens = xs.filter((x) => x % 2 === 0);
  console.log(evens.length, evens[1]);
  console.log(xs.reduce((a, x) => a + x, 0), xs.reduce((a, x) => a * x));
  const found = xs.find((x) => x > 2);
  if (found !== null) console.log(found);
  const ps = [new P(1, "a" + 1), new P(2, "b" + 2)];
  const names = ps.map((p) => p.name + "!");
  console.log(names[0], names[1]);
  let big = ps.filter((p) => p.n > 1);
  big[0].n = 99;
  console.log(big[0].n, ps[1].n);
  const hit = ps.find((p) => p.name === "a1");
  if (hit !== null) console.log(hit.n);
  const total = ps.reduce((a, p) => a + p.n, 0);
  console.log(total);
  const words = ["x" + 1, "y" + 2];
  console.log(words.map((w) => w + "?")[1], words.reduce((a, w) => a + w, ""), words.some((w) => w === "y2"));
}
