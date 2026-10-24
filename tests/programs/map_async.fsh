// expect: a x1
// expect: 1
// A Map held across an await and moved into a spawned task.
async function main() {
  let m = new Map([["a", "x" + 1]]);
  for (const [k, v] of m) {
    await sleep(1);
    console.log(k, v);
  }
  const h = spawn(async () => m.size);
  const n = await h;
  console.log(n);
}
