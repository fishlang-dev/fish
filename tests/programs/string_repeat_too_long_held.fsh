function main() {
  const big: usize = 2305843009213693952;
  const s = "ab" + 1;
  console.log(s.repeat(big).length);
}
// panic: invalid string length
