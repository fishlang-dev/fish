async function after(ms: i64, label: string): Promise<string> {
  await sleep(ms);
  console.log(label);
  return label + "!";
}

async function nap(ms: i64): Promise<i64> {
  await sleep(ms);
  return ms;
}

async function main() {
  const c = spawn(after(150, "third" + 3));
  const a = spawn(after(50, "first" + 1));
  const b = spawn(after(100, "second" + 2));
  const ra = await a;
  const rb = await b;
  const rc = await c;
  console.log(ra, rb, rc);
  let waits: JoinHandle<i64>[] = [];
  for (let i = 0; i < 3; i++) waits.push(spawn(nap(300)));
  let total = 0;
  while (waits.length > 0) {
    const h = waits.pop()!;
    const got = await h;
    total += got;
  }
  console.log(total);
  await sleep(0);
  console.log("done");
}
// expect: first1
// expect: second2
// expect: third3
// expect: first1! second2! third3!
// expect: 900
// expect: done
