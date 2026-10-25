// case: array_at
// expect: 5 7 7 null 5 null
// expect: null null
// expect: 99 2
// expect: a1
// at counts back from the end for a negative position, gives nothing outside the array, and a
// clone of an instance element.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const ns = [5, 6, 7];
  console.log(ns.at(0), ns.at(-1), ns.at(2), ns.at(3), ns.at(-3), ns.at(-4));
  const empty: i64[] = [];
  console.log(empty.at(0), empty.at(-1));
  let ps = [new P(1), new P(2)];
  const last = ps.at(-1);
  if (last !== null) {
    let mine = last;
    mine.n = 99;
    console.log(mine.n, ps[1].n);
  }
  const ws = ["a" + 1, "b"];
  const w = ws.at(-2);
  if (w !== null) console.log(w);
  ws.at(0);
}
// case: array_at_handle
// error: 'at' gives clones of the array's elements, and can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself
async function main(): Promise<void> {
  let hs = [spawn(async () => "x" + 1)];
  const h = hs.at(0);
  if (h !== null) { const a = await h; console.log(a); }
  const o = hs.pop();
  if (o !== null) { const b = await o; console.log(b); }
}
// case: array_bounds
function main() {
  const words = ["a" + 1, "b"];
  const i: usize = 2;
  console.log(words[1]);
  console.log(words[i]);
}
// expect: b
// panic: index out of bounds: the len is 2 but the index is 2
// case: array_callback_alias
// error: cannot mutably lend 'xs' while 'xs' is lent to 'map' for this call
function main() { let xs = [1, 2]; const ys = xs.map((x) => { xs.push(x); return x; }); console.log(ys.length); }
// case: array_callback_block
// expect: 1 20 3 3
// A block-bodied callback may return early and change what it captures.
function main() {
  let count = 0;
  const xs = [1, 2, 3];
  const ys = xs.map((x) => { count += 1; if (x === 2) { return 20; } return x; });
  console.log(ys[0], ys[1], ys[2], count);
}
// case: array_callback_named
// expect: 1
function double(x: i64): i64 { return x * 2; }
function main() { const xs = [1]; console.log(xs.map(double).length); }
// case: array_callback_once
// error: 'map' calls its callback once per element, but this closure moves 'owned' out, so it can run only once
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function take(p: P): string { return p.name; }
function main() {
  const owned = new P(4, "own" + 1);
  const xs = [1, 2, 3];
  const r = xs.map((x) => take(owned));
  console.log(r.join());
}
// case: array_callback_receivers
// expect: a1! true
// expect: 6 3
// A temporary array and one borrowed through a reference both work.
function make(): string[] { return ["a" + 1, "b" + 2]; }
function total(xs: Ref<i64[]>): i64 { return xs.reduce((a, x) => a + x, 0); }
function main() {
  console.log(make().map((s) => s + "!")[0], make().some((s) => s === "b2"));
  const xs = [1, 2, 3];
  console.log(total(xs), xs.length);
}
// case: array_callback_third
// error: JavaScript's last argument, the array, isn't passed
function main() { const xs = [1]; xs.map((x, i, all) => x); }
// case: array_callback_truthy
// error: 'filter''s callback has to give a 'boolean', since Fish has no truthiness
function main() { const xs = [1]; console.log(xs.filter((x) => x).length); }
// case: array_callbacks
// expect: 2 8 4
// expect: 32
// expect: true true false
// expect: 2 4
// expect: 10 24
// expect: 3
// expect: a1! b2!
// expect: 99 2
// expect: 1
// expect: 3
// expect: y2? x1y2 true
// The callback methods over numbers, strings and instances: elements reach the callback as
// copies or shared borrows, filter and find give clones, and reduce starts from its initial
// value or the first element.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const xs = [1, 2, 3, 4];
  const doubled = xs.map((x) => x * 2);
  console.log(doubled[0], doubled[3], doubled.length);
  const withIndex = xs.map((x, i) => x * 10 + i);
  console.log(withIndex[2]);
  console.log(xs.some((x) => x > 3), xs.every((x) => x > 0), xs.every((x) => x > 1));
  const evens = xs.filter((x) => x % 2 === 0);
  console.log(evens.length, evens[1]);
  console.log(xs.reduce((a, x) => a + x, 0), xs.reduce((a, x) => a * x));
  const found = xs.find((x) => x > 2);
  if (found !== null) console.log(found);
  const ps = [new P(1, "a" + 1), new P(2, "b" + 2)];
  const names = ps.map((p) => p.name + "!");
  console.log(names[0], names[1]);
  let big = ps.filter((p) => p.n > 1);
  big[0].n = 99;
  console.log(big[0].n, ps[1].n);
  const hit = ps.find((p) => p.name === "a1");
  if (hit !== null) console.log(hit.n);
  const total = ps.reduce((a, p) => a + p.n, 0);
  console.log(total);
  const words = ["x" + 1, "y" + 2];
  console.log(words.map((w) => w + "?")[1], words.reduce((a, w) => a + w, ""), words.some((w) => w === "y2"));
}
// case: array_capacity
// expect: 0 0
// expect: 100 100 100
// expect: true
// expect: 6 6 s5
// expect: 0
// expect: 3 4
// reserve makes room ahead of pushes, capacity reads it, and shrinkToFit gives the spare room back.
function main() {
  let xs: string[] = [];
  console.log(xs.capacity, xs.length);
  xs.reserve(100);
  const room = xs.capacity;
  for (let i = 0; i < 100; i++) xs.push("s" + i);
  console.log(room, xs.capacity, xs.length);
  xs.push("more");
  console.log(xs.capacity > 100);
  xs.reserve(0);
  for (let i = 0; i < 95; i++) xs.pop();
  xs.shrinkToFit();
  console.log(xs.capacity, xs.length, xs[5]);
  let ys = [1, 2];
  ys.pop();
  ys.pop();
  ys.shrinkToFit();
  console.log(ys.capacity);
  ys.push(3);
  console.log(ys[0], ys.capacity);
}
// case: array_reserve_while_element_borrowed
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
function main() {
  let xs = ["a" + "1", "b" + "2"];
  const r: Ref<string> = xs[0];
  xs.reserve(100);
  console.log(r);
}
// case: array_reserve_in_its_own_loop
// error: cannot change 'xs' while a 'for...of' loop is reading 'xs'
function main() {
  let xs = ["a" + "1", "b" + "2"];
  for (const x of xs) { xs.reserve(100); console.log(x); }
}
// case: array_reserve_through_ref
// error: cannot reserve 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function f(xs: Ref<i64[]>) { xs.reserve(1); }
function main() { let xs = [1]; f(xs); }
// case: array_shrink_through_ref
// error: cannot shrinkToFit 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function f(xs: Ref<i64[]>) { xs.shrinkToFit(); }
function main() { let xs = [1]; f(xs); }
// case: array_reserve_without_count
// error: 'reserve' takes a count of elements to make room for
function main() { let xs = [1]; xs.reserve(); }
// case: array_capacity_of_shared_copy
// error: a shared value's array is read as a copy, so read its capacity inside 'st.update(...)'
type State = { names: string[]; n: i64 };
async function main() {
  const st = shared<State>({ names: [], n: 0 });
  st.update((s) => { s.names.push("a" + ""); s.names.reserve(16); s.n = 5; });
  console.log(st.names.length, st.names.capacity, st.n);
}
// case: array_capacity_set
// error: an array's 'capacity' can't be set; use 'reserve(n)' to make room
function main() { let xs = [1]; xs.capacity = 9; }
// case: array_change
type P = { name: string; n: i64 };

