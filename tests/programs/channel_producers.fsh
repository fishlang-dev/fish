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
