function main() {
  const s: string = "a😀";
  console.log(s.charCodeAt(2));
  console.log(s.charCodeAt(3));
}
// expect: 56832
// panic: index out of bounds: the len is 3 but the index is 3
