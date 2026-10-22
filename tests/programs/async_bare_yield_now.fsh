async function save(n: i64) { console.log(n); }
async function main() { yieldNow(); }
// error: this Promise does nothing until it's awaited
