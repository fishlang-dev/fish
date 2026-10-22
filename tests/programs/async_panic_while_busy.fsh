// panic: index out of bounds
async function spin(): Promise<i64> {
  let total = 0;
  for (let i = 0; i < 4000000000000; i++) total += i % 7;
  return total;
}
async function boom(xs: i64[]): Promise<i64> {
  await sleep(50);
  return xs[3];
}
async function main() {
  const s = spawn(spin());
  const v = await spawn(boom([1]));
  console.log(v);
}
