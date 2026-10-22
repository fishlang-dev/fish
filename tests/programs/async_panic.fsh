async function pick(xs: string[], at: usize): Promise<string> {
  const note = "picked " + xs.length;
  await yieldNow();
  return note + xs[at];
}

async function outer(): Promise<string> {
  const held = "outer" + 1;
  await yieldNow();
  const a = await pick(["a" + 1], 0);
  console.log(a, held);
  const b = await pick(["b" + 2], 4);
  return b;
}

async function main() {
  const top = "main" + 1;
  const r = await outer();
  console.log(r, top);
}
// expect: picked 1a1 outer1
// panic: index out of bounds
