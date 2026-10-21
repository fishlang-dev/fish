function main() {
  const n: usize = 4611686018427387904;
  console.log("x".padStart(n, "a").length);
}
// panic: invalid string length
