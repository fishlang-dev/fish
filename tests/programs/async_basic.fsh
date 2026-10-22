async function double(n: i64): Promise<i64> {
  console.log("doubling", n);
  await yieldNow();
  return n * 2;
}

async function name(prefix: string): Promise<string> {
  await yieldNow();
  const made = prefix + "-named";
  await yieldNow();
  return made;
}

async function greet(who: string) {
  const d = await double(21);
  console.log(who, d);
}

async function sum(n: i64): Promise<i64> {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = await double(i);
    total += d;
  }
  return total;
}

async function main() {
  console.log("start");
  await greet("hi" + 1);
  const p = double(4);
  console.log("made but not run");
  let x = 0;
  x = await p;
  console.log(x);
  const total = await sum(3);
  console.log(total);
  const n = await name("x" + 1);
  console.log(n);
  await yieldNow();
  console.log("end");
}
// expect: start
// expect: doubling 21
// expect: hi1 42
// expect: made but not run
// expect: doubling 4
// expect: 8
// expect: doubling 0
// expect: doubling 1
// expect: doubling 2
// expect: 6
// expect: x1-named
// expect: end
