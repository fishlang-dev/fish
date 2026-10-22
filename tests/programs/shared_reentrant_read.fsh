// panic: this lock is already held by an `update` running here
function main() {
  const state = shared({ n: 1, name: "a" });
  const c = state.clone();
  const got = state.update((s) => c.n + s.n);
  console.log(got);
}
