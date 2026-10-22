// error: can't clone a JoinHandle, or a value holding one
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

async function waitOn(h: JoinHandle<string>): Promise<string> {
  return await h;
}

async function main() {
  const f = waitOn(spawn(one()));
  const g = f.clone();
  console.log(await f, await g);
}
