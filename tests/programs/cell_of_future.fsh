// expect: 12
async function job(n: i64): Promise<i64> {
  return n * 2;
}

async function main() {
  const c = new Cell(job(4));
  const f = c.replace(job(6));
  const v = await f;
  console.log(v + 4);
}
