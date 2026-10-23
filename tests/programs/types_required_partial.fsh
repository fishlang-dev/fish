// expect: 1 ann
// Required<Partial<T>> is T again.
type User = { id: i64; name: string };
type Back = Required<Partial<User>>;
function take(u: User): string { return String(u.id) + " " + u.name; }
function main() {
  const b: Back = { id: 1, name: "ann" };
  console.log(take(b));
}
