// error: 'Pick' takes keys written as string literals, like '"a" | "b"', not 'string'
type User = { id: i64 };
type P = Pick<User, string>;
function main() {}
