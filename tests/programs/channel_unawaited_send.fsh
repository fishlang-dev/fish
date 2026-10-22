// error: this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'
async function main() {
  const ch = new Channel<string>(1);
  ch.send("dropped" + "");
}
