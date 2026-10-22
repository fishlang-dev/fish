// error: is not assignable to parameter of type 'i64'
function main() {
  const a = new Atomic(1);
  a.store("two");
}