function fill(xs: Mut<string[]>, k: i64) {
  for (let i = 0; i < k; i++) xs.push("w" + i);
}

class Stack {
  items: P[];
  constructor() {
    this.items = [];
  }
  add(this: Mut<this>, p: P) {
    this.items.push(p);
  }
}

function main() {
  let nums: i64[] = [];
  for (let i = 0; i < 10; i++) nums.push(i * i);
  nums[0] = 100;
  console.log(nums.length, nums[0], nums[9]);
  let words = ["a" + 1];
  fill(words, 5);
  words[1] = "x" + 9;
  console.log(words.length, words[0], words[1], words[5]);
  let people: P[] = [{ name: "ann" + 1, n: 1 }];
  people[0].name = "bo" + 2;
  people[0].n += 5;
  people.push({ name: "cy", n: 3 });
  console.log(people[0].name, people[0].n, people[1].name);
  let s = new Stack();
  s.add({ name: "z" + 1, n: 0 });
  console.log(s.items.length, s.items[0].name);
  let out = "";
  while (words.length > 0) {
    const w = words.pop();
    if (w !== null) out += w + ",";
  }
  console.log(out, words.length);
  people.pop();
  const gone = nums.pop();
  console.log(gone, people.length);
  let grid: i64[][] = [[1], [2, 3]];
  grid[1].push(4);
  grid.push([5]);
  console.log(grid[1][2], grid[2][0], grid.length);
}
// expect: 10 100 81
// expect: 6 a1 x9 w4
// expect: bo2 6 cy
// expect: 1 z1
// expect: w4,w3,w2,w1,x9,a1, 0
// expect: 81 1
// expect: 4 5 3
// case: array_concat_flat
// expect: 3 0 0 -1 -1 4 4
// expect: a1,b,c3,z9 2 1 a1,b
// expect: 3 10 1 3
// expect: 1,2,3 3
// expect: a1-b2-c
// lastIndexOf searching back from a position, concat and flat giving clones while the arrays
// they read stay usable.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function more(): string[] { return ["z" + 9]; }
function main() {
  const xs = [1, 2, 3, 2, 1];
  console.log(xs.lastIndexOf(2), xs.lastIndexOf(1, 3), xs.lastIndexOf(1, -2), xs.lastIndexOf(9), xs.lastIndexOf(3, -9), xs.lastIndexOf(1, 99), xs.lastIndexOf(1, -1));
  const a = ["a" + 1, "b"];
  const b = ["c" + 3];
  const c = a.concat(b, more(), []);
  console.log(c.join(), a.length, b.length, a.concat().join());
  let ps = [new P(1)];
  const qs = [new P(2), new P(3)];
  let all = ps.concat(qs);
  all[0].n = 10;
  console.log(all.length, all[0].n, ps[0].n, qs[1].n);
  const grid: i64[][] = [[1, 2], [], [3]];
  console.log(grid.flat().join(), grid.length);
  const words = [["a" + 1], ["b" + 2, "c"]];
  console.log(words.flat().join("-"));
}
// case: array_concat_literals
// expect: a,b,a 1,2,3 0
// concat takes literals of the element type, sized numbers and literal unions too.
type L = "a" | "b"; function main() { const xs: L[] = ["a"]; const ns: i32[] = [1]; console.log(xs.concat(["b", "a"]).join(), ns.concat([2, 3]).join(), ns.lastIndexOf(1)); }
// case: array_concat_value
// error: 'concat' joins arrays of the same element type, 'i64[]', not 'i64'; to add single values, push them
function main() { const xs = [1]; console.log(xs.concat(2).length); }
// case: array_const
function main() {
  const xs = [{ n: 1 }];
  xs[0].n = 2;
}
// error: cannot assign to 'xs[...].n' because 'xs' is a constant
// case: array_const_push
function main() {
  const xs = [1];
  xs.push(2);
}
// error: cannot push to 'xs' because it is a constant
// case: array_constructor_bare
// error: 'new Array(n)' would hold n empty slots, which Fish has no way to make; fill it, as in 'new Array(n).fill(0)', or use 'Array.from({ length: n }, (_, i) => ...)'
function main() { const xs = new Array(3); }
// case: array_constructor_empty
// error: 'new Array()' is an empty array; write '[]', with its type where it can't be inferred, as in 'const xs: string[] = []'
function main() { const xs = new Array<string>(); }
// case: array_constructor_fill_generator
// error: 'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once
function* gen(): Generator<string> { yield "a" + 1; }
function main() { const a = new Array(2).fill(gen()); }
// case: array_constructor_fill_generic
// error: 'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once
function* gen(): Generator<string> { yield "a" + 1; }
function rep<T>(x: T): T[] { return new Array(2).fill(x); }
function main() { console.log(rep(gen()).length); }
// case: array_constructor_fill_ref
// error: 'new Array(n).fill(x)' can't be made from this value: arrays of references are not supported yet
function f(s: Ref<string>): string[] { return new Array(2).fill(s); }
function main() { console.log(f("a" + 1).join()); }
// case: array_constructor_generic
// expect: a1!,b2! a1,b2 2
// expect: 0 0 2 1
// expect: 0,0,0 0,1,2 0,1,2
// Array.from over a generator in generic code, Array.of with a written element type, and
// lengths given as a usize or by shorthand.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<string> { yield "a" + 1; yield "b" + 2; }
function all(g: Generator<string>): string[] { return Array.from(g, (s) => s + "!"); }
function allT<T>(g: Generator<T>): T[] { return Array.from(g); }
function main() {
  const g = gen();
  console.log(all(gen()).join(), allT(gen()).join(), allT<string>(g).length);
  const o = Array.of<i64 | null>(null, 1);
  const u = Array.of<u8>(1, 2);
  const w: u8 = u[0];
  console.log(Array.of<P>().length, Array.of<i64>().length, o.length, w);
  const xs = [1, 2, 3];
  const length = 3;
  console.log(new Array(xs.length).fill(0).join(), Array.from({ length: xs.length }, (_, i) => i).join(), Array.from({ length }, (_, i) => i).join());
}
// case: array_constructor_negative
// panic: array_constructor_negative.fsh:5:23:
// panic: invalid array length
function main() {
  const n = -1;
  const a = new Array(n).fill("x" + 1);
  console.log(a.length);
}
// case: array_constructor_nomap
// error: 'Array.from({ length: n })' alone would hold n undefined values, which Fish has no way to make; give it a function, as in 'Array.from({ length: n }, (_, i) => i)'
function main() { console.log(Array.from({ length: 3 }).length); }
// case: array_constructor_number
// error: 'Array.from' makes an array from an array, a string, a generator or '{ length: n }', not 'i64'
function main() { console.log(Array.from(5).length); }
// case: array_constructor_one
// error: 'new Array(x)' of one value that isn't a length makes '[x]'; write 'Array.of(x)' or '[x]'
function main() { const xs = new Array("a"); }
// case: array_constructor_two
// error: 'new Array(a, b)' makes an array of its arguments; write 'Array.of(a, b)' or '[a, b]'
function main() { const xs = new Array(1, 2); }
// case: array_constructors
// expect: 1,2,3 1 0
// expect: 0,0,0 n1,n1 0
// expect: 9 1
// expect: a|€|😀 a0,b1
// expect: 2 10,20
// expect: 0,1,4,9 2,3
// Array.of, new Array(n).fill(x), and Array.from over arrays (clones), strings, generators and
// { length }, with and without a map function.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<P> { yield new P(1); yield new P(2); }
function main() {
  console.log(Array.of(1, 2, 3).join(), Array.of("a" + 1).length, Array.of<string>().length);
  const zeros = new Array(3).fill(0);
  const names = new Array<string>(2).fill("n" + 1);
  console.log(zeros.join(), names.join(), new Array(0).fill(5).length);
  let ps = [new P(1), new P(2)];
  let copy = Array.from(ps);
  copy[0].n = 9;
  console.log(copy[0].n, ps[0].n);
  console.log(Array.from("a€😀").join("|"), Array.from("ab", (c, i) => c + i).join());
  console.log(Array.from(gen()).length, Array.from(gen(), (p) => p.n * 10).join());
  console.log(Array.from({ length: 4 }, (_, i) => i * i).join(), Array.from([1, 2], (x) => x + 1).join());
}
// case: array_dyn_change
// error: 'push' changes its array, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasXs { xs: i64[]; }
class H { xs: i64[] = []; }
function k(d: Mut<Dyn<HasXs>>) { d.xs.push(2); console.log(d.xs.length); }
function main() { let h: Dyn<HasXs> = new H(); k(h); console.log(h.xs.length); }
// case: array_element_lent
type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  const r: Ref<Q> = xs[0];
  xs.push({ n: 2 });
  console.log(r.n);
}
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
// case: array_element_move
type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  take(xs[0]);
}
// error: 'xs[0]' can't be moved out of its array; use 'xs[0].clone()' to take a copy, or 'pop()' to take the last element out
// case: array_element_type
function main() {
  const xs: u8[] = [1, 300];
}
// error: '300' doesn't fit in 'u8'
// case: array_empty_untyped
function main() {
  let xs = [];
}
// error: an empty array needs a type to say what it will hold, like 'let xs: string[] = []'
// case: array_filter_dyn_option
// expect: 1
// filter over Options of Dyns gives copies, as over Dyns.
interface Shape { area(): i64; }
class Sq { s: i64; constructor(s: i64) { this.s = s; } area(): i64 { return this.s * this.s; } }
function main() {
  const d: Dyn<Shape> = new Sq(3);
  const ds: (Dyn<Shape> | null)[] = [d, null];
  console.log(ds.filter((x) => x !== null).length);
}
// case: array_find_handle
// error: 'find' gives clones of the array's elements, and can't clone a JoinHandle, or a value holding one: only one place can await a task's result, so pass the handle itself
async function main(): Promise<void> {
  let hs = [spawn(async () => "x" + 1)];
  const h = hs.find((x) => true);
  if (h !== null) { const a = await h; console.log(a); }
  const o = hs.pop();
  if (o !== null) { const b = await o; console.log(b); }
}
// case: array_flat_depth
// error: 'flat' flattens one level so far, so it takes no depth
function main() { const xs: i64[][] = [[1]]; console.log(xs.flat(2).length); }
// case: array_flatmap_panic
// panic: attempt to divide by zero
// A panicking flatMap callback drops what has been gathered.
function main() {
  const xs = ["a" + 1, "b" + 2, "c" + 3];
  const cap = "cap" + 1;
  const ys = xs.flatMap((x) => { const z = 10 / (x === "c3" ? 0 : 1); return [x + cap, x]; });
  console.log(ys.length);
}
// case: array_flatmap_value
// error: 'flatMap''s callback gives an array for each element
function main() { const xs = [1]; console.log(xs.flatMap((x) => x).length); }
// case: array_for_of
type P = { name: string; tags: string[] };

