// expect: 600 true
type Config = { label: string; point: { x: i64; y: i64 } };

async function writer(c: shared<Config>, n: i64): Promise<i64> {
  for (let i = 0; i < 50; i++) {
    c.update((s) => {
      s.label = "label" + n + "-" + i;
      s.point = { x: n, y: n };
    });
    await yieldNow();
  }
  return 0;
}

async function reader(c: shared<Config>): Promise<i64> {
  let good = 0;
  for (let i = 0; i < 50; i++) {
    const label = c.label;
    const point = c.point;
    if (label.startsWith("label") && point.x === point.y) good++;
    await yieldNow();
  }
  return good;
}

async function main() {
  const config = shared<Config>({ label: "label" + "", point: { x: 0, y: 0 } });
  let writers: JoinHandle<i64>[] = [];
  let readers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 12; n++) {
    writers.push(spawn(writer(config.clone(), n)));
    readers.push(spawn(reader(config.clone())));
  }
  let good = 0;
  for (let n = 0; n < 12; n++) {
    const w = writers.pop()!;
    await w;
    const r = readers.pop()!;
    const got = await r;
    good += got;
  }
  const label = config.label;
  console.log(good, label.startsWith("label"));
}
