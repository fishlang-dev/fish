// error: 'add' needs an integer 'Atomic', not 'Atomic<boolean>'
function main() {
  const a = new Atomic(true);
  a.add(true);
}
