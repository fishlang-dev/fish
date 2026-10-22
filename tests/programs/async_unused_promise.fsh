async function save(n: i64) {
  console.log(n);
}

async function main() {
  save(1);
}
// error: this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'
