// case: generator_basic
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function* words(prefix: string) {
  yield prefix + "a";
  const middle = prefix + "-mid";
  yield middle;
  yield prefix + "b";
}

function* names(list: string[]): Generator<string> {
  for (const n of list) {
    const shout = n + "!";
    yield shout;
  }
}

function main() {
  let g = count(3);
  const a = g.next();
  if (a.done === false) console.log("first", a.value);
  const b = g.next();
  if (b.done === false) console.log("second", b.value);
  for (const k of count(4)) console.log(k);
  for (const w of words("x")) console.log(w);
  let early = words("y" + 1);
  early.next();
  const r = early.next();
  if (r.done === false) console.log("early", r.value);
  let done = count(0);
  const d = done.next();
  const again = done.next();
  console.log(d.done, again.done);
  for (const n of names(["ann" + 1, "bo"])) console.log(n);
  let partway = names(["p" + 1, "q" + 2, "r"]);
  partway.next();
  for (const w of words("z")) {
    if (w === "z-mid") break;
    console.log(w);
  }
}
// expect: first 0
// expect: second 1
// expect: 0
// expect: 1
// expect: 2
// expect: 3
// expect: xa
// expect: x-mid
// expect: xb
// expect: early y1-mid
// expect: true true
// expect: ann1!
// expect: bo!
// expect: za
// case: generator_borrows_argument
function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let arr = ["a" + 1, "b"];
  let g = each(arr);
  arr.push("c");
  const r = g.next();
  if (r.done === false) console.log(r.value);
}
// error: cannot change 'arr' while 'g' borrows 'arr' and is used later
// case: generator_clone
function* words(n: i64): Generator<string> {
  for (let i = 0; i < n; i++) yield "w" + i;
}
function main() {
  let a = words(3);
  a.next();
  const c = a.clone();
  let d = c;
  const r = d.next();
  if (r.done === false) console.log(r.value);
  const q = a.next();
  if (q.done === false) console.log(q.value);
}
// error: generators have no method 'clone' yet
// case: generator_control
class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

function risky(n: i64): i64 throws Oops {
  if (n === 2) throw new Oops("two " + n);
  return n * 10;
}

function* grid(rows: i64, cols: i64): Generator<string> {
  for (let r = 0; r < rows; r++) {
    const label = "r" + r;
    let c = 0;
    while (c < cols) {
      if (c === 1 && r === 1) {
        c++;
        continue;
      }
      yield label + "c" + c;
      c++;
    }
  }
}

function* doubled(n: i64): Generator<string> {
  for (const s of grid(n, 2)) {
    yield s + s;
  }
}

function* kinds(xs: i64[]): Generator<string> {
  for (const x of xs) {
    switch (x) {
      case 0:
        yield "zero";
        break;
      case 1:
        yield "one";
        yield "uno";
        break;
      default:
        if (x > 5) return;
        yield "many " + x;
    }
  }
  yield "end";
}

function* careful(n: i64): Generator<string> {
  for (let i = 0; i < n; i++) {
    try {
      const v = risky(i);
      yield "ok " + v;
    } catch (e) {
      yield "caught " + e.why;
    }
  }
}

function main() {
  for (const s of grid(2, 3)) console.log(s);
  for (const s of doubled(1)) console.log(s);
  for (const s of kinds([0, 1, 3, 9, 4])) console.log(s);
  for (const s of careful(3)) console.log(s);
  let partway = doubled(2);
  partway.next();
  let inner = careful(4);
  inner.next();
  inner.next();
  for (const s of kinds([1])) {
    console.log(s);
    break;
  }
}
// expect: r0c0
// expect: r0c1
// expect: r0c2
// expect: r1c0
// expect: r1c2
// expect: r0c0r0c0
// expect: r0c1r0c1
// expect: zero
// expect: one
// expect: uno
// expect: many 3
// expect: ok 0
// expect: ok 10
// expect: caught two 2
// expect: one
// case: generator_for_of_takes
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}
function main() {
  let g = count(3);
  for (const x of g) console.log(x);
  const r = g.next();
  console.log(r.done);
}
// error: 'g' was moved, so it can't be used here
// case: generator_held_loop_holds_borrows
function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let arr = ["a" + 1, "b" + 2];
  let g = each(arr);
  for (const s of g) {
    console.log(s);
    arr.push("c" + 3);
    arr.push("d" + 4);
    arr.push("e" + 5);
  }
}
// error: cannot change 'arr' while a 'for...of' loop borrows 'arr' and is used later
// case: generator_in_array
function* names(list: string[]): Generator<string> {
  for (const n of list) yield n + "!";
}
function main() {
  let xs = ["a" + 1, "b"];
  let g = names(xs.clone());
  xs.push("c");
  let h = g;
  const r = h.next();
  if (r.done === false) console.log(r.value);
  let arr = [names(["z" + 1])];
  const f = () => 1;
}
// expect: a1!
// case: generator_in_object
function* names(list: string[]): Generator<string> {
  for (const n of list) yield n + "!";
}
function main() {
  let h = { g: names(["z" + 1]) };
  const r = h.g.next();
  if (r.done === false) console.log(r.value);
  const mk = () => names(["y" + 1]);
}
// expect: z1!
// case: generator_in_union
function* g(): Generator<i64> {
  yield 1;
}

