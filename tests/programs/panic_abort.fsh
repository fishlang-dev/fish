// mode: abort
function main() {
  const big: i64 = 9223372036854775807;
  console.log("before");
  console.log(big + 1);
}
// expect: before
// panic: attempt to add with overflow
