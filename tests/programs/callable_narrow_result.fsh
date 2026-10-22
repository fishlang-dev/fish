// expect: 3
type A = { a: i64 };
function main() {
  const s = "x" + "";
  const g = move (n: i64) => ({ a: n, b: s + "" });
  let fs: ((n: i64) => A)[] = [];
  fs.push(g);
  print(fs[0](3).a);
}
