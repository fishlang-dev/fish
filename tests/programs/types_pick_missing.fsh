// error: 'age' isn't a field of '{ id: i64; name: string }', so 'Pick' can't keep it
// Pick keeps fields the type has.
type User = { id: i64; name: string };
type P = Pick<User, "age">;
function main() {}
