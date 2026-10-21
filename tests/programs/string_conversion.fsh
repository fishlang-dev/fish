function main() {
  String(5);
  const s = String(1.5) + String("x");
  console.log(s, "abc".indexOf("c") as usize);
}
// expect: 1.5x 2
