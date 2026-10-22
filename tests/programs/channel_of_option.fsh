// error: a 'Channel' can't carry 'i64 | null': 'receive' gives null once the channel is closed
async function main() {
  const ch = new Channel<i64 | null>(4);
}
