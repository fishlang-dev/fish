// error: because 'state' is shared between threads; change it inside 'state.update(...)'
function main() {
  const state = shared({ names: ["a"] });
  state.names.push("b");
}
