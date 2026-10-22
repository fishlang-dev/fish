// expect: 6 6
// expect: 1344 32
async function run(fs: ((n: i64) => i64)[], n: i64): Promise<i64> {
  let total = 0;
  for (const f of fs) {
    total += f(n);
    await yieldNow();
  }
  return total;
}

function main2(): i64 {
  const word = "abc" + "";
  const f: (n: i64) => i64 = (n) => n + (word.length as i64);
  const g = f.clone();
  return g(3);
}

async function main() {
  const tag = "tag" + "";
  const f: (n: i64) => i64 = (n) => n + (tag.length as i64);
  const g = f.clone();
  console.log(f(3), main2());
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 32; k++) {
    let fs: ((n: i64) => i64)[] = [(n) => n * 2, (n) => n + (tag.length as i64)];
    tasks.push(spawn(run(fs, 13)));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 32; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum + g(0) - 3, count);
}
