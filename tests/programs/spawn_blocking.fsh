// case: spawn_blocking_result
// expect: 55 fish 3
// expect: done
function fib(n: i64): i64 {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
function hi(): void {
  console.log("done");
}
async function main() {
  const name = "fish";
  const xs = [1, 2, 3];
  const v = await spawnBlocking(() => fib(10));
  const s = await spawnBlocking(() => name + "");
  const n = await spawnBlocking(() => xs.length);
  console.log(v, s, n);
  await spawnBlocking(hi);
}
// case: spawn_blocking_throws
// expect: caught too big
// expect: 3
function check(n: i64): i64 throws string {
  if (n > 5) throw "too big";
  return n;
}
async function main() {
  try {
    await spawnBlocking(() => check(9));
    console.log("unreachable");
  } catch (e) {
    console.log("caught", e);
  }
  try {
    const ok = await spawnBlocking(() => check(3));
    console.log(ok);
  } catch (e) {
    console.log("unexpected", e);
  }
}
// case: spawn_blocking_panic
// panic: a task this awaited panicked: index out of bounds: the len is 1 but the index is 4
async function main() {
  const xs = [1];
  const v = await spawnBlocking(() => xs[4]);
  console.log(v);
}
// case: spawn_blocking_join
// expect: panic index out of bounds: the len is 1 but the index is 4
// expect: then 2
async function main() {
  try {
    const xs = [1];
    await spawnBlocking(() => xs[4]).join();
  } catch (e) {
    console.log("panic", e.message);
  }
  const two = await spawnBlocking(() => 2);
  console.log("then", two);
}
// case: spawn_blocking_beside_async
// expect: timer 0
// expect: 64 finished
// expect: concurrent true
declare function usleep(us: u32): i32;
async function main() {
  const finished = shared({ count: new Atomic(0) });
  const started = Date.now();
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 64; i++) {
    const counter = finished.clone();
    handles.push(spawnBlocking(() => {
      unsafe { usleep(300000); }
      counter.count.add(1);
      return i;
    }));
  }
  await sleep(20);
  console.log("timer", finished.count.load());
  let sum = 0;
  while (true) {
    const h = handles.pop();
    if (h === null) break;
    const i = await h;
    sum += i;
  }
  console.log(finished.count.load(), sum === 2016 ? "finished" : "wrong");
  console.log("concurrent", Date.now() - started < 3000);
}
// case: spawn_blocking_outside_async
// error: 'spawnBlocking' can only be used inside an 'async' function
function main() {
  const h = spawnBlocking(() => 1);
}
// case: spawn_blocking_async_closure
// error: 'spawnBlocking' runs a synchronous function on a thread of its own; run async work with 'spawn' instead
async function main() {
  const v = await spawnBlocking(async () => 1);
}
// case: spawn_blocking_cell
// error: 'spawnBlocking' runs this function on another thread, so it must own everything it uses; it holds a 'Cell<i64>'
async function main() {
  const c = new Cell(1);
  const v = await spawnBlocking(() => c.get());
}
// case: spawn_blocking_moves
// error: can't be used here because 'items' was moved
async function main() {
  const items = [1, 2, 3];
  const h = spawnBlocking(() => items.length);
  console.log(items.length);
  const n = await h;
}
// case: spawn_blocking_left_running
// expect: main done
declare function usleep(us: u32): i32;
async function main() {
  const note = "late" + 1;
  spawnBlocking(() => {
    unsafe { usleep(1000000); }
    console.log(note);
  });
  await sleep(10);
  console.log("main done");
}
