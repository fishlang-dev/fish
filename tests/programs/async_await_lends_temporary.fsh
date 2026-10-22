async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0] + "!";
}

async function main() {
  const x = await first(["a" + 1, "b" + 2]);
  console.log(x);
}
// error: the awaited Promise would keep borrowing this temporary
