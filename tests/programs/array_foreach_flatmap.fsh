// expect: 1 0
// expect: 2 1
// expect: 3 2
// expect: 6
// expect: 1,10,2,20,3,30
// expect: a1 a1! 0 b2 b2! 1
// expect: x1,x1x1,y2,y2y2 1 -1 2
// expect: 0
// forEach runs its callback for each element and drops what it gives; flatMap moves the arrays
// its callback gives into one; findIndex stops at the first hit.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const xs = [1, 2, 3];
  let total = 0;
  xs.forEach((x) => { total += x; });
  xs.forEach((x, i) => console.log(x, i));
  console.log(total);
  const pairs = xs.flatMap((x) => [x, x * 10]);
  console.log(pairs.join());
  const words = ["a" + 1, "b" + 2];
  console.log(words.flatMap((w, i) => [w, w + "!", String(i)]).join(" "));
  const ps = [new P(1, "x" + 1), new P(2, "y" + 2)];
  const names = ps.flatMap((p) => [p.name, p.name + p.name]);
  console.log(names.join(), ps.findIndex((p) => p.n === 2), ps.findIndex((p) => p.n === 9), xs.findIndex((x, i) => i === 2));
  const none = xs.flatMap((x) => { const e: i64[] = []; return e; });
  console.log(none.length);
  ps.forEach((p) => p.name + "?");
}
