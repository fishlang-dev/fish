// expect: 1
function main() {
  let fs: ((a: i64) => void)[] = [];
  fs.push((a) => "x" + a);
  fs[0](1);
  fs[0](2);
  print(1);
}
