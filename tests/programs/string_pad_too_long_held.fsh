function main() {
  const big: usize = 4611686018427387904;
  const s = "ab" + 1;
  console.log(s.padStart(big, "z").length);
}
// panic: invalid string length
