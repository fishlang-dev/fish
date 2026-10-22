// expect: 0 0
// expect: 1
class Holder {
  #p: Permit | null;
  constructor() {
    this.#p = null;
  }
  set p(v: Permit | null) {
    this.#p = v;
  }
}

async function main() {
  const sem = new Semaphore(1);
  const a = await sem.acquire();
  const s = shared({ p: a });
  if (true) {
    const q = s.p;
  }
  const after = sem.available();
  let h = new Holder();
  const b = shared({ inner: { n: 1 } });
  console.log(after, sem.available());
  const sem2 = new Semaphore(1);
  const c = await sem2.acquire();
  h.p = c;
  console.log(sem2.available() + 1);
}
