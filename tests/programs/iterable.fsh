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
