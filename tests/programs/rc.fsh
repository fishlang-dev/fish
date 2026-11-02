// case: rc_across_await
// expect: 2 2
async function count(r: Rc<{ n: i64 }>): Promise<i64> {
  await yieldNow();
  r.update((v) => v.n++);
  return r.n;
}

async function main() {
  const r = new Rc({ n: 1 });
  const got = await count(r.clone());
  await yieldNow();
  console.log(got, r.n);
}
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
// panic: this Rc's value is already being changed by an `update` running here; use the value its callback is given
function main() {
  const a = new Rc({ n: 1 });
  const b = a.clone();
  const got = a.update((v) => b.update((w) => w.n + v.n));
  console.log(got);
}
// case: rc_unknown_method
// error: 'Rc' has no method 'set'; read its fields, change it with 'update', read it in place with 'read', share it again with 'clone', or reach it weakly with 'downgrade'
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
// case: rc_ptr_eq
// expect: true false true true
// expect: true
// expect: 1 1
function same(a: Ref<Rc<{ n: i64 }>>, b: Rc<{ n: i64 }>): boolean {
  return Rc.ptrEq(a, b);
}

function main() {
  const a = new Rc({ n: 1 });
  const b = a.clone();
  const c = new Rc({ n: 1 });
  console.log(Rc.ptrEq(a, b), Rc.ptrEq(a, c), same(a, b.clone()), Rc.ptrEq(a.clone(), b));
  const w = a.downgrade();
  const u = w.upgrade();
  if (u !== null) console.log(Rc.ptrEq(u, a));
  console.log(a.n, b.n);
}
// case: rc_ptr_eq_types
// error: 'Rc.ptrEq' compares two Rcs of one type
function main() {
  const a = new Rc({ n: 1 });
  const b = new Rc({ m: 1 });
  console.log(Rc.ptrEq(a, b));
}
// case: rc_triple_equals
// error: it has no value equality; 'Rc.ptrEq(a, b)' tells whether two Rcs share one value
function main() {
  const a = new Rc({ n: 1 });
  const b = a.clone();
  console.log(a === b);
}
// case: rc_spawn
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Rc<{ n: i64 }>', which counts its owners without atomics, so only one thread may use it; use a 'shared' value instead
async function read(r: Rc<{ n: i64 }>): Promise<i64> {
  return r.n;
}

async function main() {
  const h = spawn(read(new Rc({ n: 1 })));
  console.log(await h);
}
// case: rc_weak_spawn
// error: it holds a 'Weak<{ n: i64 }>', which counts its owners without atomics
class Holder {
  w: Weak<{ n: i64 }>;
  constructor(w: Weak<{ n: i64 }>) { this.w = w; }
}

async function read(h: Holder): Promise<i64> {
  return 1;
}

async function main() {
  const r = new Rc({ n: 1 });
  const h = spawn(read(new Holder(r.downgrade())));
  console.log(await h);
}
// case: rc_in_shared
// error: a 'shared' value is used from many threads at once, so it can't hold a 'Rc<i64>', which counts its owners without atomics
function main() {
  const s = shared({ r: new Rc(1) });
}
// case: rc_in_channel
// error: a 'Channel' carries values to other tasks, so it can't carry a 'Rc<i64>', which counts its owners without atomics
function main() {
  const c = new Channel<Rc<i64>>(1);
}
// case: rc_in_dyn
// error: may cross to another thread, so it can't hold a 'Rc<i64>', which counts its owners without atomics
interface Named { name(): string }
class Tag {
  r: Rc<i64>;
  constructor(r: Rc<i64>) { this.r = r; }
  name(): string { return "tag"; }
}

function main() {
  const d: Dyn<Named> = new Tag(new Rc(1));
  console.log(d.name());
}
// case: rc_update_replaces_receiver
// error: rc_update_replaces_receiver.fsh:4:21: error[E0203]: cannot mutably lend 'r' while 'r' is lent to 'update' for this call
function main() {
  let r = new Rc({ s: "a" + "b" });
  r.update((v) => { r = new Rc({ s: "q" + "" }); v.s = "x" + "y"; });
  console.log(r.s);
}
// case: rc_update_pops_receiver
// error: rc_update_pops_receiver.fsh:4:26: error[E0203]: cannot mutably lend 'xs' while 'xs[...]' is lent to 'update' for this call
function main() {
  let xs = [new Rc({ s: "a" + "b" })];
  xs[0]!.update((v) => { xs.pop(); v.s = "x" + "y"; });
  console.log(xs.length);
}
// case: rc_update_replaces_field_receiver
// error: rc_update_replaces_field_receiver.fsh:5:23: error[E0203]: cannot mutably lend 'h' while 'h.c' is lent to 'update' for this call
type H = { c: Rc<{ s: string }> };
function main() {
  let h: H = { c: new Rc({ s: "a" + "b" }) };
  h.c.update((v) => { h.c = new Rc({ s: "q" + "" }); v.s = "x" + "y"; });
  console.log(h.c.s);
}
// case: rc_recursive_alias
// expect: 2 2 true
// expect: a
type Tree = { kids: Rc<Tree>[]; n: i64 };
type Node = { s: string; me: Weak<Node> };

