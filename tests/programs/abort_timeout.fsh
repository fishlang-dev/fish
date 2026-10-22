// expect: timed out
// expect: got hello
// expect: false
async function late(ch: Channel<string>): Promise<i64> {
  await sleep(5);
  await ch.send("hello" + "");
  return 0;
}

async function main() {
  const quiet = new Channel<string>(1);
  try {
    const v = await quiet.receive(AbortSignal.timeout(30));
    console.log("received", v!);
  } catch (e) {
    console.log("timed out");
  }
  const busy = new Channel<string>(1);
  const h = spawn(late(busy.clone()));
  try {
    const v = await busy.receive(AbortSignal.timeout(100000));
    console.log("got", v!);
  } catch (e) {
    console.log("timed out too");
  }
  await h;
  const pending = AbortSignal.timeout(100000);
  console.log(pending.aborted);
}
