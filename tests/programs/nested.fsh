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
// error: cannot use 'n' while 'inc' borrows 'n' mutably and is used later
function main() { let n = 0; function inc() { n++; } inc(); console.log(n); inc(); }
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
// error: cannot move 'xs' while 'add' borrows 'xs' mutably and is used later
function main() { let xs = [1]; function add() { xs.push(2); } const r = xs; add(); }
// case: nested_loop_conflict
// error: while 'add' borrows 'xs' mutably
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
// error: generic nested functions are not supported yet
function main() { function g<T>(x: T): T { return x; } }
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
