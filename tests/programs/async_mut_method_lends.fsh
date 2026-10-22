// error: cannot use 'c' while 'a' borrows 'c' mutably
class C {
  xs: string[];
  constructor() { this.xs = ["a" + ""]; }
  async bump(this: Mut<this>): Promise<i64> {
    await yieldNow();
    for (let i = 0; i < 100; i++) this.xs.push("b" + "");
    return this.xs.length as i64;
  }
  first(): Ref<string> { return this.xs[0]; }
}
async function main() {
  let c = new C();
  const a = c.bump();
  const r = c.first();
  const x = await a;
  console.log(x, r);
}
