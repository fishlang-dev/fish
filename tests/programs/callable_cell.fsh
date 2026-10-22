// error: may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock
function main() {
  const c = new Cell(1);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => n + c.get());
}
