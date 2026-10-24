// error: 'find' gives clones of the array's elements, and can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself
async function main(): Promise<void> {
  let hs = [spawn(async () => "x" + 1)];
  const h = hs.find((x) => true);
  if (h !== null) { const a = await h; console.log(a); }
  const o = hs.pop();
  if (o !== null) { const b = await o; console.log(b); }
}
