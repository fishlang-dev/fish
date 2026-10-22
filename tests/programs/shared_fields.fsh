// expect: 4000 4000 api 3
// expect: 3 queries
class Pool {
  queries: Atomic<i64> = new Atomic(0);
  log: Lock<string[]> = new Lock<string[]>([]);
}

async function query(pool: Ref<Pool>, sql: string): Promise<i64> {
  await yieldNow();
  pool.log.update((l) => l.push(sql));
  return pool.queries.add(1);
}

type State = { hits: i64; seen: Atomic<i64>; name: string; db: Pool };

async function handle(state: shared<State>, n: i64): Promise<i64> {
  state.update((s) => s.hits++);
  state.seen.add(1);
  if (n < 3) {
    const row = await query(state.db, "select " + n);
  }
  return n;
}

async function main() {
  const state = shared<State>({ hits: 0, seen: new Atomic(0), name: "api", db: new Pool() });
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 4000; n++) handles.push(spawn(handle(state.clone(), n)));
  for (let n = 0; n < 4000; n++) {
    const h = handles.pop()!;
    await h;
  }
  const hits = state.hits;
  const name = state.name;
  console.log(hits, state.seen.load(), name, state.db.queries.load());
  const logged = state.db.log.update((l) => l.length);
  console.log(logged, "queries");
}
