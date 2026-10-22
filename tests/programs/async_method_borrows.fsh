// error: cannot change 's.count' while 'f' borrows 's'
class Store {
  count: i64 = 3;
  async load(this: Ref<this>): Promise<i64> {
    await yieldNow();
    return this.count;
  }
}

async function main() {
  let s = new Store();
  const f = s.load();
  s.count = 5;
  const n = await f;
}
