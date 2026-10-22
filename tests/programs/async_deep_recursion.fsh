// expect: 100000
function depth(n: i64): i64 {
  if (n === 0) return 0;
  return depth(n - 1) + 1;
}
async function main() {
  console.log(depth(100000));
}
