function main() {
  const words = ["a" + 1, "b"];
  const i: usize = 2;
  console.log(words[1]);
  console.log(words[i]);
}
// expect: b
// panic: index out of bounds: the len is 2 but the index is 2
