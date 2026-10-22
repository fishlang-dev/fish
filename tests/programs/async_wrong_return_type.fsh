async function one(): i64 {
  return 1;
}

async function main() {
  await one();
}
// error: an async function's return type is 'Promise<T>', the type of what it gives once awaited
