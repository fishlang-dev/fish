// expect: holding
// expect: main done
async function hold(sem: shared<{ gate: Semaphore }>): Promise<i64> {
  const permit = await sem.gate.acquire();
  console.log("holding");
  await sleep(100000);
  return 1;
}

async function wait(sem: shared<{ gate: Semaphore }>): Promise<i64> {
  await sleep(20);
  const permit = await sem.gate.acquire();
  console.log("never");
  return 2;
}

async function main() {
  const state = shared({ gate: new Semaphore(1) });
  const a = spawn(hold(state.clone()));
  const b = spawn(wait(state.clone()));
  await sleep(60);
  console.log("main done");
}
