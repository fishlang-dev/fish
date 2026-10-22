async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0];
}

async function main() {
  const names = ["a" + 1];
  const h = spawn(first(names));
  const x = await h;
  console.log(x);
}
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Ref<string[]>', which borrows from this function
