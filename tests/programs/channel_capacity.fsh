// panic: a channel's capacity must be at least 1
function main() {
  const n = 0;
  const ch = new Channel<i64>(n);
}
