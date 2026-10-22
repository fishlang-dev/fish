function* g() {
  return;
}

function main() {
  const it = g();
}
// error: this generator never yields, so what it gives can't be told; declare it as 'Generator<T>'
