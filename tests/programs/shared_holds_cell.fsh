// error: a 'shared' value is used from many threads at once, so it can't hold a 'Cell<i64>', which changes without a lock; use an 'Atomic' or a 'Lock' instead
function main() {
  const s = shared({ count: new Cell(0) });
}
