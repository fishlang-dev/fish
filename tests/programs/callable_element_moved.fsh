// error: 'fs[0]' can't be used here because 'fs' was moved
function eat(fs: ((n: i64) => string)[]): i64 { return 1 }
function main() {
  const s = "orig" + "";
  let fs: ((n: i64) => string)[] = [(n) => s + n];
  eat(fs);
  print(fs[0](1));
}
