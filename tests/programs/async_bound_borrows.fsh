// error: cannot move 'l' while 'f' borrows 'l'
class Store {
  name: string;
  constructor(n: string) { this.name = n; }
  async load(extra: i64): Promise<string> {
    await yieldNow();
    return this.name + `${extra}`;
  }
}
interface Loader { load(extra: i64): Promise<string>; }
async function viaBound(l: Loader): Promise<string> {
  const f = l.load(7);
  const moved = l;
  const n = await f;
  return n;
}
async function main() {
  const d = await viaBound(new Store("abc" + ""));
  console.log(d);
}
