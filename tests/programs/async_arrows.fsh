// expect: 7 hello world
// expect: 128 64
async function main() {
  const base = 5;
  const greet = "hello" + "";
  const add = async (n: i64) => {
    await yieldNow();
    return n + base;
  };
  const say = async (who: string) => {
    await sleep(1);
    return greet + " " + who;
  };
  const a = await add(2);
  const b = await say("world" + "");
  console.log(a, b);
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 64; k++) {
    const twice = k * 0 + 2;
    tasks.push(spawn(async () => {
      await yieldNow();
      return twice;
    }));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 64; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
}
