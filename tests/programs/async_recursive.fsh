async function count(n: i64): Promise<i64> {
  if (n === 0) return 0;
  const rest = await count(n - 1);
  return rest + 1;
}

async function main() {
  await count(3);
}
// error: an async function can't await another of itself
