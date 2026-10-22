// error: can't clone an 'Atomic', which is changed in place wherever it is shared
function main() {
  const a = new Atomic(1);
  const b = a.clone();
  console.log(b.load());
}
