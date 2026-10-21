function main() {
  const s: string = "50% %d %s";
  console.log(s, "100%");
  const z: string = "a\0b";
  console.log(z === "a\0b", z === "a");
}
// expect: 50% %d %s 100%
// expect: true false
