// expect: 5
// expect: 5
// A borrowed let part may be pointed elsewhere, as a let loop variable may.
class Box { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const other = new Box(5);
  let bs: Box[] = [new Box(7)];
  for (let b of bs) { b = other; console.log(b.n); }
  let ps: [Box, string][] = [[new Box(7), "s" + ""]];
  for (let [b, s] of ps) { b = other; console.log(b.n); }
}
