// expect: 3200 64
interface Handler {
  handle(n: i64): i64;
}

class Double {
  handle(n: i64): i64 {
    return n * 2;
  }
}

class Tagged {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  handle(n: i64): i64 {
    return n + (this.tag.length as i64);
  }
}

async function run(hs: Dyn<Handler>[], n: i64): Promise<i64> {
  let total = 0;
  for (const h of hs) {
    total += h.handle(n);
    await yieldNow();
  }
  return total;
}

async function main() {
  let tasks: JoinHandle<i64>[] = [];
  for (let n = 0; n < 64; n++) {
    let hs: Dyn<Handler>[] = [new Double(), new Tagged("ab" + "")];
    tasks.push(spawn(run(hs, 16)));
  }
  let sum = 0;
  let count = 0;
  for (let n = 0; n < 64; n++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
}
