// error: can't clone a JoinHandle, or a value holding one
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

function dup<T>(x: Ref<T>): T {
  return x.clone();
}

async function main() {
  const h = spawn(one());
  const g = dup(h);
  const a = await h;
  const b = await g;
  console.log(a, b);
}
