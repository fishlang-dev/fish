// expect: 3 6
// expect: ab
// expect: 2
function add(lock: Ref<Lock<i64[]>>, n: i64) {
  lock.update((xs) => xs.push(n));
}

function main() {
  const items = new Lock<i64[]>([]);
  add(items, 1);
  add(items, 2);
  add(items, 3);
  const count = items.update((xs) => xs.length);
  const sum = items.update((xs) => {
    let s = 0;
    for (const x of xs) s += x;
    return s;
  });
  console.log(count, sum);
  const name = new Lock("a" + "");
  name.update((s) => {
    s += "b";
  });
  console.log(name.update((s) => s.slice(0, 2)));
  const extra = "unused" + "";
  const popped = items.update((xs) => xs.pop());
  console.log(popped! - 1);
}
