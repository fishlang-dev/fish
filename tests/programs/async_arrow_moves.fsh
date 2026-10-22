// error: can't be used here because 'items' was moved
async function main() {
  const items = [1, 2, 3];
  const h = spawn(async () => {
    await yieldNow();
    return items.length;
  });
  console.log(items.length);
  const n = await h;
}
