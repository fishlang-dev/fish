// expect: 0 0
// expect: 100 100 100
// expect: true
// expect: 6 6 s5
// expect: 0
// expect: 3 4
// reserve makes room ahead of pushes, capacity reads it, and shrinkToFit gives the spare room back.
function main() {
  let xs: string[] = [];
  console.log(xs.capacity, xs.length);
  xs.reserve(100);
  const room = xs.capacity;
  for (let i = 0; i < 100; i++) xs.push("s" + i);
  console.log(room, xs.capacity, xs.length);
  xs.push("more");
  console.log(xs.capacity > 100);
  xs.reserve(0);
  for (let i = 0; i < 95; i++) xs.pop();
  xs.shrinkToFit();
  console.log(xs.capacity, xs.length, xs[5]);
  let ys = [1, 2];
  ys.pop();
  ys.pop();
  ys.shrinkToFit();
  console.log(ys.capacity);
  ys.push(3);
  console.log(ys[0], ys.capacity);
}
