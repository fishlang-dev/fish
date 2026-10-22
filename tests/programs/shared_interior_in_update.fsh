// error: inside 'update': other tasks borrow 's.seen' without the lock, so it changes only through its own methods
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    s.hits++;
    s.seen = new Atomic(5);
  });
}