function names(people: Ref<P[]>): string {
  let out = "";
  for (const p of people) {
    out += p.name + ":";
    for (const t of p.tags) {
      if (t === "skip") continue;
      if (t === "stop") break;
      out += t + ",";
    }
    out += ";";
  }
  return out;
}

function find(xs: Ref<string[]>, want: string): i64 {
  let i = 0;
  for (const x of xs) {
    const seen = x + "!";
    if (x === want) return i;
    i++;
  }
  return -1;
}

function make(): string[] {
  return ["m" + 1, "m" + 2];
}

function check(xs: Ref<i64[]>): i64 throws string {
  let t = 0;
  for (const x of xs) {
    const label = "x" + x;
    if (x > 2) throw "too big " + label;
    t += x;
  }
  return t;
}

function main() {
  const nums = [1, 2, 3];
  let sum = 0;
  for (const n of nums) sum += n;
  const people: P[] = [{ name: "ann" + 1, tags: ["a", "skip", "b", "stop", "c"] }, { name: "bo", tags: [] }];
  console.log(sum, names(people), find(make(), "m2"), find(make(), "zz"));
  for (const w of make()) console.log(w);
  try {
    console.log(check([1, 2]), check(nums));
  } catch (e) {
    console.log(e);
  }
  let words = ["x" + 1, "y"];
  for (let w of words) {
    console.log(w.length);
  }
  words.push("z");
  console.log(words.length);
}
// expect: 6 ann1:a,b,;bo:; 1 -1
// expect: m1
// expect: m2
// expect: too big x3
// expect: 2
// expect: 1
// expect: 3
// case: array_for_of_push
function main() {
  let xs = [1, 2];
  for (const x of xs) xs.push(x);
}
// error: cannot change 'xs' while a 'for...of' loop is reading 'xs'
// case: array_foreach_flatmap
// expect: 1 0
// expect: 2 1
// expect: 3 2
// expect: 6
// expect: 1,10,2,20,3,30
// expect: a1 a1! 0 b2 b2! 1
// expect: x1,x1x1,y2,y2y2 1 -1 2
// expect: 0
// forEach runs its callback for each element and drops what it gives; flatMap moves the arrays
// its callback gives into one; findIndex stops at the first hit.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const xs = [1, 2, 3];
  let total = 0;
  xs.forEach((x) => { total += x; });
  xs.forEach((x, i) => console.log(x, i));
  console.log(total);
  const pairs = xs.flatMap((x) => [x, x * 10]);
  console.log(pairs.join());
  const words = ["a" + 1, "b" + 2];
  console.log(words.flatMap((w, i) => [w, w + "!", String(i)]).join(" "));
  const ps = [new P(1, "x" + 1), new P(2, "y" + 2)];
  const names = ps.flatMap((p) => [p.name, p.name + p.name]);
  console.log(names.join(), ps.findIndex((p) => p.n === 2), ps.findIndex((p) => p.n === 9), xs.findIndex((x, i) => i === 2));
  const none = xs.flatMap((x) => { const e: i64[] = []; return e; });
  console.log(none.length);
  ps.forEach((p) => p.name + "?");
}
// case: array_from_typeargs
// error: 'Array.from' takes no type argument; its element type is what the source holds, or what the map function gives
function main() { const xs = Array.from<i64>(["a"]); }
// case: array_generic_infer
function n<T>(xs: Ref<T[]>): usize { return xs.length; }
function firstOf<T>(xs: Array<T>): usize { return xs.length; }
function main() {
  const a = ["x", "y"];
  console.log(n(a), firstOf([1, 2, 3]));
}
// expect: 2 3
// case: array_includes_nan
// expect: true -1 true 2 false true
// includes finds NaN as JavaScript's SameValueZero does, and indexOf never does; includes takes
// a position to start from.
function main() {
  const nan = 0.0 / 0.0;
  const fs = [1.0, nan, -0.0];
  console.log(fs.includes(nan), fs.indexOf(nan), fs.includes(0.0), fs.indexOf(0.0), fs.includes(1.0, 1), fs.includes(nan, -2));
}
// case: array_includes_objects
// error: 'includes' compares elements by value, which objects and instances can't do until they derive 'Eq'
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { const ps = [new P(1)]; console.log(ps.includes(new P(1))); }
// case: array_includes_sized
// expect: 1 true true
// expect: true
// expect: true true 0 true 1
// Number literals take the element type of a sized number array, as they do with ===.
function first() {
  const f32s: f32[] = [1.0, 2.5];
  const one: f32 = 1.0;
  console.log(f32s.indexOf(2.5), f32s.includes(one), one === 1.0);
  console.log(f32s.includes(2.5));
}
function second() {
  const f32s: f32[] = [1.0, 2.5];
  const one: f32 = 1.0;
  const is: i32[] = [1, 2];
  console.log(f32s.includes(one), one === 1.0, f32s.indexOf(one), is.includes(2), is.indexOf(2));
}
function main() { first(); second(); }
// case: array_index_grows
function grow(a: Mut<i64[]>): usize {
  for (let k = 0; k < 10; k++) a.push(k);
  return 0;
}
function main() {
  let a: i64[] = [1];
  a[grow(a)] = 7;
  console.log(a[0], a.length);
}
// expect: 7 11
// case: array_index_once
function f(): usize { console.log("f"); return 1; }
function main() {
  let a: i64[] = [10, 20, 30, 40];
  let j: usize = 0;
  a[j++] += 1;
  a[f()] += 5;
  a[j++]++;
  let i: usize = 2;
  a[i++] = i as i64;
  console.log(a[0], a[1], a[2], a[3], j, i);
}
// expect: f
// expect: 11 26 3 40 2 3
// case: array_indexof_type
// error: 'indexOf' can never find a 'string' among elements of type 'i64'
function main() { const xs = [1]; console.log(xs.indexOf("1")); }
// case: array_iterator_change
// error: cannot change 'xs' while a 'for...of' loop borrows 'xs' and is used later
function main() { let xs = [1, 2]; for (const [i, x] of xs.entries()) { xs.push(x); } }
// case: array_iterator_ref
// expect: 0 p1
// expect: 1 p2
// Iterating an array reached through a reference.
class P { s: string; constructor(n: i64) { this.s = "p" + n; } }
function iter(xs: Ref<P[]>): Generator<[i64, P]> { return xs.entries(); }
function main() {
  const ps = [new P(1), new P(2)];
  for (const [i, p] of iter(ps)) console.log(i, p.s);
}
// case: array_iterator_shadow
// expect: 1
// expect: 2
// A local may have any name without hiding the array iterators.
function main() {
  const __arrayValues = 5;
  const xs = [1, 2];
  for (const x of xs.values()) console.log(x);
}
// case: array_iterators
// expect: 0 a1
// expect: 1 b
// expect: 0 1
// expect: 1 2
// expect: 0,1,
// expect: a1
// expect: b
// expect: 0 a1
// expect: 2 2
// entries, keys and values iterate an array, in for...of with patterns and through next(),
// each element a clone.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const ws = ["a" + 1, "b"];
  for (const [i, w] of ws.entries()) console.log(i, w);
  let ps = [new P(1), new P(2)];
  for (const [i, p] of ps.entries()) console.log(i, p.n);
  let keys = "";
  for (const k of ps.keys()) keys += `${k},`;
  console.log(keys);
  for (const v of ws.values()) console.log(v);
  let it = ws.entries();
  const first = it.next();
  if (first.done === false) console.log(first.value[0], first.value[1]);
  console.log(ps.length, ws.length);
}
// case: array_join_objects
// error: 'join' writes each element as 'String(x)' does, which works for numbers, booleans and strings
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { const ps = [new P(1)]; console.log(ps.join()); }
// case: array_length_write
function main() {
  let a = [1, 2];
  a.length = 0;
}
// error: an array's 'length' can't be set; use 'pop()' to remove elements, or 'push' to add them
// case: array_lent_twice
type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  grow(xs, xs[0]);
}
// error: cannot use 'xs[0]' while 'xs' is lent mutably to 'grow' for this call
// case: array_map_async
// error: 'map' with a callback giving a Promise isn't supported yet
async function tick(n: i64): Promise<i64> { return n; }
async function main() {
  const xs = [1, 2];
  const ps = xs.map(async (x) => x + 1);
  console.log(ps.length);
}
// case: array_map_panic
// panic: attempt to divide by zero
// A callback panicking part way drops what map has built and what it captured.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  const ps = [new P(1, "a" + 1), new P(2, "b" + 2), new P(3, "c" + 3), new P(4, "d" + 4)];
  const names = ["a" + 1, "b" + 2, "c" + 3];
  const cap = "cap" + 1;
  const r = ps.map((p) => { const z = 10 / (p.n - 3); return p.name + "!"; }); console.log(r.length);
  console.log(cap);
}
// case: array_moved
type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  const ys = xs;
  console.log(xs.length);
}
// error: 'xs.length' can't be used here because 'xs' was moved
// case: array_mutators
// expect: 1 2,3,4,5
// expect: 9,8,2,3,4,5
// expect: 8,2 9,70,71,72,3,4,5
// expect: 4,5 9,70,71,72,3
// expect: 0 9,0,70,71,72,3 0 9,0,70,71,72,3 0
// expect: null 0
// expect: c3,b2,a1
// expect: c3,z0,z0
// expect: c3,z0,q1
// expect: c3 new1,mid2,q1
// expect: 2 2 5 6 2
// expect: 3,2,1 mid2,q1
// shift, unshift, splice, reverse and fill change the array as JavaScript does; elements moved
// out or replaced are dropped once, and fill stores a copy in each slot.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [1, 2, 3, 4, 5];
  const first = xs.shift();
  console.log(first, xs.join());
  xs.unshift(9, 8);
  console.log(xs.join());
  const gone = xs.splice(1, 2, 70, 71, 72);
  console.log(gone.join(), xs.join());
  console.log(xs.splice(-2).join(), xs.join());
  console.log(xs.splice(1, -5, 0).length, xs.join(), xs.splice(99, 1).length, xs.splice(0, 99).join(), xs.length);
  let empty: i64[] = [];
  console.log(empty.shift(), empty.length);
  let ws = ["a" + 1, "b" + 2, "c" + 3];
  ws.reverse();
  console.log(ws.join());
  ws.fill("z" + 0, 1);
  console.log(ws.join());
  ws.fill("q" + 1, -1, 99);
  ws.fill("never" + 1, 2, 1);
  console.log(ws.join());
  const s = ws.shift();
  ws.unshift("new" + 1);
  ws.splice(1, 1, "mid" + 2);
  console.log(s, ws.join());
  let ps = [new P(1), new P(2), new P(3)];
  const out = ps.splice(0, 2, new P(9));
  ps.reverse();
  ps.fill(new P(5), 0, 1);
  ps[1].n = 6;
  console.log(out.length, out[1].n, ps[0].n, ps[1].n, ps.length);
  let odd = [1, 2, 3];
  odd.reverse();
  ws.splice(0, 1);
  console.log(odd.join(), ws.join());
}
// case: array_nested_write
function zero(): usize { return 0; }
function main() {
  let g: i64[][] = [[1, 2], [3]];
  g[zero()][1] = 50;
  g[zero()][0] += 9;
  let w: string[][] = [["a"], ["b"]];
  w[zero()][0] = "z" + 1;
  w[zero()][0] += "!";
  console.log(g[0][1], g[0][0], w[0][0]);
}
// expect: 50 10 z1!
// case: array_of_functions
function main() {
  let fs: (() => i64)[] = [];
  fs.push(() => 2);
  print(fs.length, fs[0]())
}
// expect: 1 2
// case: array_of_mismatch
// error: type 'i64' is not assignable to type 'string'
function main() { const e = Array.of<string>(1, 2); }
// case: array_of_references
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
}
// error: arrays of references are not supported yet
// case: array_of_typed_function
// expect: 1 k1!
// Array.of with a function element type stores callables as an annotated literal does.
function main() {
  const k = "k" + 1;
  const fs = Array.of<() => string>(() => k + "!");
  console.log(fs.length, fs[0]());
}
// case: array_of_typed_ref
// error: arrays of references are not supported yet
class P { n: i64; constructor(n: i64) { this.n = n; } }
function keep(p: Ref<P>): i64 { const rs = Array.of<Ref<P>>(p); return 1; }
function main() { console.log(keep(new P(1))); }
// case: array_optional_literal
function main() {
  let o: string[] | null = [];
  if (o !== null) console.log(o.length);
  const p: i64[] | null = [1, 2];
  if (p !== null) console.log(p[1]);
}
// expect: 0
// expect: 2
// case: array_ownership
type P = { name: string; n: i64 };

