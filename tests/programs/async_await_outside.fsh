async function one(): Promise<i64> {
  return 1;
}

function main() {
  const x = await one();
}
// error: 'await' can only be used inside an 'async' function
