function make(): i64 {
  return 1;
}

function main() {
  const p = ptrOf(make());
}
// error: 'ptrOf' needs a variable or a field to point at
