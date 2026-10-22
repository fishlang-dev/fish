// expect: 7
function main() {
  let fs: ((m: string) => i64)[] = [];
  fs.push(() => 7);
  print(fs[0]("x" + ""));
}
