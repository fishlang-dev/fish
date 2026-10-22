// error: 'update' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const n = new Lock(0);
  n.update((v) => {
    await yieldNow();
    v += 1;
  });
}
