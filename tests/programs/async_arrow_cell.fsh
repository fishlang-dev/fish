// error: it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it
async function main() {
  const c = new Cell(1);
  const h = spawn(async () => c.get());
  const n = await h;
}
