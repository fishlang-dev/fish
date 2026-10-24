// expect: 1 2 1
// expect: f
// expect: 3 4
// An index along a destructured path runs once, however many parts read through it.
type Pt = { x: i64; y: i64 };
function f(): usize { console.log("f"); return 1; }
function main() {
  const ps: Pt[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  let i: usize = 0;
  const { x, y } = ps[i++];
  console.log(x, y, i);
  const { x: a, y: b } = ps[f()];
  console.log(a, b);
}
