// error: a mapped type takes keys written as string literals, like '"a" | "b"', not 'string'
type Bad = { [K in string]: i64 };
function main() {}
