function main() {
  const s = "ab";
  const i: usize = 2;
  console.log(s[1]);
  console.log(s[i]);
}
// expect: b
// panic: index out of bounds: the len is 2 but the index is 2
