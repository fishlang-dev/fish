// Nested function declarations: hoisted in their block, borrowing what they use as arrows do.
// case: nested_basics
// expect: 4
// expect: 136 a-ba+b 9
// Calls before the declaration, captures, recursion, and a helper inside a method.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function outer(k: i64): i64 {
  const base = 10;
  console.log(early(2));
  function early(x: i64): i64 { return x * 2; }
  function add(x: i64): i64 { return x + base + k; }
  function fact(n: i64): i64 { return n <= 1 ? 1 : n * fact(n - 1); }
  return add(1) + fact(5);
}
function names(): string {
  const parts = ["a", "b"];
  function joined(sep: string): string { return parts.join(sep); }
  return joined("-") + joined("+");
}
class C { v: i64 = 3; m(): i64 { function sq(x: i64): i64 { return x * x; } return sq(this.v); } }
function main() {
  console.log(outer(5), names(), new C().m());
}
// case: nested_borrows_like_arrows
// expect: 2
// expect: 2
// expect: 1
// A nested function borrows what it uses from its declaration to its last use, as an arrow
// does; passed to a call, it lends for the call.
function twice(f: () => void) { f(); f(); }
function main() {
  let n = 0;
  function inc() { n++; }
  inc();
  inc();
  console.log(n);
  let m = 0;
  function bump() { m++; }
  twice(bump);
  console.log(m);
  let k = 0;
  function up() { k++; }
  const g = up;
  g();
  console.log(k);
}
// case: nested_borrow_between_calls
// expect: 1
// expect: 5
// expect: 15
// A nested function called by name lends what it uses for each call, so its variables are
// usable between calls, through another nested function, an arrow and a function nested in one.
function main() {
  let n = 0;
  function inc(): void { n++; }
  function twice(): void { inc(); inc(); }
  inc();
  console.log(n);
  inc();
  twice();
  const show = (): void => { inc(); console.log(n); };
  show();
  function deep(k: i64): void {
    function inner(): void { n += k; }
    inner();
  }
  deep(10);
  console.log(n);
}
// case: nested_self_call_borrow
// error: cannot mutably lend 'xs' while 'r' borrows 'xs[...]' and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [new P(1)];
  function g(d: i64): void {
    if (d > 0) {
      const r: Ref<P> = xs[0];
      g(d - 1);
      console.log(r.n);
    } else xs = [new P(2)];
  }
  g(1);
}
// case: nested_free_names
// expect: 6 3
// Hoisting looks only at the names a function uses from outside it, and a function's call of
// itself comes before an outer function of the same name.
function f(): i64 { return 100; }
function main() {
  let total = 0;
  add(1);
  add(5);
  function add(x: i64) { total += x; }
  const x = 5;
  {
    function f(n: i64): i64 { return n <= 0 ? 0 : 1 + f(n - 1); }
    console.log(total, f(3));
  }
}
// case: nested_moved_capture
// error: 'add' uses 'xs', and 'xs' was moved, so it can't be used here
function main() { let xs = [1]; function add() { xs.push(2); } const r = xs; add(); }
// case: nested_loop_conflict
// error: cannot mutably lend 'xs' while a 'for...of' loop is reading 'xs'
function main() { let xs = [1]; function add() { xs.push(2); } for (const x of xs) { add(); } }
// case: nested_value_conflict
// error: cannot use 'n' while 'g' borrows 'n' mutably and is used later
function main() { let n = 0; function inc() { n++; } const g = inc; console.log(n); g(); }
// case: nested_recursion_untyped
// error: 'fact' calls itself, so its return type has to be written, as TypeScript requires
function main() { function fact(n: i64) { return n <= 1 ? 1 : n * fact(n - 1); } }
// case: nested_this
// error: 'this' inside the nested function 'g' isn't the enclosing method's; pass what it needs as a parameter
class C { v: i64 = 1; m(): i64 { function g(): i64 { return this.v; } return g(); } }
function main() {}
// case: nested_moves_out
// error: the nested function 'take' moves 'p' out of the variables it uses
class P { n: i64 = 1; }
function main() { let p = new P(); function take(): P { return p; } }
// case: nested_generic
// expect: 3 a
function main() {
  function g<T>(x: T): T { return x; }
  console.log(g(3), g("a"));
}
// case: nested_self_call_argument
// error: cannot mutably lend 'xs' while 'xs[...]' is lent to 'g' for this call
// A self call lends what the function uses before its arguments run, so an argument can't
// borrow what the call may change.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [new P(1)];
  const other = new P(9);
  function g(d: i64, r: Ref<P>): void {
    if (d > 0) {
      g(d - 1, xs[0]);
      console.log(r.n);
    } else {
      xs = [new P(2)];
      console.log(r.n);
    }
  }
  g(1, other);
}
// case: nested_hoist_scopes
// expect: 2 2
// A name declared only in an inner block of the body, or read through a shorthand property, still
// means the variable around the function, so hoisting keeps the function after it.
function main() {
  const x = 1;
  {
    const x = 2;
    function g(): i64 { { const x = 9; } return x; }
    function h(): i64 { const o = { x }; return o.x; }
    console.log(g(), h());
  }
}
// case: nested_self_call_reads
// expect: 3
// A self call's arguments may read what the function changes, since the call changes it only once
// they have run.
function main() {
  let xs = [1];
  function grow(n: usize): void { if (n < 3) { xs.push(1); grow(xs.length); } }
  grow(1);
  console.log(xs.length);
}
// case: nested_async_const
// expect: 3
// An async nested function may use constants, whose values can't change after it is made.
async function main() {
  const base = 2;
  async function g(x: i64) { return x + base; }
  const got = await g(1);
  console.log(got);
}
// case: nested_async_let
// error: the async nested function 'g' takes its own copy of 'n' when it is made, so a later change to it wouldn't reach the function
async function main() {
  let n = 1;
  async function g() { return n; }
  n = 5;
  const got = await g();
  console.log(got);
}
// case: nested_value_made_where_used
// expect: 6
// expect: 8
// expect: 10
// expect: 11
// expect: 4 120
// A nested function used as a value is a closure made there, borrowing from there on, so a
// change before the use is allowed and seen.
function twice(f: () => void): void { f(); f(); }
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v); }
function main(): void {
  let n = 0;
  function inc(): void { n++; }
  n = 5;
  const g = inc;
  g();
  console.log(n);
  twice(inc);
  console.log(n);
  const run = (): void => { twice(inc); };
  run();
  console.log(n);
  inc();
  console.log(n);
  const k = 3;
  function add(x: i64): i64 { return x + k; }
  function fact(m: i64): i64 { return m <= 1 ? 1 : m * fact(m - 1); }
  console.log(apply(add, 1), apply(fact, 5));
}
// case: nested_value_in_closure_conflict
// error: cannot change 'n' while 'g' borrows 'n' mutably and is used later
function main() { let n = 0; function inc(): void { n++; } const outer = (): void => { const g = inc; n = 3; g(); }; outer(); }
// case: nested_value_reference_conflict
// error: cannot mutably lend 'xs' while 'r' borrows 'xs[...]' and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; function reset(): void { xs = [new P(9)]; } const r: Ref<P> = xs[0]; const g = reset; console.log(r.n); g(); }
// case: nested_call_argument_conflict
// error: cannot mutably lend 'xs' while 'xs[...]' is lent to 'g' for this call
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; function g(r: Ref<P>): void { xs = [new P(2)]; console.log(r.n); } g(xs[0]); }
// case: nested_call_reference_conflict
// error: cannot mutably lend 'xs' while 'r' borrows 'xs[...]' and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; function reset(): void { xs = [new P(9)]; } const r: Ref<P> = xs[0]; reset(); console.log(r.n); }
// case: nested_captured_reference
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
// A reference a nested function uses stays in use until its last call.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; const r: Ref<P> = xs[0]; function f(): void { console.log(r.n); } f(); xs = [new P(2)]; f(); }
// case: nested_calls_each_other
// expect: 3 3
// expect: 1
function main() {
  let n = 1;
  function get(): i64 { return n; }
  function bump(): void { n = get() + 1; }
  bump();
  bump();
  console.log(n, get());
  let xs = [1];
  const r: Ref<i64> = xs[0];
  function show(): void { console.log(r); }
  show();
  xs = [2];
}
// case: nested_async_moves_capture
// error: cannot move 'xs' while 'r' borrows 'xs[...]' and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sink(f: () => Promise<usize>): void {}
async function main() { const xs = [new P(7)]; const r: Ref<P> = xs[0]; async function g() { return xs.length; } sink(g); console.log(r.n); }
// case: nested_async_calls_nested
// expect: 3
// expect: 3
// expect: 1 1
// An async nested function holds the nested functions it calls as made where it is.
async function main() {
  const xs = [1, 2, 3];
  function len(): usize { return xs.length; }
  async function g() { return len(); }
  console.log(xs.length);
  const got = await g();
  console.log(got);
  let n = 0;
  function inc(): void { n++; }
  async function h() { inc(); return 1; }
  const v = await h();
  console.log(n, v);
}
// case: nested_async_holds_borrow
// error: cannot change 'n' while
async function main() { let n = 0; function inc(): void { n++; } async function h() { inc(); return 1; } const f = h(); n = 5; await f; }
// case: nested_name_as_parameter
// expect: 0
// expect: 1
function keep<T>(inc: T): void { const y = inc; }
function pass<T>(inc: T): T { const x = inc; return x; }
function main() { let n = 0; function inc(): void { n++; } keep(inc); console.log(n); const g = pass(inc); g(); console.log(n); }
// case: nested_assignment_target_held
// error: cannot mutably lend 'ys' while 'ys' is lent to the assignment to 'ys[0]'
function main() { let ys = ["a"]; function b(): string { ys = ["yy"]; return "?"; } ys[0] = b(); }
// case: nested_assignment_in_place
// expect: [ 3, 2 ]
// expect: [ 1, 7 ]
function main() {
  let xs = [1, 2, 3];
  xs[0] = xs.pop()!;
  console.log(xs);
  let ys = [1, 2];
  function seven(): i64 { return 7; }
  ys[1] = seven();
  console.log(ys);
}
// case: nested_value_two_captures
// error: cannot use 'xs[0]' while 'g' borrows 'xs' mutably and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; let k = 0; function reset(): void { xs = [new P(5)]; k++; } const g = reset; const r: Ref<P> = xs[0]; g(); console.log(r.n); }
// case: nested_arrow_two_captures
// error: cannot use 'xs[0]' while 'a' borrows 'xs' mutably and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; let k = 0; function reset(): void { xs = [new P(5)]; k++; } const a = (): void => { reset(); }; const r: Ref<P> = xs[0]; a(); console.log(r.n); }
// case: nested_owning_two_functions
// error: cannot use 'n' while 'm' borrows 'n' mutably and is used later
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { let xs = [new P(1)]; let n = 0; function inc(): void { n++; } function reset(): void { xs = [new P(n)]; } const m = move (): void => { inc(); reset(); inc(); }; m(); console.log(n, xs[0].n); m(); }
// case: nested_owning_stale_copy
// error: this closure holds its own copy of 'n', which a nested function it calls changes, so it wouldn't see the change; pass 'n' as a parameter instead
async function main() { let n = 0; function inc(): void { n++; } const g = async () => { inc(); return n; }; const v = await g(); console.log(v, n); }
// case: nested_name_rebound
// expect: 0
// expect: 1
function keep<T>(x: T): void { const inc = x; const y = inc; }
function main() {
  let n = 0;
  function inc(): void { n++; }
  keep(inc);
  console.log(n);
  const g = inc;
  const a = (): void => { const inc = g; inc(); };
  a();
  console.log(n);
}
// case: nested_in_async_and_generator
// expect: 6
// expect: 2
// expect: 3
// A nested function's loops and awaits are its own, not those of the async function or
// generator around it.
async function work(): Promise<i64> { return 2; }
function* gen(): Generator<i64> {
  function helper(xs: i64[]): i64 { let s = 0; for (const x of xs) s += x; return s; }
  yield helper([1, 2]);
}
async function main() {
  function sum(xs: i64[]): i64 { let s = 0; for (const x of xs) s += x; return s; }
  console.log(sum([1, 2, 3]));
  async function put() { const v = await work(); return v; }
  const got = await put();
  console.log(got);
  for (const x of gen()) console.log(x);
}
