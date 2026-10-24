// error: a shared value's array is read as a copy, so read its capacity inside 'st.update(...)'
type State = { names: string[]; n: i64 };
async function main() {
  const st = shared<State>({ names: [], n: 0 });
  st.update((s) => { s.names.push("a" + ""); s.names.reserve(16); s.n = 5; });
  console.log(st.names.length, st.names.capacity, st.n);
}
