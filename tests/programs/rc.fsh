// case: rc_counts_and_fields
// expect: root 2 20 4
// expect: x
type Node = { name: string; hits: i64; seen: Cell<i64> };

function bump(n: Rc<Node>) {
  n.update((v) => v.hits++);
  n.seen.set(n.seen.get() + 10);
}

function main() {
  const a = new Rc<Node>({ name: "root" + "", hits: 0, seen: new Cell(0) });
  const b = a.clone();
  bump(b.clone());
  bump(a.clone());
  const name = a.name;
  console.log(name, a.hits, a.seen.get(), b.update((v) => v.hits * 2));
  const r: Ref<Rc<Node>> = a;
  r.update((v) => v.name = "x");
  console.log(b.name);
}
// case: rc_generic
// expect: 3 three
class Box<T> {
  inner: Rc<T>;
  constructor(v: T) { this.inner = new Rc(v); }
  share(): Rc<T> { return this.inner.clone(); }
}

function held<T>(r: Rc<T>): Rc<T> {
  return r;
}

function main() {
  const b = new Box<{ n: i64; s: string }>({ n: 3, s: "three" + "" });
  const r = held(b.share());
  console.log(r.n, r.s);
}
// case: rc_holds_reference
// error: an 'Rc' can't hold a reference ('Ref<i64>')
function main() {
  const n = 1;
  const r = new Rc<Ref<i64>>(n);
}
// case: rc_holds_handle
// error: an 'Rc' can't hold a JoinHandle
async function f(): Promise<i64> { return 1; }
async function main() {
  const r = new Rc({ h: spawn(f()) });
}
// case: rc_move_out
// error: 'r.seen' can't be moved out of 'r', which every clone of it shares; use it where it is
function main() {
  const r = new Rc({ seen: new Cell(0) });
  const seen = r.seen;
}
// case: rc_of_rc_fields
// expect: 2 b
type Leaf = { name: string };
type Tree = { leaves: Rc<Leaf>[] };

function main() {
  const t = new Rc<Tree>({ leaves: [] });
  const b = new Rc<Leaf>({ name: "b" + "" });
  t.update((v) => v.leaves.push(new Rc({ name: "a" })));
  t.update((v) => v.leaves.push(b.clone()));
  const leaves = t.leaves;
  console.log(leaves.length, leaves[1]!.name);
}
// case: rc_reentrant_update
// panic: this lock is already held by an `update` running here
function main() {
  const a = new Rc({ n: 1 });
  const b = a.clone();
  const got = a.update((v) => b.update((w) => w.n + v.n));
  console.log(got);
}
// case: rc_unknown_method
// error: 'Rc' has no method 'set'; read its fields, change it with 'update', share it again with 'clone', or reach it weakly with 'downgrade'
function main() {
  const r = new Rc(1);
  r.set(2);
}
// case: rc_write_outside_update
// error: cannot assign to 'r.n' because 'r' is an 'Rc', whose value every clone of it reads; change it inside 'r.update(...)'
function main() {
  const r = new Rc({ n: 0 });
  r.n = 1;
}
// case: rc_parent_links
// expect: root heard a
// expect: root heard b
// expect: 2 2
// expect: c is an orphan
// expect: true true
class Parent {
  name: string;
  children: Rc<Child>[] = [];
  told: i64 = 0;
  constructor(name: string) { this.name = name; }
  hear(this: Mut<this>, from: string) {
    this.told++;
    console.log(this.name, "heard", from);
  }
}

class Child {
  name: string;
  parent: Weak<Parent>;
  constructor(name: string, parent: Weak<Parent>) {
    this.name = name;
    this.parent = parent;
  }
  poke() {
    const p = this.parent.upgrade();
    if (p !== null) p.update((v) => v.hear(this.name));
    else console.log(this.name, "is an orphan");
  }
}

function orphan(): Rc<Child> {
  const lost = new Rc(new Parent("gone"));
  return new Rc(new Child("c", lost.downgrade()));
}

function main() {
  const root = new Rc(new Parent("root"));
  const a = new Rc(new Child("a", root.downgrade()));
  const b = new Rc(new Child("b", root.downgrade().clone()));
  root.update((p) => p.children.push(a.clone()));
  root.update((p) => p.children.push(b.clone()));
  a.update((c) => c.poke());
  b.update((c) => c.poke());
  console.log(root.told, root.update((p) => p.children.length));
  orphan().update((c) => c.poke());
  const none = new Weak<Parent>();
  const back = a.parent.upgrade();
  console.log(none.upgrade() === null, back !== null);
}
// case: rc_weak_field
// error: a 'Weak' reaches its value only through 'upgrade()', which gives an 'Rc' while one is left, as in 'const p = w.upgrade()'
function main() {
  const r = new Rc({ n: 1 });
  const w = r.downgrade();
  console.log(w.n);
}
// case: rc_weak_new_untyped
// error: 'new Weak<T>()' takes no value and reaches none
function main() {
  const w = new Weak();
}
