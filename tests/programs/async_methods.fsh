// expect: 3 alpha
// expect: 10
// expect: 10
class Store {
  name: string;
  count: i64;
  constructor(name: string) {
    this.name = name;
    this.count = 3;
  }
  async load(this: Ref<this>, extra: i64): Promise<i64> {
    await yieldNow();
    return this.count + extra;
  }
  async label(): Promise<string> {
    await sleep(1);
    return this.name;
  }
  async consume(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.count + (this.name.length as i64) + 2;
  }
}

interface Loader {
  load(extra: i64): Promise<i64>;
}

async function viaBound(l: Ref<Loader>): Promise<i64> {
  const n = await l.load(7);
  return n;
}

async function main() {
  const s = new Store("alpha" + "");
  const a = await s.load(0);
  const b = await s.label();
  console.log(a, b);
  const c = await s.consume();
  console.log(c);
  const t = new Store("x" + "");
  const d = await viaBound(t);
  console.log(d);
}
