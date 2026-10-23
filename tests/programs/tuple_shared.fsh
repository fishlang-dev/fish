// expect: 1 s1
// A shared tuple's elements are read under its lock.
type S = { t: [i64, i64] };
async function main() {
  const g = shared<[i64, string]>([1, "s" + 1]);
  console.log(g[0], g[1]);
}
