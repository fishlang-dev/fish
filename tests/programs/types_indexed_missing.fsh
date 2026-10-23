// error: 'age' isn't a field of '{ id: i64; name: string }'
// An indexed access type names a field the type has.
type User = { id: i64; name: string };
type Age = User["age"];
function main() {}
