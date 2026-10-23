// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A cast inside a body sees its locals.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const v = 3 as typeof LIMIT; console.log(v, LIMIT); }
