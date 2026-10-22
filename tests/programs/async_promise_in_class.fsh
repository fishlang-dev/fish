class Wrap<T> { v: T; constructor(v: T) { this.v = v; } }
async function word(s: string): Promise<string> { await yieldNow(); return s + "!"; }
async function main() {
  const w = new Wrap(word("a" + 1));
  const x = await w.v;
  console.log(x);
  const w2 = new Wrap(word("never" + 1));
}
// expect: a1!
