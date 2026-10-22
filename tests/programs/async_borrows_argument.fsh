async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0];
}

async function main() {
  let arr = ["a" + 1];
  const f = first(arr);
  arr.push("b");
  const x = await f;
  console.log(x);
}
// error: cannot change 'arr' while 'f' borrows 'arr' and is used later
