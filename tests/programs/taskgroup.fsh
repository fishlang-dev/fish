// case: taskgroup_body_error
// expect: child stopped
// expect: caught bad input
class Invalid {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}
async function waits(signal: AbortSignal) {
  try {
    await sleep(60000, signal);
    console.log("child slept");
  } catch (e) {
    console.log("child stopped");
  }
}
async function main() {
  try {
    await taskGroup(async (group) => {
      group.spawn(waits(group.signal));
      await sleep(30);
      throw new Invalid("bad " + "input");
    });
    console.log("not reached");
  } catch (e) {
    console.log("caught", e.why);
  }
}
// case: taskgroup_both_fail
// expect: caught the task's: early
class Early {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}
class Late {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}
async function fails(): Promise<void> throws Early {
  await yieldNow();
  throw new Early("ear" + "ly");
}
async function main() {
  try {
    await taskGroup(async (group) => {
      group.spawn(fails());
      try {
        await sleep(60000, group.signal);
      } catch (e) {
        throw new Late("la" + "te");
      }
    });
  } catch (e) {
    if (e instanceof Early) console.log("caught the task's:", e.why);
    else console.log("caught the closure's:", e.why);
  }
}
// case: taskgroup_child_error
// expect: sibling stopped
// expect: caught users/7 404
// expect: after
class NotFound {
  path: string;
  status: i64;
  constructor(path: string, status: i64) {
    this.path = path;
    this.status = status;
  }
}
async function find(path: string): Promise<void> throws NotFound {
  await sleep(30);
  throw new NotFound(path, 404);
}
async function sibling(signal: AbortSignal) {
  try {
    await sleep(60000, signal);
    console.log("sibling slept");
  } catch (e) {
    console.log("sibling stopped");
  }
}
async function main() {
  try {
    await taskGroup(async (group) => {
      group.spawn(sibling(group.signal));
      group.spawn(find("users/" + 7));
    });
    console.log("not reached");
  } catch (e) {
    console.log("caught", e.path, e.status);
  }
  console.log("after");
}
// case: taskgroup_child_panic
// expect: sibling cleaned up
// panic: a task this awaited panicked: index out of bounds: the len is 1 but the index is 3
async function boom(xs: string[]): Promise<string> {
  await sleep(20);
  return xs[3];
}
async function sibling(signal: AbortSignal) {
  try {
    await sleep(60000, signal);
  } catch (e) {
    console.log("sibling cleaned up");
  }
}
async function main() {
  await taskGroup(async (group) => {
    group.spawn(sibling(group.signal));
    group.spawn(boom(["a" + 1]));
  });
  console.log("not reached");
}
// case: taskgroup_child_reference
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses
async function first(xs: Ref<string[]>): Promise<string> {
  return xs[0];
}
async function main() {
  await taskGroup(async (group) => {
    const names = ["a" + 1];
    group.spawn(first(names));
  });
}
// case: taskgroup_children
// expect: child 2 done
// expect: child 1 done
// expect: after group
async function work(n: i64, ms: i64) {
  await sleep(ms);
  console.log("child", n, "done");
}
async function main() {
  await taskGroup(async (group) => {
    group.spawn(work(1, 250));
    group.spawn(work(2, 20));
  });
  console.log("after group");
}
// case: taskgroup_dropped
// expect: raced 1
// expect: child saw abort
async function watcher(signal: AbortSignal, seen: Channel<string>) {
  let aborted = false;
  try {
    await sleep(60000, signal);
  } catch (e) {
    aborted = true;
  }
  if (aborted) await seen.send("child saw abort");
}
async function grouped(seen: Channel<string>): Promise<i64> {
  await taskGroup(async (group) => {
    group.spawn(watcher(group.signal, seen.clone()));
    await sleep(60000);
  });
  return 0;
}
async function quick(): Promise<i64> {
  await sleep(30);
  return 1;
}
async function main() {
  const seen = new Channel<string>(1);
  const r = await Promise.race([grouped(seen.clone()), quick()]);
  console.log("raced", r);
  const said = await seen.receive();
  console.log(said!);
}
// case: taskgroup_empty
// expect: 7
// expect: done
async function main() {
  const n = await taskGroup(async (group) => {
    await yieldNow();
    const signal = group.signal;
    return signal.aborted ? 0 : 7;
  });
  console.log(n);
  console.log("done");
}
// case: taskgroup_error_union
// expect: denied waited
// expect: missing a
// expect: missing waited
// expect: denied b
class Missing {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class Denied {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
async function missing(name: string, signal: AbortSignal, first: boolean): Promise<void> throws Missing {
  if (first) await sleep(20);
  else {
    try {
      await sleep(60000, signal);
    } catch (e) {
      console.log("missing waited");
    }
  }
  throw new Missing(name);
}
async function denied(name: string, signal: AbortSignal, first: boolean): Promise<void> throws Denied {
  if (first) await sleep(20);
  else {
    try {
      await sleep(60000, signal);
    } catch (e) {
      console.log("denied waited");
    }
  }
  throw new Denied(name);
}
async function both(missingFirst: boolean): Promise<void> throws Missing | Denied {
  await taskGroup(async (group) => {
    group.spawn(missing("a", group.signal, missingFirst));
    group.spawn(denied("b", group.signal, !missingFirst));
  });
}
async function main() {
  for (const first of [true, false]) {
    try {
      await both(first);
    } catch (e) {
      if (e instanceof Missing) console.log("missing", e.name);
      else console.log("denied", e.name);
    }
  }
}
// case: taskgroup_many
// expect: 44850
// expect: after group
async function add(total: shared<{ sum: Atomic<i64> }>, n: i64) {
  if (n % 3 === 0) await yieldNow();
  total.sum.add(n);
}
async function main() {
  const total = shared({ sum: new Atomic(0) });
  const mine = total.clone();
  await taskGroup(async (group) => {
    for (let i = 0; i < 300; i++) group.spawn(add(mine.clone(), i));
  });
  console.log(total.sum.load());
  console.log("after group");
}
// case: taskgroup_nested_throwing_child
// error: which only the group's own closure can pass to its 'await taskGroup'
class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}
async function fails(n: i64): Promise<void> throws Oops {
  await yieldNow();
  throw new Oops("failed " + n);
}
async function main() {
  try {
    await taskGroup(async (group) => {
      const ns = [1, 2];
      ns.forEach((n) => group.spawn(fails(n)));
    });
  } catch (e) {
    console.log(e.why);
  }
}
// case: taskgroup_not_an_arrow
// error: 'taskGroup' takes an async arrow function written in place, which takes the group
async function body(group: TaskGroup) {
  await yieldNow();
}
async function main() {
  await taskGroup(body);
}
// case: taskgroup_not_awaited
// error: 'taskGroup' is awaited where it is called
async function main() {
  const pending = taskGroup(async (group) => {
    await yieldNow();
  });
  await pending;
}
// case: taskgroup_outside_async
// error: 'taskGroup' can only be used inside an 'async' function
function main() {
  taskGroup(async (group) => {
    await yieldNow();
  });
}
// case: taskgroup_reassigned
// error: cannot assign to 'group': a task group's closure keeps the group it was called with
async function main() {
  const other = await taskGroup(async (group) => {
    await yieldNow();
    return group;
  });
  await taskGroup(async (group) => {
    group = other;
  });
}
// case: taskgroup_try_around_spawn
// error: nothing in this 'try' can throw, so its 'catch' never runs
class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}
async function fails(n: i64): Promise<void> throws Oops {
  await yieldNow();
  throw new Oops("failed " + n);
}
async function main() {
  try {
    await taskGroup(async (group) => {
      try {
        group.spawn(fails(1));
      } catch (e) {
        console.log("never");
      }
    });
  } catch (e) {
    console.log(e.why);
  }
}
// case: taskgroup_value
// expect: child done
// expect: built report 3
async function work(done: shared<{ n: Atomic<i64> }>) {
  await sleep(30);
  done.n.add(3);
  console.log("child done");
}
async function main() {
  const done = shared({ n: new Atomic(0) });
  const counted = done.clone();
  const text = await taskGroup(async (group) => {
    group.spawn(work(counted.clone()));
    return "built " + "report";
  });
  console.log(text, done.n.load());
}