function* h(): Generator<i64> {
  yield 2;
}

function main() {
  const c = true;
  const it = c ? g() : h();
}
// error: unions holding generators are not supported yet
// case: generator_loop_holds_borrows
function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let arr = ["a" + 1, "b" + 2];
  for (const s of each(arr)) {
    console.log(s);
    arr.push("c" + 3);
    arr.push("d" + 4);
    arr.push("e" + 5);
  }
}
// error: cannot change 'arr' while a 'for...of' loop borrows 'arr' and is used later
// case: generator_moved
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}
function main() {
  let a = count(2);
  let b = a;
  const r = a.next();
  console.log(r.done);
}
// error: 'a' was moved, so it can't be used here
// case: generator_moves
type Box = { name: string };

function take(b: Box): string {
  return b.name;
}

function* boxes(n: i64): Generator<Box> {
  for (let i = 0; i < n; i++) {
    const b: Box = { name: "box" + i };
    const r: Ref<Box> = b;
    const label = r.name + "?";
    console.log(label);
    yield b;
  }
}

function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}

function main() {
  for (const b of boxes(2)) console.log(take(b));
  let arr = ["a" + 1, "b"];
  for (const s of each(arr)) console.log(s);
  arr.push("c");
  let g = each(arr);
  const r = g.next();
  if (r.done === false) console.log(r.value);
  let moved = g;
  const q = moved.next();
  if (q.done === false) console.log(q.value);
  console.log(arr.length);
}
// expect: box0?
// expect: box0
// expect: box1?
// expect: box1
// expect: a1!
// expect: b!
// expect: a1!
// expect: b!
// expect: 3
// case: generator_never_yields
function* g() {
  return;
}

function main() {
  const it = g();
}
// error: this generator never yields, so what it gives can't be told; declare it as 'Generator<T>'
// case: generator_next_argument
function* g(): Generator<i64> {
  yield 1;
}

function main() {
  let it = g();
  const r = it.next(5);
}
// error: values sent into 'next' are not supported yet
// case: generator_next_const
function* g(): Generator<i64> {
  yield 1;
}

function main() {
  const it = g();
  const r = it.next();
}
// error: cannot advance 'it' because it is a constant
// case: generator_no_properties
function* words(xs: string[]): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let g = words(["a" + 1]);
  g.next();
  g.loop.b = 4;
  const r = g.next();
  if (r.done === false) console.log(r.value);
}
// error: property 'loop' does not exist on type 'Generator<string>'
// case: generator_not_an_object
function* words(xs: string[]): Generator<string> {
  for (const x of xs) yield x + "!";
}
function f(o: { state: i32 }): i32 { return o.state; }
function main() {
  let g = words(["a" + 1]);
  g.next();
  console.log(f(g));
}
// error: argument of type 'Generator<string>' is not assignable to parameter of type '{ state: i32 }'
// case: generator_own_reference
type Box = { name: string };
function* own(): Generator<string> {
  const b: Box = { name: "box" + 1 };
  const r: Ref<Box> = b;
  yield r.name;
  console.log(r.name);
}
function main() {
  for (const s of own()) console.log(s);
}
// error: a reference into 'b' is still in use at this 'yield'
// case: generator_panic
function* pick(xs: string[], at: usize[]): Generator<string> {
  const note = "picked " + xs.length;
  for (const i of at) {
    yield note + " " + xs[i];
  }
}

function main() {
  const outer = "outer" + 1;
  let g = pick(["a" + 1, "b" + 2], [0, 5]);
  const first = g.next();
  if (first.done === false) console.log(first.value, outer);
  for (const s of pick(["c" + 3], [0, 9])) console.log(s);
}
// expect: picked 2 a1 outer1
// expect: picked 1 c3
// panic: index out of bounds
// case: generator_pipeline
function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function* evens(n: i64): Generator<i64> {
  for (let i = 0; i < n; i += 2) yield i;
}

