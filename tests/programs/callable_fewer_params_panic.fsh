// panic: attempt to divide by zero
function main() {
  let fs: ((n: i64, m: string) => i64)[] = [];
  fs.push((n) => 10 / n);
  print(fs[0](2, "a" + ""));
  print(fs[0](0, "b" + ""));
}
