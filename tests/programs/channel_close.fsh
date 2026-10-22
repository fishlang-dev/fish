// expect: 30 true
async function produce(ch: Channel<i64>): Promise<i64> {
  for (let i = 1; i <= 30; i++) await ch.send(i);
  ch.close();
  return 0;
}

async function drain(ch: Channel<i64>): Promise<i64> {
  let count = 0;
  while (true) {
    const v = await ch.receive();
    if (v === null) break;
    count++;
  }
  return count;
}

async function main() {
  const ch = new Channel<i64>(3);
  const p = spawn(produce(ch.clone()));
  let consumers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 3; n++) consumers.push(spawn(drain(ch.clone())));
  let total = 0;
  for (let n = 0; n < 3; n++) {
    const c = consumers.pop()!;
    const got = await c;
    total += got;
  }
  await p;
  const after = await ch.receive();
  console.log(total, after === null);
}
