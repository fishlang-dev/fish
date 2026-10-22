// panic: a channel's capacity is too large to allocate
async function main() {
  const ch = new Channel<string>(2305843009213693952);
  for (let i = 0; i < 1000; i++) await ch.send("value " + i);
}