function sum(xs: readonly i64[]): i64 {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

function rename(p: Mut<P>, to: string) {
  p.name = to;
}

function first(xs: Ref<P[]>): string {
  return xs[0].name;
}

function main() {
  let people: P[] = [{ name: "ann" + 1, n: 1 }, { name: "bo", n: 2 }];
  rename(people[1], "cy" + 3);
  const copy = people.clone();
  people[0].name = "zed";
  console.log(people[0].name, copy[0].name, copy[1].name, first(people), people[1].name);
  const nums = [1, 2, 3];
  console.log(sum(nums), nums.length);
  const moved = people;
  console.log(moved.length, moved[1].n);
  const name = moved[0].name;
  const n = moved[1].n;
  console.log(name, n);
}
// expect: zed ann1 cy3 zed cy3
// expect: 6 3
// expect: 2 2
// expect: zed 2
// case: array_print
// expect: [ 1, 2 ]
function main() {
  console.log([1, 2]);
}
// case: array_push_receiver_lent
function growG(g: Mut<i64[][]>): i64 {
  for (let k = 0; k < 9; k++) g.push([k]);
  return 5;
}
function main() {
  let g: i64[][] = [[1]];
  g[0].push(growG(g));
}
// error: cannot mutably lend 'g' while 'g[...]' is lent to 'push' for this call
// case: array_options_last_index_of
// expect: 1
// Searching an array of Options compares each element by value.
function main() { const os: (string | null)[] = [null, "a" + 1, null]; console.log(os.lastIndexOf("a" + 1)); }
// case: array_options_includes
// expect: true
// Searching an array of Options compares each element by value.
function main() { const os: (string | null)[] = [null, "a" + 1, null]; console.log(os.includes("a" + 1)); }
// case: array_reading
// expect: true false 1 3 -1 -1 2 -1
// expect: 1,2,3,2 1 - 2 - 3 - 2 true|false 1.5;2.25
// expect: a1b2c true 2
// expect: []
// expect: 2,3 3,2 1,2,3,2 0 1,2,3,2
// expect: 2 50 2
// includes, indexOf, join and slice as JavaScript gives them, positions counted from the end
// and clamped, with slices of instances as clones.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const xs = [1, 2, 3, 2];
  console.log(xs.includes(2), xs.includes(5), xs.indexOf(2), xs.indexOf(2, 2), xs.indexOf(9), xs.indexOf(1, -2), xs.indexOf(3, -9), xs.indexOf(1, 99));
  console.log(xs.join(), xs.join(" - "), [true, false].join("|"), [1.5, 2.25].join(";"));
  const words = ["a" + 1, "b" + 2, "c"];
  console.log(words.join(""), words.includes("b2"), words.indexOf("c"));
  const empty: string[] = [];
  console.log(`[${empty.join(",")}]`);
  const s1 = xs.slice(1, 3);
  const s2 = xs.slice(-2);
  const s3 = xs.slice();
  const s4 = xs.slice(3, 1);
  const s5 = xs.slice(-99, 99);
  console.log(s1.join(), s2.join(), s3.join(), s4.length, s5.join());
  let ps = [new P(1), new P(2), new P(3)];
  let some = ps.slice(1);
  some[0].n = 50;
  console.log(some.length, some[0].n, ps[1].n);
}
// case: array_readonly_param
function add(xs: readonly i64[]) {
  xs.push(1);
}

