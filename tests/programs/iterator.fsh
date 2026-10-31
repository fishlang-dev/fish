// case: iterator_lazy
function* naturals(): Generator<i64> {
  let i = 0;
  while (true) {
    console.log("pull", i);
    yield i;
    i++;
  }
}

function main() {
  const k = 10;
  const firstTwo = naturals().map((x, i) => x * k + i).take(2);
  console.log("built");
  for (const v of firstTwo) console.log(v);
  console.log(naturals().filter((x) => x % 3 === 0).drop(1).take(2).toArray());
}
// expect: built
// expect: pull 0
// expect: 0
// expect: pull 1
// expect: 11
// expect: pull 0
// expect: pull 1
// expect: pull 2
// expect: pull 3
// expect: pull 4
// expect: pull 5
// expect: pull 6
// expect: [ 3, 6 ]
// case: iterator_eager
function* words(): Generator<string> {
  yield "a" + 1;
  yield "bb";
  yield "c" + 2;
}

function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(5).reduce((a, b) => a + b));
  console.log(count(5).reduce((a, b, i) => a + b * i, 100));
  console.log(words().reduce((a, w) => a + (w.length as i64), 0));
  words().forEach((w, i) => console.log(i, w));
  console.log(count(10).some((x) => x > 5), count(3).every((x) => x < 3), words().some((w) => w === "zz"));
  console.log(words().find((w) => w.startsWith("c")), words().find((w) => w === "q"));
  console.log(count(100).find((x, i) => x * i > 50));
  console.log(words().toArray(), count(0).toArray());
}
// expect: 10
// expect: 130
// expect: 6
// expect: 0 a1
// expect: 1 bb
// expect: 2 c2
// expect: true true false
// expect: c2 null
// expect: 8
// expect: [ 'a1', 'bb', 'c2' ] []
// case: iterator_flat_map
function* words(): Generator<string> {
  yield "a" + 1;
  yield "bb";
  yield "c" + 2;
}

function* repeat(s: string, n: i64): Generator<string> {
  for (let i = 0; i < n; i++) yield s.clone();
}

function main() {
  console.log(words().flatMap((w, i) => [w.clone(), "" + i]).toArray());
  console.log(words().flatMap((w, i) => repeat(w, i)).toArray());
  const none: string[] = [];
  console.log(words().flatMap((w) => none.slice()).toArray());
}
// expect: [ 'a1', '0', 'bb', '1', 'c2', '2' ]
// expect: [ 'bb', 'c2', 'c2' ]
// expect: []
// case: iterator_interactions
function* words(): Generator<string> {
  yield "a" + 1;
  yield "bb";
}

function shout(g: Generator<string>): Generator<string> {
  return g.map((w) => w + "!");
}

function main() {
  console.log([...words().map((w) => w.length)]);
  let g = words();
  g.next();
  for (const w of shout(g)) console.log(w);
  let rest = words().drop(1);
  const r = rest.next();
  if (r.done === false) console.log(r.value);
  console.log(words().take(0).toArray(), words().drop(5).toArray());
}
// expect: [ 2, 2 ]
// expect: bb!
// expect: bb
// expect: [] []
// case: iterator_moves_source
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  let g = count(3);
  const doubled = g.map((x) => x * 2);
  g.next();
  console.log(doubled.toArray());
}
// error: 'g' was moved, so it can't be used here
// error: 'g' moved here: 'map' takes its generator over
// case: iterator_borrowed_source
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function firstTwo(g: Mut<Generator<i64>>): i64[] {
  return g.take(2).toArray();
}

function main() {
  let g = count(3);
  console.log(firstTwo(g));
}
// error: 'take' takes its generator over, and this one is borrowed; call it on a generator this code owns
// case: iterator_capture_outlives
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function labelled(): Generator<string> {
  const prefix = "n" + 1;
  return count(3).map((x) => prefix + x);
}

