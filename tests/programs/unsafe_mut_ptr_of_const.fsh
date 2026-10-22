function main() {
  const x = 1;
  const p = mutPtrOf(x);
}
// error: cannot point mutably at 'x' because it is a constant