function main() {
  let a = [1];
  add(a);
}
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
// case: array_reduce_empty
// panic: reduce of empty array with no initial value
function main() { const xs: i64[] = []; console.log(xs.reduce((a, x) => a + x)); }
// case: array_ref_push
function look(xs: Ref<i64[]>) {
  xs.push(1);
}

function main() {
  let a = [1];
  look(a);
}
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
// case: array_reserve_constant
// error: cannot reserve 'xs' because it is a constant
function main() { const xs = [1]; xs.reserve(4); }
// case: array_reserve_negative
// panic: capacity overflow
function main() { let xs = [1]; xs.reserve(-1); }
// case: array_reverse_result
// error: 'reverse', which changes its array in place, does not return a value
function main() { let xs = [1, 2]; const ys = xs.reverse(); }
// case: array_sort
// expect: -5 1 9 10 100
// expect: -1.25 0.5 2.5
// expect: B a ab b1
// expect: 100 10 9 1 -5
// expect: ywxz
// expect: true 100000
// expect: 1,3,200
// sort with its default order for numbers and strings, and with comparators over numbers,
// instances (keeping equal elements in order) and unsigned bytes, on a large array too.
class P { n: i64; tag: string; constructor(n: i64, tag: string) { this.n = n; this.tag = tag; } }
function main() {
  let xs = [10, 9, 1, -5, 100];
  xs.sort();
  console.log(xs.join(" "));
  let fs = [2.5, -1.25, 0.5];
  fs.sort();
  console.log(fs.join(" "));
  let words = ["b" + 1, "a", "B", "ab"];
  words.sort();
  console.log(words.join(" "));
  xs.sort((a, b) => b - a);
  console.log(xs.join(" "));
  let ps = [new P(2, "x"), new P(1, "y"), new P(2, "z"), new P(1, "w")];
  ps.sort((a, b) => a.n - b.n);
  console.log(ps.map((p) => p.tag).join(""));
  let big: i64[] = [];
  for (let i = 0; i < 100000; i++) big.push((i * 7919) % 100003);
  big.sort();
  let ok = true;
  for (let i = 1; i < big.length; i++) if (big[i - 1] > big[i]) ok = false;
  console.log(ok, big.length);
  let us: u8[] = [3, 200, 1];
  us.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  console.log(us.join(","));
}
// case: array_sort_boolean
// error: a comparator gives a number
function main() { let xs = [2, 1]; xs.sort((a, b) => a > b); }
// case: array_sort_capture
// error: cannot change 'xs' while 'xs' is lent to 'sort' for this call
function main() { let xs = [2, 1]; xs.sort((a, b) => a - b + (xs.length as i64)); console.log(xs[0]); }
// case: array_sort_objects
// error: 'sort()' without a comparator orders numbers and strings, not 'P'
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { let ps = [new P(1)]; ps.sort(); }
// case: array_sort_panic
// panic: attempt to divide by zero
// A comparator panicking after the first merge pass leaves every element in the array, once.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  let qs = [new P(3, "c" + 3), new P(1, "a" + 1), new P(2, "b" + 2), new P(4, "d" + 4)];
  qs.sort((a, b) => {
    const bad = (a.n === 4 && b.n === 3) || (a.n === 3 && b.n === 4);
    const z = 10 / (bad ? 0 : 1);
    return a.n - b.n;
  });
  console.log(qs.length);
}
// case: array_sort_result
// error: 'sort', which sorts its array in place, does not return a value
function main() { let xs = [2, 1]; const r = xs.sort(); }
// case: array_sort_unsigned
// error: a comparator's number has to be able to be negative, and 'u8' can't
// An unsigned comparator can never be negative, so 'a' never comes first.
function main() {
  let us: u8[] = [3, 200, 1, 50];
  us.sort((a, b) => a - b);
  console.log(us.join(","));
  let vs: u64[] = [3, 2, 1];
  vs.sort((a, b) => a - b);
  console.log(vs.join(","));
}
// case: array_splice_constant
// error: cannot splice 'xs' because it is a constant
function main() { const xs = [1, 2]; xs.splice(0, 1); }
// case: array_concat_argument_panics
// panic: attempt to divide by zero
// A panicking argument drops what the call was already handed.
function boom(): string[] { const z = 1 / (0 * 1); return ["never" + z]; }
function boomS(): string { const z = 1 / (0 * 1); return "never" + z; }
function boomI(): i64 { return 1 / (0 * 1); }
function main() { const a = ["a" + 1, "b" + 2]; const c = a.concat(a, boom()); console.log(c.length); }
// case: array_unshift_argument_panics
// panic: attempt to divide by zero
// A panicking argument drops what the call was already handed.
function boom(): string[] { const z = 1 / (0 * 1); return ["never" + z]; }
function boomS(): string { const z = 1 / (0 * 1); return "never" + z; }
function boomI(): i64 { return 1 / (0 * 1); }
function main() { let a = ["a" + 1]; a.unshift("u" + 1, boomS()); console.log(a.length); }
// case: array_fill_argument_panics
// panic: attempt to divide by zero
// A panicking argument drops what the call was already handed.
function boom(): string[] { const z = 1 / (0 * 1); return ["never" + z]; }
function boomS(): string { const z = 1 / (0 * 1); return "never" + z; }
function boomI(): i64 { return 1 / (0 * 1); }
function main() { let a = ["a" + 1]; a.fill("u" + 1, boomI()); console.log(a.length); }
// case: array_values
type P = { name: string; n: i64 };

