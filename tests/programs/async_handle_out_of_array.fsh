// error: can't be moved out of its array; use 'pop()'
async function one(n: i64): Promise<string> { await yieldNow(); return "v" + n; }
async function main() {
  const hs = [spawn(one(1))];
  const a = await hs[0];
}
