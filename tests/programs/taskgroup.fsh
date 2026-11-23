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