function main() {
  const r = new Rc<Tree>({ kids: [], n: 1 });
  r.update((v) => v.kids.push(new Rc<Tree>({ kids: [], n: 2 })));
  r.update((v) => v.kids.push(new Rc<Tree>({ kids: [], n: 3 })));
  const kids = r.kids;
  const n = new Rc<Node>({ s: "a" + "", me: new Weak<Node>() });
  n.update((v) => { v.me = n.downgrade(); });
  const me = n.me.upgrade();
  console.log(kids.length, kids[0]!.n, me !== null);
  if (me !== null) console.log(me.s);
}
// case: rc_cell_field_blocks_whole_change
// error: rc_cell_field_blocks_whole_change.fsh:9:19: error[E0304]: cannot call 'reset' on 'v' as a whole inside 'update'
class Node {
  label: Cell<string> = new Cell("start" + "!");
  reset(this: Mut<this>) { this.label = new Cell("new" + "!"); }
}

// A borrowed Cell field would dangle if 'reset' replaced it.
function look(c: Ref<Cell<string>>, r: Rc<Node>) {
  r.update((v) => v.reset());
  console.log(c.get());
}

function main() {
  const r = new Rc(new Node());
  look(r.label, r.clone());
}
// case: rc_back_references
// expect: a sees root, parent root, 2 kids
// expect: a sees root, parent root, 2 kids
// expect: b sees root, parent root, 2 kids
// expect: b sees root, parent root, 2 kids
// expect: 4 parent root
// expect: root 2
class Parent {
  name: string;
  told: Cell<i64> = new Cell(0);
  kids: Rc<Child>[] = [];
  constructor(name: string) { this.name = name; }
  label(): string { return "parent " + this.name; }
  visit(times: i64) {
    for (const k of this.kids) for (let i = 0; i < times; i++) k.poke();
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
    if (p === null) return;
    console.log(`${this.name} sees ${p.name}, ${p.label()}, ${p.read((v) => v.kids.length)} kids`);
    p.told.set(p.told.get() + 1);
  }
}

function main() {
  const root = new Rc(new Parent("root"));
  root.update((p) => p.kids.push(new Rc(new Child("a", root.downgrade()))));
  root.update((p) => p.kids.push(new Rc(new Child("b", root.downgrade()))));
  root.visit(2);
  console.log(root.told.get(), root.label());
  root.update((p) => p.kids[0]!.update((c) => console.log(root.name, root.kids.length)));
}
// case: rc_update_under_read
// panic: this Rc's value is being read by a `read` or a method running here, so `update` can't change it until that returns
class Parent {
  hits: i64 = 0;
  kid: Rc<Child>;
  constructor(kid: Rc<Child>) { this.kid = kid; }
  visit() { this.kid.poke(); }
}

class Child {
  parent: Weak<Parent> = new Weak<Parent>();
  poke() {
    const p = this.parent.upgrade();
    if (p !== null) p.update((v) => v.hits++);
  }
}

function main() {
  const kid = new Rc(new Child());
  const root = new Rc(new Parent(kid.clone()));
  kid.update((c) => { c.parent = root.downgrade(); });
  root.visit();
}
// case: rc_read_under_update
// panic: this Rc's value is being changed by an `update` running here, so it can't be read until that returns
class Counter {
  n: i64 = 0;
  get(): i64 { return this.n; }
}

function main() {
  const c = new Rc(new Counter());
  const d = c.clone();
  c.update((v) => { v.n = d.get() + 1; });
}
// case: rc_mut_method
// error: 'bump' changes its object, so on an Rc it runs inside 'update', as in 'c.update((v) => v.bump(...))'
class Counter {
  n: i64 = 0;
  bump(this: Mut<this>) { this.n++; }
}

function main() {
  const c = new Rc(new Counter());
  c.bump();
}
// case: rc_cell_write_in_update
// error: cannot assign to 'v.seen' inside 'update': 'v.seen' is borrowed where it lives, outside 'update', so it changes only through its own methods
function main() {
  const r = new Rc({ hits: 0, seen: new Cell(0) });
  r.update((v) => {
    v.hits++;
    v.seen = new Cell(5);
  });
}
// case: rc_await_in_update
// error: an Rc's 'update' callback can't 'await': the value stays marked as changed until the callback returns
async function main() {
  const r = new Rc({ n: 0 });
  r.update((v) => {
    await yieldNow();
    v.n++;
  });
}
// case: rc_read_through_returned_reference
// error: rc_read_through_returned_reference.fsh:6:5: error[E0203]: cannot mutably lend 'r' while 'r' is lent to 'read' for this call
function pick(l: Ref<Rc<string[]>>): Ref<Rc<string[]>> { return l; }
function main() {
  let r = new Rc<string[]>(["a" + "b", "c" + "d"]);
  pick(r).read((v) => {
    r = new Rc<string[]>(["q" + "r"]);
    console.log(v[0]!, v.length);
  });
}
