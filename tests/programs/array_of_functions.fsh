function main() {
  let fs: (() => i64)[] = [];
  fs.push(() => 2);
  print(fs.length, fs[0]())
}
// expect: 1 2
