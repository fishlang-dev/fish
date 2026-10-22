// error: can't clone a JoinHandle, or a value holding one: only one place can await a task's result
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

async function main() {
  const h = spawn(one());
  const h2 = h.clone();
  console.log(await h, await h2);
}
