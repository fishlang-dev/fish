// expect: xa yb
async function slow(s: string): Promise<string> {
  await sleep(1);
  return s + "a";
}

async function inner(s: string): Promise<string> {
  await yieldNow();
  return s + "b";
}

async function main() {
  let arr: Promise<string>[] = [slow("x" + ""), inner("y" + "")];
  const b = arr.pop()!;
  const a = arr.pop()!;
  const x = await a;
  const y = await b;
  console.log(x, y);
}
