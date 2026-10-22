// error: inside a shared value's 'update', use 's' only through its fields
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    const r = s;
    r.seen = new Atomic(5);
  });
  console.log(state.seen.load());
}
