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
