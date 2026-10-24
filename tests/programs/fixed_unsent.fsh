// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead
async function work(a: FixedArray<Cell<i64>, 1>): Promise<i64> { await yieldNow(); return a[0].get(); }
async function main() {
  const a: FixedArray<Cell<i64>, 1> = [new Cell(1)];
  const h = spawn(work(a));
  const r = await h;
  console.log(r);
}
