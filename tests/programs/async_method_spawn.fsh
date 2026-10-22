// expect: 9
class Job {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
  async run(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.n * 3;
  }
}

async function main() {
  const j = new Job(3);
  const h = spawn(j.run());
  const n = await h;
  console.log(n);
}
