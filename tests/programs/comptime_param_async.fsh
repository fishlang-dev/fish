// error: comptime parameters on async functions and generators are not supported yet
// An async function's state can't hold a comptime parameter yet.
async function g(comptime n: i64): Promise<i64> { return n; }
async function main(): Promise<void> { const v = await g(1); console.log(v); }
