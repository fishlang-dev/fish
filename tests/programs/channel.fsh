// case: channel_buffered_drop
// expect: sent
async function main() {
  const ch = new Channel<{ name: string; tags: string[] }>(4);
  await ch.send({ name: "a" + "", tags: ["x" + ""] });
  await ch.send({ name: "b" + "", tags: [] });
  const first = await ch.receive();
  await ch.send({ name: "c" + "", tags: ["y" + "", "z" + ""] });
  console.log("sent");
}
// case: channel_capacity
// panic: a channel's capacity must be at least 1
function main() {
  const n = 0;
  const ch = new Channel<i64>(n);
}
// case: channel_capacity_too_large
// panic: a channel's capacity is too large to allocate
async function main() {
  const ch = new Channel<string>(2305843009213693952);
  for (let i = 0; i < 1000; i++) await ch.send("value " + i);
}
// case: channel_close
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
// case: channel_needs_type
// error: 'Channel' needs the type it carries, as in 'new Channel<string>(8)'
function main() {
  const ch = new Channel(8);
}
// case: channel_of_cell
// error: a 'Channel' carries values to other tasks, so it can't carry a 'Cell<i64>', which changes without a lock
function main() {
  const ch = new Channel<Cell<i64>>(8);
}
// case: channel_of_interface
// error: a 'Channel' can't hold a 'Named' yet: name a concrete type
interface Named {
  name: string;
}

function main() {
  const ch = new Channel<Named>(1);
}
// case: channel_of_option
// error: a 'Channel' can't carry 'i64 | null': 'receive' gives null once the channel is closed
async function main() {
  const ch = new Channel<i64 | null>(4);
}
// case: channel_producers
// expect: 600 true 600
type Item = { from: i64; seq: i64; label: string };

async function produce(ch: Channel<Item>, n: i64, count: shared<{ sent: Atomic<i64> }>): Promise<i64> {
  for (let i = 0; i < 100; i++) {
    await ch.send({ from: n, seq: i, label: "p" + n + ":" + i });
    count.sent.add(1);
  }
  return n;
}

async function consume(ch: Channel<Item>, wanted: i64): Promise<i64> {
  let last = [-1, -1, -1, -1, -1, -1];
  let good = 0;
  for (let i = 0; i < wanted; i++) {
    const v = await ch.receive();
    if (v !== null) {
      const at = v.from as usize;
      if (v.seq > last[at] && v.label.startsWith("p")) good++;
      last[at] = v.seq;
    }
  }
  return good;
}

async function main() {
  const ch = new Channel<Item>(2);
  const count = shared({ sent: new Atomic(0) });
  let producers: JoinHandle<i64>[] = [];
  let consumers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 6; n++) producers.push(spawn(produce(ch.clone(), n, count.clone())));
  for (let n = 0; n < 4; n++) consumers.push(spawn(consume(ch.clone(), 150)));
  let good = 0;
  for (let n = 0; n < 4; n++) {
    const c = consumers.pop()!;
    const got = await c;
    good += got;
  }
  for (let n = 0; n < 6; n++) {
    const p = producers.pop()!;
    await p;
  }
  console.log(good, good === 600, count.sent.load());
}
// case: channel_send_closed
// panic: send on a closed channel
async function main() {
  const ch = new Channel<string>(2);
  ch.close();
  await ch.send("late" + "");
}
// case: channel_unawaited_send
// error: this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'
async function main() {
  const ch = new Channel<string>(1);
  ch.send("dropped" + "");
}
// case: channel_waiting_at_exit
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
