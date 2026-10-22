// error: a 'Channel' carries values to other tasks, so it can't carry a 'Cell<i64>', which changes without a lock
function main() {
  const ch = new Channel<Cell<i64>>(8);
}
