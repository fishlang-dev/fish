// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A closure's parameter annotation sees the locals around it.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const g = (x: typeof LIMIT) => x; console.log(g("s"), LIMIT); }
