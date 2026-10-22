async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0] + "!";
}
async function main() {
  const p = first(["a" + 1, "b" + 2]);
  const x = await p;
  console.log(x);
}
// error: 'p' would keep borrowing this temporary
