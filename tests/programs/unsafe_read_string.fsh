function main() {
  const s = "a" + 1;
  const p = ptrOf(s);
  unsafe {
    console.log(p.read());
  }
}
// error: raw reads and writes of 'string' are not supported yet
