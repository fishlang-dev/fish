async function word(s: string): Promise<string> { await yieldNow(); return s + "!"; }
async function num(): Promise<i64> { await yieldNow(); return 7; }
async function twice(p: Promise<string>, q: Promise<string>): Promise<string> {
  const a = await p;
  const b = await q;
  return a + b;
}
async function main() {
  const r = await twice(word("a" + 1), word("b" + 1));
  console.log(r);
  const unused = twice(word("c" + 1), word("d" + 1));
}
// expect: a1!b1!
