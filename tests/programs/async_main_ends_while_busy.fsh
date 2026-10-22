// expect: main done
async function spin(): Promise<i64> {
  let total = 0;
  for (let i = 0; i < 4000000000000; i++) total += i % 7;
  return total;
}
async function main() {
  const s = spawn(spin());
  await sleep(50);
  console.log("main done");
}
