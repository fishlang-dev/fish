// error: cannot assign to 'state.hits' because 'state' is shared between threads; change it inside 'state.update(...)'
function main() {
  const state = shared({ hits: 0 });
  state.hits = 1;
}
