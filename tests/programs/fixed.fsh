// case: fixed_async_loop
// expect: a1 1
// expect: b2 1
// expect: b2
// expect: 0
// A loop over a borrowed fixed array in an async function, across await.
async function tick(): Promise<i64> { return 1; }
async function work(ps: Ref<FixedArray<string, 2>>): Promise<i64> {
  for (const p of ps) { const k = await tick(); console.log(p, k); }
  console.log(ps[1]);
  return 0;
}
async function main() { const ps: FixedArray<string, 2> = ["a" + 1, "b" + 2]; const w = await work(ps); console.log(w); }
// case: fixed_basics
// expect: 19 10 4 1
// expect: x1 x1 3
// expect: 7
// expect: 1
// expect: 5
// expect: a1 1
// expect: b 2
// FixedArray holds its elements inline: literals and filled, copies of Copy elements, indexing
// and writes, length, and for...of with patterns.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(a: FixedArray<i64, 4>): i64 {
  let t = 0;
  for (const x of a) t += x;
  return t;
}
function make(): FixedArray<string, 3> { return FixedArray.filled<string, 3>("x" + 1); }
function main() {
  let a: FixedArray<i64, 4> = [1, 2, 3, 4];
  const b = a;
  a[0] = 10;
  console.log(sum(a), sum(b), a.length, b[0]);
  const ws = make();
  console.log(ws[0], ws[2], ws.length);
  const filled: FixedArray<i64, 3> = FixedArray.filled(7);
  console.log(filled[1]);
  let ps: FixedArray<P, 2> = [new P(1), new P(2)];
  ps[1].n = 5;
  for (const p of ps) console.log(p.n);
  const pairs: FixedArray<[string, i64], 2> = [["a" + 1, 1], ["b", 2]];
  for (const [k, v] of pairs) console.log(k, v);
}
// case: fixed_bounds
// panic: index out of bounds: the len is 2 but the index is 2
function main() { const a: FixedArray<i64, 2> = [1, 2]; let i: usize = 2; console.log(a[i]); }
// case: fixed_constant
// error: cannot assign to 'a[...]' because 'a' is a constant
function main() { const a: FixedArray<i64, 2> = [1, 2]; a[0] = 3; }
// case: fixed_filled_generic
// expect: 5 s1
// FixedArray.filled in a generic body, each instance its own.
function wrap<T>(x: T): FixedArray<T, 2> { return FixedArray.filled<T, 2>(x); }
function main() { const b = wrap(5); const c = wrap("s" + 1); console.log(b[1], c[0]); }
// case: fixed_filled_statement
// expect: done
// FixedArray.filled as a statement makes and drops its array.
function mk(): string { return "m" + 1; }
function main() {
  FixedArray.filled<string, 3>(mk());
  console.log("done");
}
// case: fixed_generator_loop
// expect: a1
// expect: b2
// A loop over a borrowed fixed array in a generator.
function* gen(ps: Ref<FixedArray<string, 2>>): Generator<string> {
  for (const p of ps) yield p;
}
function main() {
  const ps: FixedArray<string, 2> = ["a" + 1, "b" + 2];
  for (const s of gen(ps)) console.log(s);
}
// case: fixed_infer
// expect: 2
// A generic function infers its type argument from a FixedArray parameter.
function count<T>(x: FixedArray<T, 2>): usize { return x.length; }
function main() { const a: FixedArray<string, 2> = ["a" + 1, "b" + 2]; console.log(count(a)); }
// case: fixed_length
// error: type 'FixedArray<i64, 2>' holds 2 elements, but this literal has 3
function main() { const a: FixedArray<i64, 2> = [1, 2, 3]; }
// case: fixed_length_effects
// expect: made
// expect: 2
// panic: index out of bounds: the len is 1 but the index is 5
// A fixed array's length still runs what it is read from, and checks an index into it.
function mk(): FixedArray<string, 2> { console.log("made"); return ["a" + 1, "b" + 2]; }
function main() {
  const n = mk().length;
  console.log(n);
  let i: usize = 0;
  const xs: FixedArray<FixedArray<i64, 2>, 1> = [[1, 2]];
  let j: usize = 5;
  console.log(xs[j].length);
}
// case: fixed_loop_dyn_generator
// expect: i1
// expect: j2
// expect: n1
// expect: m2
// Loops in a generator over fixed arrays read through a Dyn and out of an Option.
interface I { items: FixedArray<string, 2>; }
class C implements I { items: FixedArray<string, 2> = ["i" + 1, "j" + 2]; }
function* g(d: Ref<Dyn<I>>): Generator<string> { for (const v of d.items) yield v; }
function* h(o: Ref<{ a: FixedArray<string, 2> } | null>): Generator<string> { for (const v of o!.a) yield v; }
function main() {
  const d: Dyn<I> = new C();
  for (const v of g(d)) console.log(v);
  const x0: { a: FixedArray<string, 2> } = { a: ["n" + 1, "m" + 2] };
  const x: { a: FixedArray<string, 2> } | null = x0;
  for (const v of h(x)) console.log(v);
}
// case: fixed_loop_temporary_part
// error: this loop would read from a value made just for it
function mk(): FixedArray<FixedArray<string, 2>, 2> { return [["a" + 1, "b" + 1], ["c" + 1, "d" + 1]]; }
function main() { for (const x of mk()[1]) console.log(x); }
// case: fixed_method
// error: a FixedArray has no method 'map' yet; loop over it with 'for...of', or read 'length'
function main() { const a: FixedArray<i64, 2> = [1, 2]; a.map((x) => x); }
// case: fixed_moved
// error: 'ps[0].n' can't be used here because 'ps' was moved
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { const ps: FixedArray<P, 1> = [new P(1)]; const q = ps; console.log(ps[0].n); }
// case: fixed_nonliteral
// error: a FixedArray's length is a number written in place, like 'FixedArray<i64, 4>'
function main() { const n = 2; const a: FixedArray<i64, n> = [1, 2]; }
// case: fixed_option
// expect: a1 b2
// expect: true
// A fixed array literal where an Option of one is expected.
function f(b: boolean): FixedArray<string, 2> | null {
  if (b) return ["a" + 1, "b" + 2];
  return null;
}
function main() {
  const x = f(true);
  if (x !== null) console.log(x[0], x[1]);
  const y = f(false);
  console.log(y === null);
}
// case: fixed_ref
// expect: s1 t 2
// A fixed array read through a reference.
function main() { let a: FixedArray<string, 2> = FixedArray.filled("s" + 1); a[1] = "t"; const r: Ref<FixedArray<string, 2>> = a; console.log(r[0], r[1], r.length); }
// case: fixed_refs
// error: fixed arrays of references are not supported yet
function main() {
  const o = "o" + 1;
  let a: FixedArray<Ref<string>, 2> = [o, o];
  {
    const s = "x" + 1;
    a = [s, s];
  }
  console.log(a[0]);
}
// case: fixed_shared_loop
// expect: a1
// expect: b2
// A loop over a shared value's fixed array field in an async function.
type S = { a: FixedArray<string, 2> };
async function main() {
  const s = shared<S>({ a: ["a" + 1, "b" + 2] });
  for (const v of s.a) console.log(v);
}
// case: fixed_toarray
// error: argument of type 'FixedArray<i64, 2>' is not assignable to parameter of type 'i64[]'
function f(xs: i64[]) {} function main() { const a: FixedArray<i64, 2> = [1, 2]; f(a); }
// case: fixed_too_large
// error: a FixedArray holds at most 64 KiB inline
function main() {
  const a: FixedArray<FixedArray<i64, 1000000>, 1000000> = FixedArray.filled(FixedArray.filled(0));
  console.log(a.length);
}
// case: fixed_unsent
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it; use an 'Atomic' or a 'Lock' instead
async function work(a: FixedArray<Cell<i64>, 1>): Promise<i64> { await yieldNow(); return a[0].get(); }
async function main() {
  const a: FixedArray<Cell<i64>, 1> = [new Cell(1)];
  const h = spawn(work(a));
  const r = await h;
  console.log(r);
}
