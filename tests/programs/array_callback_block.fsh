// expect: 1 20 3 3
// A block-bodied callback may return early and change what it captures.
function main() {
  let count = 0;
  const xs = [1, 2, 3];
  const ys = xs.map((x) => { count += 1; if (x === 2) { return 20; } return x; });
  console.log(ys[0], ys[1], ys[2], count);
}
