// expect: aborted
// expect: main got 1
// expect: second got 2
async function aborter(c: AbortController): Promise<i64> {
  await sleep(10);
  c.abort();
  return 0;
}
async function second(ch: Channel<i64>): Promise<i64> {
  await sleep(150);
  const v = await ch.receive();
  return v!;
}
async function sender(ch: Channel<i64>): Promise<i64> {
  await sleep(200);
  await ch.send(1);
  await ch.send(2);
  return 0;
}
async function main() {
  const c = new AbortController();
  const s = c.signal;
  const a = spawn(aborter(c));
  try {
    await sleep(100, s);
  } catch (e) {
    console.log("aborted");
  }
  await a;
  const ch = new Channel<i64>(2);
  const w = spawn(second(ch.clone()));
  const t = spawn(sender(ch.clone()));
  const v = await ch.receive();
  console.log("main got", v!);
  const r = await w;
  console.log("second got", r);
  await t;
}
