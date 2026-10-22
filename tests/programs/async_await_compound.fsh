async function two(): Promise<i64> { await yieldNow(); return 2; }
async function main() {
  let x = 1;
  x += await two();
  console.log(x);
}
// error: 'await' can only be assigned with '=' to a variable or a field for now
