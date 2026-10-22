async function two(): Promise<i64> {
  return 2;
}

function main() {
  spawn(two());
}
// error: 'spawn' can only be used inside an 'async' function, where the runtime is running
