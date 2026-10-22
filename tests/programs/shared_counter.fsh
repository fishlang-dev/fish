// expect: 40000 400 last
type State = { hits: i64; names: string[] };

async function work(state: shared<State>, n: i64): Promise<i64> {
  for (let i = 0; i < 100; i++) {
    state.update((s) => {
      s.hits++;
    });
    if (i % 25 === 0) await yieldNow();
  }
  state.update((s) => s.names.push("task" + n));
  return n;
}

async function main() {
  const state = shared<State>({ hits: 0, names: [] });
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 400; n++) handles.push(spawn(work(state.clone(), n)));
  for (let n = 0; n < 400; n++) {
    const h = handles.pop()!;
    await h;
  }
  const hits = state.update((s) => s.hits);
  const count = state.update((s) => s.names.length);
  const last = state.update((s) => s.names.length > 0 ? "last" : "none");
  console.log(hits, count, last);
}
