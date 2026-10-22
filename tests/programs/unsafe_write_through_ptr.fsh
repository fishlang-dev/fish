function main() {
  let x = 1;
  const p = ptrOf(x);
  unsafe {
    p.write(2);
  }
}
// error: 'write' needs a 'MutPtr'; a 'Ptr' only reads what it points at
