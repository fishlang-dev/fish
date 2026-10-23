// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A local shadowing a top-level const isn't what 'typeof' names, so it is refused, not mistaken.
const LIMIT: i64 = 5;
function main() { const LIMIT = "text"; const x: typeof LIMIT = 3; console.log(x, LIMIT); }
