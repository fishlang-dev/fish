// expect: 1 2,3,4,5
// expect: 9,8,2,3,4,5
// expect: 8,2 9,70,71,72,3,4,5
// expect: 4,5 9,70,71,72,3
// expect: 0 9,0,70,71,72,3 0 9,0,70,71,72,3 0
// expect: null 0
// expect: c3,b2,a1
// expect: c3,z0,z0
// expect: c3,z0,q1
// expect: c3 new1,mid2,q1
// expect: 2 2 5 6 2
// expect: 3,2,1 mid2,q1
// shift, unshift, splice, reverse and fill change the array as JavaScript does; elements moved
// out or replaced are dropped once, and fill stores a copy in each slot.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [1, 2, 3, 4, 5];
  const first = xs.shift();
  console.log(first, xs.join());
  xs.unshift(9, 8);
  console.log(xs.join());
  const gone = xs.splice(1, 2, 70, 71, 72);
  console.log(gone.join(), xs.join());
  console.log(xs.splice(-2).join(), xs.join());
  console.log(xs.splice(1, -5, 0).length, xs.join(), xs.splice(99, 1).length, xs.splice(0, 99).join(), xs.length);
  let empty: i64[] = [];
  console.log(empty.shift(), empty.length);
  let ws = ["a" + 1, "b" + 2, "c" + 3];
  ws.reverse();
  console.log(ws.join());
  ws.fill("z" + 0, 1);
  console.log(ws.join());
  ws.fill("q" + 1, -1, 99);
  ws.fill("never" + 1, 2, 1);
  console.log(ws.join());
  const s = ws.shift();
  ws.unshift("new" + 1);
  ws.splice(1, 1, "mid" + 2);
  console.log(s, ws.join());
  let ps = [new P(1), new P(2), new P(3)];
  const out = ps.splice(0, 2, new P(9));
  ps.reverse();
  ps.fill(new P(5), 0, 1);
  ps[1].n = 6;
  console.log(out.length, out[1].n, ps[0].n, ps[1].n, ps.length);
  let odd = [1, 2, 3];
  odd.reverse();
  ws.splice(0, 1);
  console.log(odd.join(), ws.join());
}
