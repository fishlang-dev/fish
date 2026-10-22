// error: store the async function's call instead
async function main() {
  const p: Promise<void> = sleep(5);
}
