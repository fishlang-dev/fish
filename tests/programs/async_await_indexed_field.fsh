type P = { s: string, inner: { t: string } };
async function two(): Promise<string> { await yieldNow(); return "two" + 2; }
async function main() {
  let ps: P[] = [{ s: "a" + 1, inner: { t: "b" + 1 } }];
  let i: usize = 0;
  ps[i].s = await two();
  console.log(ps[0].s);
}
// error: 'await' can only be assigned with '=' to a variable or a field for now
