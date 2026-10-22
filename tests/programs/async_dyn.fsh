// expect: 3328 64
// expect: 12 20
type Request = { path: string; n: i64 };

interface Handler {
  handle(req: Request): Promise<i64>;
}

class Doubler {
  async handle(req: Request): Promise<i64> {
    await yieldNow();
    return req.n * 2;
  }
}

class Tagger {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  async handle(req: Request): Promise<i64> {
    await sleep(1);
    return req.n + (this.tag.length as i64) + (req.path.length as i64);
  }
}

async function serve(hs: Dyn<Handler>[], n: i64): Promise<i64> {
  let total = 0;
  for (const h of hs) {
    const got = await h.handle({ path: "/x" + "", n: n });
    total += got;
  }
  return total;
}

async function main() {
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 64; k++) {
    let hs: Dyn<Handler>[] = [new Doubler(), new Tagger("ab" + "")];
    tasks.push(spawn(serve(hs, 16)));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 64; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
  const scale = 2;
  const ops: ((n: i64) => Promise<i64>)[] = [async (n) => n * scale, async (n) => {
    await yieldNow();
    return n + 10;
  }];
  const a = await ops[0](6);
  const b = await ops[1](10);
  console.log(a, b);
}
