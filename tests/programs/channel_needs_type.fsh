// error: 'Channel' needs the type it carries, as in 'new Channel<string>(8)'
function main() {
  const ch = new Channel(8);
}
