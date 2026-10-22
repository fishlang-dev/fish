async function save(n: i64) { console.log(n); }
async function main() { let p = save(1); p = save(2); await p; }
// expect: 2