class Bag {
  items: string[];
  constructor(items: string[]) {
    this.items = items;
  }
}

function make(k: i64): string[] {
  return ["a" + k, "b" + k, "c"];
}

function total(xs: i64[]): i64 {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

function main() {
  const nums = [1, 2, 3];
  const small: u8[] = [7, 8];
  const words = make(1);
  const people: P[] = [{ name: "ann" + 1, n: 1 }, { name: "bo", n: 2 }];
  const grid = [[1, 2], [3, 4, 5]];
  const mixed = [1, "x" + 2];
  const empty: string[] = [];
  console.log(nums.length, nums[2], small[1], words[0], words[2], people[1].name, people[0].name, grid[1][2], grid.length);
  console.log(total(nums), total([10, 20]), empty.length, make(2)[1], words.length);
  const maybe: string[] | null = make(3);
  if (maybe !== null) console.log(maybe[0]);
  const bag = new Bag(make(4));
  console.log(bag.items[1], bag.items.length);
  const m = mixed[1];
  if (typeof m === "string") console.log(m);
  const copy = words[1];
  console.log(copy);
}
// expect: 3 3 8 a1 c bo ann1 5 2
// expect: 6 30 0 b2 3
// expect: a3
// expect: b4 3
// expect: x2
// expect: b1
// case: array_values_atomic
// error: 'entries' gives clones of the array's elements, and can't clone an 'Atomic', which is changed in place wherever it is shared; make a new one from what it holds
function main() {
  const as = [new Atomic(1), new Atomic(2)];
  for (const [i, a] of as.entries()) console.log(i, a.load());
}
// case: array_values_generic_atomic
// error: 'values' gives clones of the array's elements, and can't clone an 'Atomic', which is changed in place wherever it is shared; make a new one from what it holds
function each<T>(xs: Ref<T[]>): i64 { let n = 0; for (const x of xs.values()) n++; return n; }
function main() {
  const as = [new Atomic(1)];
  console.log(each(as));
}
// case: array_values_release
type P = { name: string; n: i64 };

class Bag {
  items: string[];
  constructor(items: string[]) {
    this.items = items;
  }
}

function make(k: i64): string[] {
  return ["a" + k, "b" + k, "c"];
}

function total(xs: i64[]): i64 {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

function main() {
  const nums = [1, 2, 3];
  const small: u8[] = [7, 8];
  const words = make(1);
  const people: P[] = [{ name: "ann" + 1, n: 1 }, { name: "bo", n: 2 }];
  const grid = [[1, 2], [3, 4, 5]];
  const mixed = [1, "x" + 2];
  const empty: string[] = [];
  console.log(nums.length, nums[2], small[1], words[0], words[2], people[1].name, people[0].name, grid[1][2], grid.length);
  console.log(total(nums), total([10, 20]), empty.length, make(2)[1], words.length);
  const maybe: string[] | null = make(3);
  if (maybe !== null) console.log(maybe[0]);
  const bag = new Bag(make(4));
  console.log(bag.items[1], bag.items.length);
  const m = mixed[1];
  if (typeof m === "string") console.log(m);
  const copy = words[1];
  console.log(copy);
}
// mode: release
// expect: 3 3 8 a1 c bo ann1 5 2
// expect: 6 30 0 b2 3
// expect: a3
// expect: b4 3
// expect: x2
// expect: b1
