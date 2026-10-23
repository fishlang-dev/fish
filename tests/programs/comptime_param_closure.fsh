// error: comptime parameters on closures are not supported yet
// A closure's parameters are given at run time.
function main() {
  const f = (comptime n: i64) => n;
  console.log(f(1));
}
