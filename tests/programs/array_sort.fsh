// expect: -5 1 9 10 100
// expect: -1.25 0.5 2.5
// expect: B a ab b1
// expect: 100 10 9 1 -5
// expect: ywxz
// expect: true 100000
// expect: 1,3,200
// sort with its default order for numbers and strings, and with comparators over numbers,
// instances (keeping equal elements in order) and unsigned bytes, on a large array too.
class P { n: i64; tag: string; constructor(n: i64, tag: string) { this.n = n; this.tag = tag; } }
function main() {
  let xs = [10, 9, 1, -5, 100];
  xs.sort();
  console.log(xs.join(" "));
  let fs = [2.5, -1.25, 0.5];
  fs.sort();
  console.log(fs.join(" "));
  let words = ["b" + 1, "a", "B", "ab"];
  words.sort();
  console.log(words.join(" "));
  xs.sort((a, b) => b - a);
  console.log(xs.join(" "));
  let ps = [new P(2, "x"), new P(1, "y"), new P(2, "z"), new P(1, "w")];
  ps.sort((a, b) => a.n - b.n);
  console.log(ps.map((p) => p.tag).join(""));
  let big: i64[] = [];
  for (let i = 0; i < 100000; i++) big.push((i * 7919) % 100003);
  big.sort();
  let ok = true;
  for (let i = 1; i < big.length; i++) if (big[i - 1] > big[i]) ok = false;
  console.log(ok, big.length);
  let us: u8[] = [3, 200, 1];
  us.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  console.log(us.join(","));
}
