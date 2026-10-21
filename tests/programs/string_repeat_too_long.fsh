function main() {
  const n: usize = 2305843009213693952;
  const s = "ab".repeat(n);
  console.log(s.length);
}
// panic: invalid string length
