class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

async function work(n: i64): Promise<i64> {
  let total = 0;
  for (let i = 0; i <= n; i++) {
    total += i;
    if (i % 50 === 0) await yieldNow();
  }
  return total;
}

async function label(n: i64): Promise<string> {
  await yieldNow();
  return "task" + n;
}

async function forever(name: string) {
  const held = name + "!";
  for (let i = 0; i < 1000000000000; i++) await yieldNow();
  console.log(held);
}

async function fails(n: i64): Promise<i64> throws Oops {
  await yieldNow();
  if (n > 2) throw new Oops("failed " + n);
  return n;
}

async function main() throws Oops {
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 300; i++) handles.push(spawn(work(i)));
  let sum = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const v = await h;
    sum += v;
  }
  console.log(sum);
  const names = spawn(label(7));
  const n = await names;
  console.log(n);
  spawn(forever("detached" + 1));
  const ok = await spawn(fails(1));
  console.log(ok);
  try {
    const bad = await spawn(fails(5));
    console.log(bad);
  } catch (e) {
    console.log("caught", e.why);
  }
}
// expect: 4499950
// expect: task7
// expect: 1
// expect: caught failed 5
