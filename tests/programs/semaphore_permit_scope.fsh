// expect: 2 1 2
// expect: 0
async function main() {
  const sem = new Semaphore(2);
  const before = sem.available();
  {
    const permit = await sem.acquire();
    const during = sem.available();
    console.log(before, during, before);
  }
  const p1 = await sem.acquire();
  const p2 = await sem.acquire();
  console.log(sem.available());
}
