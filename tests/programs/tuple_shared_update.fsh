// expect: 5 1
// A tuple's element is assigned inside a shared value's update.
async function main() {
  const g = shared<[i64, Atomic<i64>]>([1, new Atomic(0)]);
  g.update((s) => s[0] = 5);
  g[1].add(1);
  console.log(g.update((s) => s[0]), g[1].load());
}
