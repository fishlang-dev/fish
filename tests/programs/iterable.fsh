// case: iterable_method_call
class Bag {
  items: i64[] = [1, 2, 3];
  *[Symbol.iterator](): Generator<i64> { for (const x of this.items) yield x; }
}
function main() {
  const b = new Bag();
  console.log(b[Symbol.iterator]().map((x) => x * 10).toArray());
  let it = b[Symbol.iterator]();
  console.log(it.next());
  console.log(b[Symbol.iterator]().filter((x) => x > 1).toArray());
}
// expect: [ 10, 20, 30 ]
// expect: { done: false, value: 1 }
// expect: [ 2, 3 ]
// case: iterable_plain_method
class Pair {
  a: string = "x";
  b: string = "y";
  *both(): Generator<string> { yield this.a; yield this.b; }
  [Symbol.iterator](): Generator<string> { return this.both(); }
}
function main() {
  const p = new Pair();
  console.log(p[Symbol.iterator]().toArray());
}
// expect: [ 'x', 'y' ]
// case: iterable_missing_method
class Plain { n: i64 = 1; }
function main() {
  const p = new Plain();
  console.log(p[Symbol.iterator]().toArray());
}
// error: 'Plain' has no method '[Symbol.iterator]'
// case: iterable_quoted_name
class Bag {
  "[Symbol.iterator]"(): Generator<i64> { return [1].values(); }
}
function main() {}
// error: E0120
// case: iterable_for_of
class Bag {
  items: string[] = [];
  add(this: Mut<this>, s: string) { this.items.push(s); }
  *[Symbol.iterator](): Generator<string> { for (const s of this.items) yield s; }
}
function show(b: Ref<Bag>) {
  for (const s of b) console.log("ref", s);
}
function main() {
  let b = new Bag();
  b.add("a");
  b.add("b");
  for (const s of b) console.log(s);
  show(b);
  b.add("c");
  console.log([...b]);
  console.log(Array.from(b));
  console.log(Array.from(b, (s) => s + "!"));
  console.log([..."x", ...b].length);
}
// expect: a
// expect: b
// expect: ref a
// expect: ref b
// expect: [ 'a', 'b', 'c' ]
// expect: [ 'a', 'b', 'c' ]
// expect: [ 'a!', 'b!', 'c!' ]
// expect: 4
// case: iterable_inherited
class Base {
  n: i64 = 2;
  *[Symbol.iterator](): Generator<i64> { for (let i = 0; i < this.n; i++) yield i; }
}
class Derived extends Base {
  label: string = "d";
}
function main() {
  const d = new Derived();
  for (const i of d) console.log(d.label, i);
}
// expect: d 0
// expect: d 1
// case: iterable_changed_while_looping
class Bag {
  items: i64[] = [1];
  add(this: Mut<this>, n: i64) { this.items.push(n); }
  *[Symbol.iterator](): Generator<i64> { for (const x of this.items) yield x; }
}
function main() {
  let b = new Bag();
  for (const x of b) b.add(x);
}
// error: 8:22: error[E0203]: cannot mutably lend 'b' while a 'for...of' loop borrows 'b'
// case: iterable_temporary
class Bag {
  items: string[] = [];
  constructor(s: string) { this.items.push(s); }
  *[Symbol.iterator](): Generator<string> { for (const s of this.items) yield s; }
}
function main() {
  for (const s of new Bag("a" + 1)) console.log(s);
}
// error: 7:19: error[E0204]: 'for...of' would keep borrowing this temporary
// case: iterable_temporary_spread
class Bag {
  items: string[] = [];
  constructor(s: string) { this.items.push(s); }
  *[Symbol.iterator](): Generator<string> { for (const s of this.items) yield s; }
}
function main() {
  console.log([...new Bag("a" + 1)]);
  console.log(Array.from(new Bag("b" + 2)));
}
// expect: [ 'a1' ]
// expect: [ 'b2' ]
// case: iterable_generic_class
class Stack<T> {
  items: T[] = [];
  push(this: Mut<this>, x: T) { this.items.push(x); }
  *[Symbol.iterator](): Generator<T> { for (let i = this.items.length; i > 0; i--) yield this.items[i - 1]!.clone(); }
}
class Ids {
  ids: i64[] = [4, 5];
  [Symbol.iterator](): Generator<i64> { return this.ids.values(); }
}
function main() {
  let s = new Stack<string>();
  s.push("a"); s.push("b");
  for (const x of s) console.log(x);
  const m: Mut<Stack<string>> = s;
  for (const x of m) console.log("m", x);
  const ids = new Ids(); for (const i of ids) console.log(i);
  console.log([...new Ids()]);
}
// expect: b
// expect: a
// expect: m b
// expect: m a
// expect: 4
// expect: 5
// expect: [ 4, 5 ]
