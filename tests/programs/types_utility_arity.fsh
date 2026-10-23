// error: 'Pick' takes two type arguments, like 'Pick<User, "id">'
type User = { id: i64 };
type P = Pick<User>;
function main() {}
