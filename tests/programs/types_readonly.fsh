// error: cannot assign to 'name' because it is a read-only property
// Readonly makes every field read-only.
type User = { id: i64; name: string };
function main() {
  let u: Readonly<User> = { id: 1, name: "a" };
  u.name = "b";
}
