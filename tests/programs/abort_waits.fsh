// expect: sleep aborted
// expect: acquire aborted
// expect: receive aborted
// expect: send aborted
// expect: done 7 5
async function sleeper(signal: AbortSignal): Promise<string> throws AbortError {
  await sleep(100000, signal);
  return "slept";
}

async function acquirer(sem: shared<{ gate: Semaphore }>, signal: AbortSignal): Promise<string> throws AbortError {
  const permit = await sem.gate.acquire(signal);
  return "acquired";
}

async function receiver(ch: Channel<string>, signal: AbortSignal): Promise<string> throws AbortError {
  const v = await ch.receive(signal);
  return "received";
}

async function sender(ch: Channel<string>, signal: AbortSignal): Promise<string> throws AbortError {
  await ch.send("one" + "", signal);
  await ch.send("two" + "", signal);
  return "sent";
}

async function main(): Promise<void> throws AbortError {
  const c = new AbortController();
  const gate = shared({ gate: new Semaphore(1) });
  const held = await gate.gate.acquire();
  const empty = new Channel<string>(1);
  const full = new Channel<string>(1);
  const a = spawn(sleeper(c.signal));
  const b = spawn(acquirer(gate.clone(), c.signal));
  const d = spawn(receiver(empty.clone(), c.signal));
  const f = spawn(sender(full.clone(), c.signal));
  await sleep(30);
  c.abort();
  try {
    const v = await a;
  } catch (e) {
    console.log("sleep aborted");
  }
  try {
    const v = await b;
  } catch (e) {
    console.log("acquire aborted");
  }
  try {
    const v = await d;
  } catch (e) {
    console.log("receive aborted");
  }
  try {
    const v = await f;
  } catch (e) {
    console.log("send aborted");
  }
  const other = new AbortController();
  await sleep(5, other.signal);
  const spare = new Semaphore(1);
  const p = await spare.acquire(other.signal);
  const got = await full.receive(other.signal);
  console.log("done", 7, got!.length + 2);
}
