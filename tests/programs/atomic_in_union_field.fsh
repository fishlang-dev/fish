// error: 'add' works on the 'Atomic' where it lives, so call it on a variable or a field; narrow a union to one member first
type U = { k: "a"; c: Atomic<i64> } | { k: "b"; c: Atomic<i64> };
function main() {
  const u: U = { k: "a", c: new Atomic(1) };
  u.c.add(5);
  console.log(u.c.load());
}
