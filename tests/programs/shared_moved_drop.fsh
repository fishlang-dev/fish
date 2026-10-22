// expect: 1
// expect: 2
function take(s: shared<{ n: i64 }>): i64 {
  return s.n;
}

async function hold(n: i64): Promise<i64> {
  const s = shared({ k: n });
  await yieldNow();
  return s.k;
}

async function main() {
  const s = shared({ n: 1 });
  console.log(take(s));
  const v = await hold(2);
  console.log(v);
}
