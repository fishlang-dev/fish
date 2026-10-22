// expect: 2 1
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    s.hits += 2;
    s.seen.add(1);
  });
  console.log(state.hits, state.seen.load());
}
