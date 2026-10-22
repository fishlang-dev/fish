function main() {
  const x = 1;
  const p = ptrOf(x);
  console.log(p.read());
}
// error: 'read' on a raw pointer can only happen inside 'unsafe { }'
