// case: cell_argument_uses_cell
// expect: a
function main() {
  const c = new Cell<string>("a" + "");
  c.set(c.replace("b" + ""));
  console.log(c.replace("z"));
}
// case: cell_get_object
// error: 'get' copies what a Cell holds, which a '{ x: i64 }' can't be; use 'replace'
function main() {
  const s = new Cell({ x: 1 });
  console.log(s.get().x);
}
// case: cell_methods
// expect: 1 2 3
// expect: a ab
// expect: b c
function bump(c: Ref<Cell<i64>>) {
  c.set(c.get() + 1);
}

class Names {
  last: Cell<string> = new Cell("a");
}

function main() {
  const c = new Cell(1);
  const one = c.get();
  bump(c);
  const two = c.get();
  const old = c.replace(3);
  console.log(one, old, c.get());
  const s = new Cell("a" + "");
  const was = s.replace("ab" + "");
  console.log(was, s.replace("x"));
  const n = new Names();
  n.last.set("b" + "");
  const b = n.last.replace("c");
  console.log(b, n.last.replace("d"));
  const unused = two;
}
// case: cell_of_future
// expect: 12
async function job(n: i64): Promise<i64> {
  return n * 2;
}

async function main() {
  const c = new Cell(job(4));
  const f = c.replace(job(6));
  const v = await f;
  console.log(v + 4);
}
// case: cell_spawn
// error: it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead
async function count(c: Cell<i64>): Promise<i64> {
  return c.get();
}

async function main() {
  const h = spawn(count(new Cell(1)));
  console.log(await h);
}
// case: cell_string_get
// expect: hi hi
function main() {
  const s = new Cell("h" + "i");
  const a = s.get();
  const b = s.get();
  console.log(a, b);
}
