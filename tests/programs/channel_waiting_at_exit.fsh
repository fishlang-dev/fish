// expect: main done
async function stuck(ch: Channel<string>): Promise<i64> {
  const v = await ch.receive();
  return 1;
}

async function full(ch: Channel<string>): Promise<i64> {
  await ch.send("a" + "");
  await ch.send("b" + "");
  return 2;
}

async function main() {
  const empty = new Channel<string>(1);
  const busy = new Channel<string>(1);
  const a = spawn(stuck(empty.clone()));
  const b = spawn(full(busy.clone()));
  await sleep(30);
  console.log("main done");
}
