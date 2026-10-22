// expect: 2 hello 30
// expect: 6
async function two(): Promise<i64> {
  await yieldNow();
  return 2;
}

async function triple(n: i64): Promise<i64> {
  await sleep(1);
  return n * 3;
}

async function word(s: string): Promise<string> {
  await yieldNow();
  return s + "llo";
}

function later(n: i64): Promise<i64> {
  return triple(n);
}

class Job {
  run: Promise<i64>;
  constructor(run: Promise<i64>) {
    this.run = run;
  }
}

async function main() {
  let ps: Promise<i64>[] = [];
  ps.push(two());
  ps.push(later(10));
  ps.push(triple(2));
  const w: Promise<string> = word("he" + "");
  const unused: Promise<i64> = triple(5);
  const last = ps.pop()!;
  const mid = ps.pop()!;
  const first = ps.pop()!;
  const x = await first;
  const y = await w;
  const z = await mid;
  console.log(x, y, z);
  const job = new Job(last);
  const r = await job.run;
  console.log(r);
}
