// case: rwlock_read_await
// error: 'read' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const rw = new RwLock(0);
  rw.read((v) => {
    await yieldNow();
  });
}
// case: rwlock_update_await
// error: 'update' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const rw = new RwLock(0);
  rw.update((v) => {
    await yieldNow();
    v += 1;
  });
}
// case: rwlock_read_only
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function main() {
  const rw = new RwLock<i64[]>([]);
  rw.read((xs) => xs.push(1));
}
// case: rwlock_no_method
// error: 'RwLock' has no method 'write'; 'read' runs a callback with a read-only view of what it holds, and 'update' with a mutable one
function main() {
  const rw = new RwLock(0);
  rw.write((v) => 1);
}
