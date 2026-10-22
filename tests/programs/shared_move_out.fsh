// error: 'state.seen' can't be moved out of 'state', which every clone of it shares; use it where it is
function main() {
  const state = shared({ seen: new Atomic(0) });
  const seen = state.seen;
}
