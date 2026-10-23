// expect: true -1 true 2 false true
// includes finds NaN as JavaScript's SameValueZero does, and indexOf never does; includes takes
// a position to start from.
function main() {
  const nan = 0.0 / 0.0;
  const fs = [1.0, nan, -0.0];
  console.log(fs.includes(nan), fs.indexOf(nan), fs.includes(0.0), fs.indexOf(0.0), fs.includes(1.0, 1), fs.includes(nan, -2));
}
