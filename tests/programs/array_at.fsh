// expect: 5 7 7 null 5 null
// expect: null null
// expect: 99 2
// expect: a1
// at counts back from the end for a negative position, gives nothing outside the array, and a
// clone of an instance element.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const ns = [5, 6, 7];
  console.log(ns.at(0), ns.at(-1), ns.at(2), ns.at(3), ns.at(-3), ns.at(-4));
  const empty: i64[] = [];
  console.log(empty.at(0), empty.at(-1));
  let ps = [new P(1), new P(2)];
  const last = ps.at(-1);
  if (last !== null) {
    let mine = last;
    mine.n = 99;
    console.log(mine.n, ps[1].n);
  }
  const ws = ["a" + 1, "b"];
  const w = ws.at(-2);
  if (w !== null) console.log(w);
  ws.at(0);
}
