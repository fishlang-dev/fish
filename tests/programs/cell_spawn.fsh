// error: it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead
async function count(c: Cell<i64>): Promise<i64> {
  return c.get();
}

async function main() {
  const h = spawn(count(new Cell(1)));
  console.log(await h);
}