function* label(prefix: string, n: i64): Generator<string> {
  for (const i of count(n)) yield prefix + i;
}

function* both(n: i64): Generator<string> {
  yield* label("a", n);
  yield "middle";
  yield* label("b" + n, 1);
  yield* ["x" + 1, "y"];
}

function sum(g: Generator<i64>): i64 {
  let total = 0;
  for (const v of g) total += v;
  return total;
}

function firstTwo(g: Mut<Generator<i64>>): i64 {
  const a = g.next();
  const b = g.next();
  if (a.done === false && b.done === false) return a.value * 10 + b.value;
  return -1;
}

function join(g: Generator<string>): string {
  let out = "";
  for (const s of g) out += s + ",";
  return out;
}

function main() {
  console.log(sum(count(5)), sum(evens(7)));
  let g = count(10);
  console.log(firstTwo(g), firstTwo(g));
  const rest = g.next();
  if (rest.done === false) console.log("then", rest.value);
  console.log(join(label("n", 3)));
  console.log(join(both(2)));
}
// expect: 10 12
// expect: 1 23
// expect: then 4
// expect: n0,n1,n2,
// expect: a0,a1,middle,b20,x1,y,
// case: generator_recursive
function* a(n: i64): Generator<i64> {
  if (n > 0) for (const x of a(n - 1)) yield x;
  yield n;
}
function main() {
  for (const x of a(3)) console.log(x);
}
// error: a generator can't make another of itself
// case: generator_reference_ends_in_yield
type Box = { name: string };
function* own(): Generator<string> {
  let b: Box = { name: "box" + 1 };
  const r: Ref<Box> = b;
  yield r.name.clone();
  yield "x";
}
function main() {
  for (const s of own()) console.log(s);
}
// expect: box1
// expect: x
// case: generator_return_value
function* g(): Generator<i64> {
  yield 1;
  return 2;
}

function main() {
  const it = g();
}
// error: a generator can't return a value yet; 'return;' ends it
// case: generator_stored_temporary
function* gen(xs: Ref<string[]>): Generator<string> {
  yield xs[0] + "!";
}
function main() {
  const g = gen(["a" + 1, "b" + 2]);
  for (const x of g) console.log(x);
}
// error: 'g' would keep borrowing this temporary
// case: generator_throws
function* g(): Generator<i64> throws string {
  yield 1;
}

function main() {
  const it = g();
}
// error: generators that throw are not supported yet
// case: generator_wrong_element
function* words(): Generator<string> {
  yield "a";
}

function sum(g: Generator<i64>): i64 {
  let total = 0;
  for (const v of g) total += v;
  return total;
}

function main() {
  console.log(sum(words()));
}
// error: it yields 'string', not 'i64'
// case: generator_wrong_return_type
function* g(): i64 {
  yield 1;
}

function main() {
  const it = g();
}
// error: a generator function's return type is 'Generator<T>', the type of what it yields
// case: generator_wrong_yield
function* g(): Generator<i64> {
  yield "a";
}

function main() {
  const it = g();
}
// error: type '"a"' is not assignable to the generator's 'Generator<i64>'
// case: generator_yield_expression
function* g(): Generator<i64> {
  const x = 1 + (yield 2);
  yield x;
}

function main() {
  const it = g();
}
// error: 'yield' inside expressions are not supported yet
// case: generator_yield_in_arm
function* g(n: i64): Generator<i64> {
  match (n) {
    case 0 => {
      yield 1;
    },
    case _ => {},
  }
}

function main() {
  const it = g(0);
}
// error: 'yield' inside match arms are not supported yet
// case: generator_yield_in_finally
function* g(): Generator<i64> {
  try {
    yield 1;
  } finally {
    yield 2;
  }
}

function main() {
  const it = g();
}
// error: 'yield' statements in a 'try' with a 'finally' are not supported yet
// case: generator_yield_in_try_finally
function* g(): Generator<i64> {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("cleanup");
  }
}
function main() {
  for (const x of g()) {
    console.log(x);
    break;
  }
  console.log("after");
}
// error: 'yield' statements in a 'try' with a 'finally' are not supported yet
// case: generator_yield_outside
function main() {
  yield 1;
}
// error: 'yield' can only be used inside a 'function*'
// case: generator_yields_reference
function* refs(xs: string[]): Generator<Ref<string>> {
  for (const x of xs) yield x;
}
function main() {
  let g = refs(["a" + 1, "b" + 2]);
  const r = g.next();
  g = refs(["c" + 3]);
  if (r.done === false) console.log(r.value);
}
// error: generators yielding references are not supported yet