function main() {
  console.log(labelled().toArray());
}
// error: can't return a reference to 'prefix', which belongs to this function and is gone once it returns
// case: iterator_capture_changed
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  let seen = 0;
  const g = count(3).map((x) => {
    seen++;
    return x;
  });
  seen = 10;
  console.log(g.toArray());
}
// error: cannot change 'seen' while 'g' borrows 'seen' mutably and is used later
// case: iterator_filter_boolean
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).filter((x) => x % 2).toArray());
}
// error: 'filter''s callback has to give a 'boolean', since Fish has no truthiness; this one gives 'i64'
// case: iterator_flat_map_string
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).flatMap((x) => "s" + x).toArray());
}
// error: 'flatMap''s callback gives a generator or an array for each value, whose values make up the result; this one gives 'string'
// case: iterator_map_void
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).map((x) => { console.log(x); }).toArray());
}
// error: 'map''s callback has to give a value to keep, not 'void'
// case: iterator_too_many_params
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).map((x, i, all) => x).toArray());
}
// error: 'map' passes its callback the value and its index
// case: iterator_arguments
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).take().toArray());
}
// error: 'take' takes 1 argument, a count
// case: iterator_unknown_method
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).fliter((x) => x > 1).toArray());
}
// error: generators have no method 'fliter' yet; did you mean 'filter'?
// case: iterator_reduce_empty
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(0).reduce((a, b) => a + b));
}
// panic: iterator_reduce_empty.fsh:6:15:
// panic: reduce of empty generator with no initial value
// case: iterator_negative_take
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  const n = 1 - 2;
  console.log(count(3).take(n).toArray());
}
// panic: iterator_negative_take.fsh:7:15:
// panic: 'take''s count can't be negative
// case: iterator_nullable
function* opts(): Generator<string | null> {
  yield "a" + 1;
  yield null;
  yield "b";
}

function main() {
  console.log(opts().flatMap((x) => [x, null]).toArray());
  console.log(opts().reduce((_a, b) => b), opts().reduce((a, _b) => a));
  console.log(opts().filter((x) => x === null).toArray(), opts().toArray());
  console.log(opts().find((x) => x === "b"), opts().find((x) => x === null));
}
// expect: [ 'a1', null, null, null, 'b', null ]
// expect: b a1
// expect: [ null ] [ 'a1', null, 'b' ]
// expect: b null
// case: iterator_named_callbacks
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function* words(): Generator<string> {
  yield "a" + 1;
  yield "b";
}

function even(x: i64): boolean {
  return x % 2 === 0;
}

function long(s: Ref<string>): boolean {
  return s.length > 1;
}

function twice(x: i64): i64 {
  return x * 2;
}

function add(a: i64, b: i64): i64 {
  return a + b;
}

function main() {
  console.log(count(5).filter(even).toArray(), count(3).map(twice).toArray());
  console.log(words().filter(long).toArray(), count(4).some(even), count(4).every(even));
  console.log(count(5).reduce(add), count(5).find(even));
}
// expect: [ 0, 2, 4 ] [ 0, 2, 4 ]
// expect: [ 'a1' ] true false
// expect: 10 0
// case: iterator_edges
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function main() {
  console.log(count(3).drop(0).toArray());
  console.log(count(1).reduce((a, b) => a * 100 + b));
  console.log(count(3).flatMap((x, i) => [x * 10, i]).toArray());
}
// expect: [ 0, 1, 2 ]
// expect: 0
// expect: [ 0, 0, 10, 1, 20, 2 ]
// case: iterator_in_generic
function* each<T>(xs: Ref<T[]>): Generator<T> {
  for (const x of xs) yield x.clone();
}

function firstTwo<T>(xs: Ref<T[]>): T[] {
  return each(xs).filter((_x, i) => i < 2).map((x) => x).toArray();
}

function main() {
  console.log(firstTwo([1, 2, 3]));
  console.log(firstTwo(["a" + 1, "b", "c"]));
}
// expect: [ 1, 2 ]
// expect: [ 'a1', 'b' ]
