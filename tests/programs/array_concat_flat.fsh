// expect: 3 0 0 -1 -1 4 4
// expect: a1,b,c3,z9 2 1 a1,b
// expect: 3 10 1 3
// expect: 1,2,3 3
// expect: a1-b2-c
// lastIndexOf searching back from a position, concat and flat giving clones while the arrays
// they read stay usable.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function more(): string[] { return ["z" + 9]; }
function main() {
  const xs = [1, 2, 3, 2, 1];
  console.log(xs.lastIndexOf(2), xs.lastIndexOf(1, 3), xs.lastIndexOf(1, -2), xs.lastIndexOf(9), xs.lastIndexOf(3, -9), xs.lastIndexOf(1, 99), xs.lastIndexOf(1, -1));
  const a = ["a" + 1, "b"];
  const b = ["c" + 3];
  const c = a.concat(b, more(), []);
  console.log(c.join(), a.length, b.length, a.concat().join());
  let ps = [new P(1)];
  const qs = [new P(2), new P(3)];
  let all = ps.concat(qs);
  all[0].n = 10;
  console.log(all.length, all[0].n, ps[0].n, qs[1].n);
  const grid: i64[][] = [[1, 2], [], [3]];
  console.log(grid.flat().join(), grid.length);
  const words = [["a" + 1], ["b" + 2, "c"]];
  console.log(words.flat().join("-"));
}
