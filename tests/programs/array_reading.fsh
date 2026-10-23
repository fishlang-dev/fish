// expect: true false 1 3 -1 -1 2 -1
// expect: 1,2,3,2 1 - 2 - 3 - 2 true|false 1.5;2.25
// expect: a1b2c true 2
// expect: []
// expect: 2,3 3,2 1,2,3,2 0 1,2,3,2
// expect: 2 50 2
// includes, indexOf, join and slice as JavaScript gives them, positions counted from the end
// and clamped, with slices of instances as clones.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const xs = [1, 2, 3, 2];
  console.log(xs.includes(2), xs.includes(5), xs.indexOf(2), xs.indexOf(2, 2), xs.indexOf(9), xs.indexOf(1, -2), xs.indexOf(3, -9), xs.indexOf(1, 99));
  console.log(xs.join(), xs.join(" - "), [true, false].join("|"), [1.5, 2.25].join(";"));
  const words = ["a" + 1, "b" + 2, "c"];
  console.log(words.join(""), words.includes("b2"), words.indexOf("c"));
  const empty: string[] = [];
  console.log(`[${empty.join(",")}]`);
  const s1 = xs.slice(1, 3);
  const s2 = xs.slice(-2);
  const s3 = xs.slice();
  const s4 = xs.slice(3, 1);
  const s5 = xs.slice(-99, 99);
  console.log(s1.join(), s2.join(), s3.join(), s4.length, s5.join());
  let ps = [new P(1), new P(2), new P(3)];
  let some = ps.slice(1);
  some[0].n = 50;
  console.log(some.length, some[0].n, ps[1].n);
}
