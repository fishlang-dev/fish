function* pick(xs: string[], at: usize[]): Generator<string> {
  const note = "picked " + xs.length;
  for (const i of at) {
    yield note + " " + xs[i];
  }
}

function main() {
  const outer = "outer" + 1;
  let g = pick(["a" + 1, "b" + 2], [0, 5]);
  const first = g.next();
  if (first.done === false) console.log(first.value, outer);
  for (const s of pick(["c" + 3], [0, 9])) console.log(s);
}
// expect: picked 2 a1 outer1
// expect: picked 1 c3
// panic: index out of bounds
