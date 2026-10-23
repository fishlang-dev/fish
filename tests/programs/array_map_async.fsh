// error: 'map' with a callback giving a Promise isn't supported yet
async function tick(n: i64): Promise<i64> { return n; }
async function main() {
  const xs = [1, 2];
  const ps = xs.map(async (x) => x + 1);
  console.log(ps.length);
}
