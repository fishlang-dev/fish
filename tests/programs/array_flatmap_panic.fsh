// panic: attempt to divide by zero
// A panicking flatMap callback drops what has been gathered.
function main() {
  const xs = ["a" + 1, "b" + 2, "c" + 3];
  const cap = "cap" + 1;
  const ys = xs.flatMap((x) => { const z = 10 / (x === "c3" ? 0 : 1); return [x + cap, x]; });
  console.log(ys.length);
}
