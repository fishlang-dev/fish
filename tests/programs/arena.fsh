// case: arena_alloc
// expect: 0
// expect: first 2
// expect: 2001 last
// expect: changed second
// A value stays where alloc put it while later ones fill chunk after chunk.
function main() {
  const arena = new Arena<string>();
  console.log(arena.length);
  const first = arena.alloc("first");
  const second = arena.alloc("second");
  console.log(first, arena.length);
  for (let i = 2; i < 2000; i++) arena.alloc("n" + i);
  const last = arena.alloc("last");
  console.log(arena.length, last);
  first = "changed";
  console.log(first, second);
}
// case: arena_links
// expect: b c
// expect: c none A 3
// Nodes in one arena point at the ones added before them for as long as the arena lives.
class Node<A extends Lifetime> {
  name: string;
  next: Ref<Node<A>, A> | null;
  constructor(name: string, next: Ref<Node<A>, A> | null) { this.name = name; this.next = next; }
}
function following<A extends Lifetime>(n: Ref<Node<A>, A>): string {
  return n.next === null ? "none" : n.next.name;
}
function main() {
  const arena = new Arena<Node>();
  const c = arena.alloc(new Node("c", null));
  const b = arena.alloc(new Node("b", c));
  const a = arena.alloc(new Node("a", b));
  a.name = "A";
  console.log(following(a), following(b));
  console.log(c.name, following(c), a.name, arena.length);
}
// case: arena_drops_together
// expect: made 3
// expect: end of scope
// expect: drop c after b
// expect: drop b after a
// expect: drop a after nothing
// expect: after
// Nothing is dropped until the arena is, and then every value is, newest first, so a value's
// disposer still finds the older values it points at.
class Res<A extends Lifetime> {
  name: string;
  before: Ref<Res<A>, A> | null;
  constructor(name: string, before: Ref<Res<A>, A> | null) { this.name = name; this.before = before; }
  [Symbol.dispose]() { console.log("drop", this.name, "after", this.before === null ? "nothing" : this.before.name); }
}
function run() {
  const arena = new Arena<Res>();
  const a = arena.alloc(new Res("a", null));
  const b = arena.alloc(new Res("b", a));
  arena.alloc(new Res("c", b));
  console.log("made", arena.length);
  console.log("end of scope");
}
function main() {
  run();
  console.log("after");
}
// case: arena_older_points_at_newer
// error: keeping references through the reference 'a' is not supported yet
// An arena drops newest first, which is sound only while a value can't be pointed at a newer one.
class Node<A extends Lifetime> {
  name: string;
  next: Ref<Node<A>, A> | null;
  constructor(name: string, next: Ref<Node<A>, A> | null) { this.name = name; this.next = next; }
}
function main() {
  const arena = new Arena<Node>();
  const a = arena.alloc(new Node("a", null));
  const b = arena.alloc(new Node("b", null));
  a.next = b;
  console.log(a.name);
}
// case: arena_in_function
// expect: 6
// An arena lent to a function gives references the caller's arena keeps alive.
type Point = { x: i64; y: i64 };
function add<A extends Lifetime>(arena: Ref<Arena<Point>, A>, x: i64, y: i64): Mut<Point, A> {
  return arena.alloc({ x, y });
}
function main() {
  const arena = new Arena<Point>();
  const p = add(arena, 1, 2);
  const q = add(arena, 3, 4);
  p.x = q.x - 1;
  console.log(p.x + q.y);
}
// case: arena_moved_while_lent
// error: cannot move 'arena'
function keep(a: Arena<string>) {}
function main() {
  const arena = new Arena<string>();
  const s = arena.alloc("a");
  keep(arena);
  console.log(s);
}
// case: arena_reference_outlives
// error: can't return a reference to 'arena', which belongs to this function and is gone once it returns
function fresh<A extends Lifetime>(s: Ref<string, A>): Mut<string, A> {
  const arena = new Arena<string>();
  return arena.alloc(s.clone());
}
function main() {
  const s = "a";
  console.log(fresh(s));
}
// case: arena_stays_on_one_thread
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Cell<usize>'
async function work(arena: Arena<i64>): Promise<void> { console.log(arena.length); }
async function main() {
  const arena = new Arena<i64>();
  await spawn(work(arena));
}
// case: arena_shared
// error: a 'shared' value is used from many threads at once, so it can't hold a 'Cell<usize>'
function main() {
  const state = shared({ arena: new Arena<i64>() });
  console.log(state.arena.length);
}
// case: arena_receiver_is_stds
// error: receivers other than 'this: Ref<this>', 'this: Mut<this>' and 'this: Own<this>' are not supported yet
class Counter {
  n: i64 = 0;
  bump(this: Cell<this>) { this.n++; }
}
function main() {
  const c = new Counter();
  c.bump();
}
