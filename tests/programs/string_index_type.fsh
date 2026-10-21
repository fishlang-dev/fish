function main() {
  const s = "ab";
  const i: i32 = 0;
  console.log(s[i]);
}
// error: a string's index is a 'usize', not 'i32'
