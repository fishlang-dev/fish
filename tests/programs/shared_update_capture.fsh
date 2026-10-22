// error: a closure inside a shared value's 'update' can't capture 's'
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    const f = () => { s.seen = new Atomic(5); };
    f();
  });
  console.log(state.seen.load());
}
