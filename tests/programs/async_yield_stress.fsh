async function spin(n: i64, label: string): Promise<i64> {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const s = label + i;
    await yieldNow();
    total += s.length as i64;
  }
  return total;
}

async function main() {
  let sum = 0;
  for (let round = 0; round < 50; round++) {
    const got = await spin(200, "x" + round);
    sum += got;
  }
  console.log(sum);
}
// expect: 52500
