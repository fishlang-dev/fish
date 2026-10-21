// An arrow forwarding a call that returns an Option gives it.
function run(f: () => i64 | null): i64 | null {
  const g = () => f()
  return g()
}
function main() {
  print(run(() => 3))
}
// expect: 3
