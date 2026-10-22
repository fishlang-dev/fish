// expect: 2
class C {
  tag: string;
  constructor(t: string) { this.tag = t; }
  async take(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.tag.length as i64;
  }
}
async function main() {
  const got = await new C("ab" + "").take();
  console.log(got);
}
