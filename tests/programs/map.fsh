// case: map_async
// expect: a x1
// expect: 1
// A Map held across an await and moved into a spawned task.
async function main() {
  let m = new Map([["a", "x" + 1]]);
  for (const [k, v] of m) {
    await sleep(1);
    console.log(k, v);
  }
  const h = spawn(async () => m.size);
  const n = await h;
  console.log(n);
}
// case: map_const_set
// error: cannot add to 'm' because it is a constant
function main() { const m = new Map<string, i64>(); m.set("a", 1); }
// case: map_dyn_change
// error: 'set' changes its Map, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasMap { m: Map<string, i64>; }
class H { m: Map<string, i64> = new Map(); }
function main() { let h: Dyn<HasMap> = new H(); h.m.set("a", 1); console.log(h.m.size); }
// case: map_dyn_nested
// error: 'set' changes its Map, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
function main() { let h: Dyn<HasInner> = new H(); h.inner.m.set("a", 1); console.log(h.inner.m.size); }
// case: map_edges
// expect: 0 0
// expect: x x
// expect: y y
// expect: 1
// A typed Map made from an empty array, a Set's forEach given each member twice, and a key
// made before a panicking value is dropped.
function main() {
  const m = new Map<string, i64>([]);
  const s = new Set<i64>([]);
  console.log(m.size, s.size);
  const t = new Set(["x", "y"]);
  t.forEach((a, b) => console.log(a, b));
  let n = new Map<string, i64>();
  n.set("k" + 1, 1);
  console.log(n.size);
}
// case: map_foreach_change
// error: cannot mutably lend 'm' while 'm' is lent to 'forEach' for this call
function main() { let m = new Map<string, i64>(); m.set("a", 1); m.forEach((v, k) => { m.delete(k); }); }
// case: map_from
// expect: 2 3 a,b1 2 x,y1 2
// expect: 1 v1
// expect: 2 1
// new Map(entries) and new Set(xs) take over an array's pairs or members, a later key replacing
// an earlier, with their types written, expected or taken from the array.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function f<T>(x: T): Map<string, T> { return new Map([["k", x]]); }
function main() {
  const m = new Map([["a", 1], ["b" + 1, 2], ["a", 3]]);
  const s = new Set(["x", "y" + 1, "x"]);
  const ps = new Map<string, P>([["p", new P(1)], ["p", new P(2)]]);
  const g = ps.get("p");
  console.log(m.size, m.get("a"), m.keys().join(), s.size, s.values().join(), g === null ? 0 : g.n);
  const k = f("v" + 1);
  console.log(k.size, k.get("k"));
  const ns: i64[] = [3, 1, 3];
  const unique = new Set(ns);
  const lists: Map<string, string[]> = new Map([["k", ["v" + 1]]]);
  console.log(unique.size, lists.size);
}
// case: map_from_numbers
// error: 'new Map' takes an array of key and value pairs, as in 'new Map([["a", 1]])', not 'i64[]'
function main() { const m = new Map([1, 2]); }
// case: map_generic
// expect: 2 2 q
// expect: 2
// Map and Set types inferred in generic calls, and set chained through a Mut borrow.
function count<K>(m: Ref<Map<K, i64>>): usize { return m.size; }
function members<T>(s: Ref<Set<T>>): T[] { return s.values(); }
function fill(m: Mut<Map<string, i64>>) { m.set("a", 1).set("b", 2); }
function main() {
  let m = new Map<u8, i64>();
  m.set(1, 1);
  m.set(255, 2);
  let s = new Set<string>();
  s.add("q");
  console.log(count(m), m.get(255), members(s).join());
  let n = new Map<string, i64>();
  fill(n);
  console.log(n.size);
}
// case: map_instances
// expect: 0 50 102 50
// expect: 7 0,1,2,3,4,5,6 999
// expect: a1,b
// Maps owning instances and arrays: replaced, deleted and cleared values are dropped, a clone is
// deep, and the table grows and compacts without losing order.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let ps = new Map<i64, P>();
  for (let i = 0; i < 100; i++) ps.set(i, new P(i * 2));
  for (let i = 0; i < 100; i += 2) ps.delete(i);
  const copy = ps.clone();
  ps.clear();
  const got = copy.get(51);
  console.log(ps.size, copy.size, got === null ? -1 : got.n, copy.keys().length);
  for (let i = 0; i < 1000; i++) ps.set(i % 7, new P(i));
  const last = ps.get(5);
  console.log(ps.size, ps.keys().join(), last === null ? -1 : last.n);
  let lists = new Map<i64, string[]>();
  lists.set(1, ["a" + 1]);
  lists.update(1, (v) => { v.push("b"); });
  const v = lists.get(1);
  console.log(v === null ? "" : v.join());
}
// case: map_key_float
// error: a 'Set' holds strings or integers, or unions of their literals, not 'number'
function main() { const s = new Set<number>(); }
// case: map_key_object
// error: a 'Map' is keyed by strings or integers, or unions of their literals, not 'P'; objects as keys aren't supported yet
class P {} function main() { const m = new Map<P, i64>(); }
// case: map_keys
// expect: 3 2 false true n,s
// expect: 2 2
// Keys of literal unions, enum members and sized integers.
type Dir = "n" | "s";
enum E { A, B }
function main() {
  let m = new Map<Dir, i64>();
  m.set("n", 1);
  m.set("s", 2);
  m.set("n", 3);
  let e = new Set<E>();
  e.add(E.B);
  console.log(m.get("n"), m.size, e.has(E.A), e.has(E.B), m.keys().join());
  let bytes = new Map<u8, i64>();
  bytes.set(1, 1);
  bytes.set(255, 2);
  console.log(bytes.size, bytes.get(255));
}
// case: map_loop_change
// error: cannot change 'm' while a 'for...of' loop is reading 'm'
function main() { let m = new Map<string, i64>(); m.set("a", 1); for (const [k, v] of m) m.set(k, v + 1); }
// case: map_loops
// expect: a 1
// expect: c 3
// expect: b 4
// expect: a c b
// expect: 3 1 2
// expect: t 1
// expect: 3
// expect: p!
// expect: q!
// for...of over a Map's entries and a Set's members in insertion order, through a Ref, in a
// generator, and over a Map made for the loop.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(m: Ref<Map<string, i64>>): i64 {
  let t = 0;
  for (const [_, v] of m) t += v;
  return t;
}
function* marked(s: Ref<Set<string>>): Generator<string> {
  for (const x of s) yield x + "!";
}
function main() {
  let m = new Map<string, P>();
  m.set("a", new P(1));
  m.set("b", new P(2));
  m.set("c", new P(3));
  m.delete("b");
  m.set("b", new P(4));
  for (const [k, v] of m) console.log(k, v.n);
  let keys: string[] = [];
  for (const e of m) keys.push(e[0]);
  console.log(keys.join(" "));
  let order: i64[] = [];
  for (const x of new Set([3, 1, 2])) order.push(x);
  console.log(order.join(" "));
  for (const [k, v] of new Map([["t", 1]])) console.log(k, v);
  console.log(sum(new Map([["a", 1], ["b", 2]])));
  const s = new Set(["p", "q"]);
  for (const y of marked(s)) console.log(y);
}
// case: map_methods
// expect: 3 10 2 null true false
// expect: true false 2
// expect: a,c,b2 10,3,20
// expect: false 103
// expect: a 10
// expect: c 103
// expect: b2 20
// expect: 2 true x,y 2
// Map and Set methods as JavaScript's behave, chaining through set and add, insertion order kept
// after deletes and re-sets.
function main() {
  let m = new Map<string, i64>();
  m.set("a", 1).set("b" + 2, 2);
  m.set("c", 3);
  m.set("a", 10);
  console.log(m.size, m.get("a"), m.get("b2"), m.get("zz"), m.has("c"), m.has("d"));
  console.log(m.delete("b2"), m.delete("b2"), m.size);
  m.set("b2", 20);
  console.log(m.keys().join(), m.values().join());
  m.update("c", (v) => { v = v + 100; });
  console.log(m.update("nope", (v) => { v = 0; }), m.get("c"));
  m.forEach((v, k) => console.log(k, v));
  let s = new Set<string>();
  s.add("x").add("y").add("x");
  console.log(s.size, s.has("x"), s.values().join(), s.entries().length);
}
// case: map_moved_source
// error: 'xs.length' can't be used here because 'xs' was moved
function main() { let xs = ["a", "b"]; const s = new Set(xs); console.log(xs.length); }
// case: map_no_types
// error: 'new Map()' needs its key and value types, as in 'new Map<string, i64>()'
function main() { const m = new Map(); }
// case: map_print
// expect: Map(0) {}
function main() { const m = new Map<string, i64>(); console.log(m); }
// case: map_ref_set
// error: cannot add to 'm' because 'm' is a shared reference ('Ref'), which only reads
function f(m: Ref<Map<string, i64>>) { m.set("a", 1); } function main() {}
// case: map_ref_values
// error: maps of references are not supported yet
function f(m: Map<string, Ref<string>>) {} function main() {}
// case: map_set_held
// error: cannot use 'm' while 'r' borrows 'm' mutably and is used later
function main() { let m = new Map<string, i64>(); let r = m.set("a", 1); m.clear(); r.set("b", 2); }
// case: map_shared
// expect: 2 a,b
// A Map in a shared value, changed from another task through update.
class S { m: Map<string, i64> = new Map(); }
async function main() {
  const s = shared(new S());
  s.update((x) => { x.m.set("a", 1); });
  const c = s.clone();
  const t = spawn(async () => { c.update((x) => { x.m.set("b", 2); }); });
  await t;
  s.update((x) => { console.log(x.m.size, x.m.keys().join()); });
}
// case: map_size_assign
// error: a Map's or a Set's 'size' can't be set; use 'delete' or 'clear' to remove entries
function main() { let m = new Map<string, i64>(); m.size = 3; }
// case: map_temporary_set
// error: 'set' changes its Map, so call it on a variable or a field
function main() { const m = new Map<string, i64>().set("a", 1); }
// case: map_threads
// expect: 0
// Maps made at once on many worker threads all hash with one seed.
async function work(n: i64): Promise<i64> {
  let m = new Map<i64, i64>();
  for (let i = 0; i < 64; i++) m.set(i * 1000 + n, i);
  await yieldNow();
  let lost = 0;
  for (let i = 0; i < 64; i++) if (!m.has(i * 1000 + n)) lost++;
  return lost;
}
async function main() {
  let hs: JoinHandle<i64>[] = [];
  for (let n = 0; n < 16; n++) hs.push(spawn(work(n)));
  let lost = 0;
  while (hs.length > 0) { const h = hs.pop()!; const l = await h; lost += l; }
  console.log(lost);
}
// case: map_unknown_method
// error: 'Map' has no method 'getOrInsert' yet
function main() { let m = new Map<string, i64>(); m.getOrInsert("a", 1); }
