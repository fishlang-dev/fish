// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A parameter shadows a top-level name in its function's own signature.
const LIMIT: i64 = 5;
function f(LIMIT: string): typeof LIMIT { return 1; }
function main() {}
