// panic: send on a closed channel
async function main() {
  const ch = new Channel<string>(2);
  ch.close();
  await ch.send("late" + "");
}
