async function pick(xs: string[], at: usize): Promise<string> {
  const note = "picking " + at;
  await sleep(20);
  return note + xs[at];
}

async function slow(): Promise<string> {
  const held = "slow" + 1;
  await sleep(10000);
  return held;
}

async function main() {
  const background = spawn(slow());
  const ok = await spawn(pick(["a" + 1], 0));
  console.log(ok);
  const bad = await spawn(pick(["b" + 2], 3));
  console.log(bad);
}
// expect: picking 0a1
// panic: index out of bounds
