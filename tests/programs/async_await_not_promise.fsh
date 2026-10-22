async function main() {
  const x = 5;
  const y = await x;
}
// error: 'await' needs a Promise, like an async function's call, not 'i64'
