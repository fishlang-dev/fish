// case: borrow_block_break
// error: 'b' doesn't live long enough: 'h' still borrows it after its block ends
class P { x = 0; tag = "p" + 1 }
class H<A extends Lifetime> {
  src: Ref<P, A>
  constructor(s: Ref<P, A>) { this.src = s }
  set(this: Mut<this>, s: Ref<P, A>) { this.src = s }
}
function main() {
  let a = new P();
  let h = new H(a);
  while (true) {
    let b = new P();
    b.x = 7;
    h.set(b);
    break;
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.src.x, h.src.tag);
}
// case: borrow_block_ok
// expect: 3 c
// A holder declared in a block may borrow its locals, and an outer value lent inside a block is
// free again after it.
function main() {
  let outer: string[] = ["a"];
  {
    let x: string[] = ["b"];
    const m: Mut<string[]> = x;
    let inner = { m };
    inner.m.push("c");
    const o: Mut<string[]> = outer;
    o.push(x[1]);
  }
  const p: Mut<string[]> = outer;
  p.push("d");
  console.log(outer.length, outer[1]);
}
// case: borrow_block_outlived
// error: 'x' doesn't live long enough: 'h' still borrows it after its block ends
// A borrow of a block's local can't be kept by a variable from outside the block past its end.
function main() {
  let outer: string[] = [];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    let x: string[] = ["a"];
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  for (let i = 0; i < 1000; i++) h.m.push("g" + i);
  console.log(h.m.length, junk.length, outer.length);
}
// case: borrow_block_raise
// error: 'x' doesn't live long enough: 'h' still borrows it after its block ends
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    f(-1);
    h = { r: o };
  } catch (e) {
    let junk: string[] = [];
    for (let i = 0; i < 100; i++) junk.push("junk" + i);
    console.log(h.r.length, h.r[0]);
  }
}
// case: borrow_block_reborrow_ok
// expect: 2
function main() {
  let outer: string[] = [];
  let x: string[] = ["a"];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  h.m.push("z");
  console.log(h.m.length);
}
// case: borrow_branch
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let r: Ref<P> = q
  const sure = true
  if (sure) {
    r = p
  }
  p.x = 3
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// case: borrow_call_change
function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let n = 1
  print(f(n, n++))
}
// error: cannot change 'n' while 'n' is lent to 'f' for this call
// case: borrow_call_mut
type P = { x: i64 }

function two(a: Mut<P>, b: Ref<P>): i64 {
  return a.x + b.x
}

function main() {
  let p: P = { x: 1 }
  print(two(p, p))
}
// error: cannot use 'p' while 'p' is lent mutably to 'two' for this call
// case: borrow_catch_param
// error: 'e' doesn't live long enough
function f(n: string[]): i64 throws string[] { if (n.length > 0) throw n; return 1 }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    f(["e" + 1, "x"]);
  } catch (e) {
    h = { r: e };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.r.length, h.r[0], junk.length);
}
// case: borrow_change
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  p.x = 2
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// error: note: 'p' is lent here, so it can't change or move until the borrow's last use
// case: borrow_change_inside_array
type Box = { s: string };
function main() {
  let xs: Box[] = [{ s: "a" + "1" }];
  const r: Ref<Box> = xs[0];
  const ys = [r.s, (xs[0] = { s: "z" + "9" }).s];
  console.log(ys[0], r.s);
}
// error: cannot change 'xs[0]' while 'r' borrows
// case: borrow_change_inside_as
function main() {
  let xs: i64[] = [1];
  const r: Ref<i64> = xs[0];
  const y = (xs = [5]).length as i32;
  console.log(r, y);
}
// error: cannot change 'xs' while 'r' borrows
// case: borrow_conditional
// A reference to a `?:` of places borrows whichever place it chooses.
type P = { x: i64 }

function look(r: Ref<P>): i64 {
  return r.x
}

function main() {
  const p: P = { x: 1 }
  const q: P = { x: 2 }
  const c = true
  const r: Ref<P> = c ? p : q
  print(r.x, look(c ? q : p), p.x, q.x)
}
// expect: 1 2 1 2
// case: borrow_conditional_change
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  const c = true
  const r: Ref<P> = c ? p : q
  p.x = 9
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// case: borrow_conditional_receiver
class C {
  n: i64 = 1
  add(this: Mut<this>, k: i64) {
    this.n = this.n + k
  }
}

function main() {
  let a = new C()
  let b = new C()
  const c = true
  ;(c ? a : b).add(5)
}
// error: can't call 'add' on a '?:', which would change a copy; call it in each branch
// case: borrow_conditional_ref
// A `?:` of a reference and a place lends the place, or passes the reference on, in either
// order, in a let or as an argument.
type P = { x: i64 }

function look(r: Ref<P>): i64 {
  return r.x
}

function main() {
  const p: P = { x: 1 }
  const q: P = { x: 2 }
  const a: Ref<P> = p
  const c = true
  const r: Ref<P> = c ? q : a
  const s: Ref<P> = c ? a : q
  print(r.x, s.x, look(c ? a : q), look(c ? q : a))
}
// expect: 2 1 1 2
// case: borrow_copy_source
function main() {
  let w = { x: 1, y: 2 }
  const r: Ref<{ x: i64 }> = w
  w.x = 5
  print(r.x)
}
// error: cannot change 'w.x' while 'r' borrows 'w' and is used later
// case: borrow_empty_catch_finally_ok
// expect: 1
// expect: 2
// expect: done
// expect: end
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  console.log(h.r.length);
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    console.log(h.r.length);
    f(-1);
  } catch {} finally {
    console.log("done");
  }
  console.log("end");
}
// case: borrow_finally_raise
// error: 'x' doesn't live long enough
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function g(): i64 throws i64 {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    f(-1);
    h = { r: o };
  } finally {
    let junk: string[] = [];
    for (let j = 0; j < 50; j++) junk.push("junk" + j);
    console.log(h.r.length, h.r[0]);
  }
  return 0;
}
function main() {
  try { g(); } catch (e) { console.log("caught", e); }
}
// case: borrow_finally_return
// error: 'x' doesn't live long enough
function g(): i64 {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    if (x.length > 1) return 1;
    h = { r: o };
  } finally {
    let junk: string[] = [];
    for (let j = 0; j < 50; j++) junk.push("junk" + j);
    console.log(h.r.length, h.r[0]);
  }
  return 0;
}
function main() { console.log(g()); }
// case: borrow_for_of_through_ref
type O = { tags: string[][] };
function main() {
  let o: O = { tags: [["t" + 1], ["u" + 2]] };
  const r: Ref<O> = o;
  for (const t of r.tags) {
    o = { tags: [] };
    console.log(t.length);
  }
}
// error: cannot change 'o' while a 'for...of' loop and 't' borrow 'o'
// case: borrow_forof_variable
// error: 'row' doesn't live long enough
function* rows(): Generator<string[]> {
  yield ["a" + 1, "x"];
  yield ["b" + 2, "y"];
}
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  for (let row of rows()) {
    h = { r: row };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.r.length, h.r[0], junk.length);
}
// case: borrow_generic_field
function g<T extends { x: i64 }>(v: T): i64 {
  let w = v
  const r: Ref<i64> = w.x
  w.x = 9
  return r
}

function main() {
  print(g({ x: 1 }))
}
// error: cannot change 'w.x' while 'r' borrows 'w.x' and is used later
// case: borrow_labeled_continue
// error: 'x' doesn't live long enough
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  outerLoop: for (let i = 0; i < 3; i++) {
    console.log(h.r.length, h.r[0]);
    for (let j = 0; j < 2; j++) {
      let x: string[] = ["a" + i, "b"];
      h = { r: x };
      continue outerLoop;
    }
  }
}
// case: borrow_let_temporary
function main() {
  const r: Ref<string> = "tmp" + 1;
  console.log(r);
}
// error: 'r' would keep borrowing this temporary
// case: borrow_literal_held
function main() { const r: Ref<string> = "lit"; console.log(r); }
// expect: lit
// case: borrow_loop
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let r: Ref<P> = q
  let i = 0
  while (i < 2) {
    p.x = i
    print(r.x)
    r = p
    i++
  }
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// case: borrow_loop_continue
// error: 'x' doesn't live long enough
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  for (let i = 0; i < 3; i++) {
    let junk: string[] = [];
    for (let j = 0; j < 50; j++) junk.push("junk" + j);
    console.log(h.r.length, h.r[0]);
    let x: string[] = ["a" + i, "b"];
    h = { r: x };
    continue;
  }
}
// case: borrow_loop_for_init
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let i = 0
  for (let r: Ref<P> = q; i < 3; i++) {
    p.x = i
    print(r.x)
    r = p
  }
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// case: borrow_loop_for_init_mut
// A mutable reference declared in a for initializer keeps what it borrows, and assigning to
// it writes through, on every pass.
type P = { x: i64 }

function main() {
  let q: P = { x: 2 }
  let i = 0
  for (let m: Mut<P> = q; i < 3; i++) {
    m = { x: m.x + 10 }
  }
  print(q.x)
}
// expect: 32
// case: borrow_loop_nested_for
// A `for` loop's initializer reference is gone by the next pass of a loop around it.
type P = { x: i64 }

function main() {
  let p: P = { x: 0 }
  let i = 0
  while (i < 3) {
    i++
    p.x = i
    let j = 0
    for (let r: Ref<P> = p; j < 1; j++) {
      print(r.x)
    }
  }
}
// expect: 1
// expect: 2
// expect: 3
// case: borrow_loops_ok
// A reference declared in a loop body starts fresh each pass, an assignment changes its
// target after reading its value, and a mutable receiver can be read by its own arguments.
type P = { x: i64 }

class V {
  n: i64 = 0
  add(this: Mut<this>, k: i64) {
    this.n = this.n + k
  }
}

function poke(m: Mut<P>): i64 {
  return m.x + 1
}

function main() {
  let p: P = { x: 1 }
  let total = 0
  let i = 0
  while (i < 3) {
    let m: Mut<P> = p
    total = total + poke(m)
    p.x = i
    const r: Ref<P> = p
    total = total + r.x
    i++
  }
  for (let j = 0; j < 2; p.x++) {
    const r: Ref<P> = p
    total = total + r.x
    j++
  }
  const s: Ref<P> = p
  p.x = s.x + 1
  let v = new V()
  v.add(v.n + 1)
  v.add(v.n + 1)
  print(total, p.x, v.n)
}
// expect: 13 5 3
// case: borrow_match_expression_arm
// error: 'v' doesn't live long enough
function mk(): string[] | null { return ["a" + 1, "x"]; }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  match (mk()) {
    case Some(v) => h = { r: v },
    case _ => h = { r: o },
  };
  let junk: string[] = [];
  for (let j = 0; j < 50; j++) junk.push("junk" + j);
  console.log(h.r.length, h.r[0]);
}
// case: borrow_move
type P = { x: i64 }

function take(p: P): i64 {
  return p.x
}

function main() {
  const p: P = { x: 1 }
  const r: Ref<P> = p
  take(p)
  print(r.x)
}
// error: cannot move 'p' while 'r' borrows 'p' and is used later
// case: borrow_mut_as_shared
type P = { x: i64 }

function two(a: Ref<P>, b: Mut<P>): i64 {
  return a.x + b.x
}

function main() {
  let p: P = { x: 1 }
  let r: Mut<P> = p
  print(two(r, r))
}
// error: cannot mutably lend 'r' while 'r' is lent to 'two' for this call
// case: borrow_mut_copy
type P = { x: i64 }

function look(a: Ref<P>): i64 {
  return a.x
}

function main() {
  let p: P = { x: 1 }
  let r: Mut<P> = p
  let s: Mut<P> = r
  print(look(r), look(s))
}
// error: cannot use 'r' while 's' borrows 'r' mutably and is used later
// case: borrow_mut_receiver_self
class C {
  n: i64 = 1
  add(this: Mut<this>, o: Ref<C>) {
    this.n = this.n + o.n
  }
}

function main() {
  let c = new C()
  let r: Mut<C> = c
  r.add(r)
}
// error: cannot mutably lend 'r' while 'r' is lent to 'add' for this call
// case: borrow_mut_shared_copy
class C {
  n: i64 = 1
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

function main() {
  let c = new C()
  let r: Mut<C> = c
  const s: Ref<C> = r
  r.bump()
  print(s.n)
}
// error: cannot mutably lend 'r' while 's' borrows 'r' and is used later
// case: borrow_mut_twice
type P = { x: i64 }

function two(a: Mut<P>, b: Mut<P>): i64 {
  return a.x + b.x
}

function f(m: Mut<P>): i64 {
  return two(m, m)
}

function main() {
  let p: P = { x: 1 }
  print(f(p))
}
// error: cannot use 'm' while 'm' is lent mutably to 'two' for this call
// case: borrow_mut_use
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let m: Mut<P> = p
  print(p.x)
  print(m.x)
}
// error: cannot use 'p.x' while 'm' borrows 'p' mutably and is used later
// case: borrow_non_null_held
function id(s: Ref<string>): Ref<string> { return s; }
function main() {
  const o: string | null = "o" + 1;
  const r = id(o!);
  console.log(r);
}
// expect: o1
// case: borrow_non_null_locks
function id(s: Ref<string>): Ref<string> { return s; }
function main() { let o: string | null = "o" + 1; const r = id(o!); o = null; console.log(r); }
// error: cannot change 'o' while 'r' borrows 'o' and is used later
// case: borrow_rebind
// Pointing a reference elsewhere lets go of what it held.
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let r: Ref<P> = p
  r = q
  p.x = 3
  print(r.x, p.x)
}
// expect: 2 3
// case: borrow_receiver
type P = { x: i64 }

class Box {
  p: P = { x: 1 }
  look(q: P): i64 {
    return this.p.x + q.x
  }
}

function main() {
  let b = new Box()
  print(b.look(b.p))
}
// error: cannot move 'b.p' while 'b' is lent to 'look' for this call
// case: borrow_receiver_arg
class C {
  n: i64 = 1
  add(this: Mut<this>, o: Ref<C>) {
    this.n = this.n + o.n
  }
}

function main() {
  let c = new C()
  const s: Ref<C> = c
  c.add(s)
}
// error: cannot mutably lend 'c' while 's' borrows 'c' and is used later
// case: borrow_ref_field_arg
type P = { x: i64 }

function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  print(f(r.x, p.x++))
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// case: borrow_setter
class C {
  n: i64 = 1
  #v: i64 = 0
  get v(): i64 {
    return this.#v
  }
  set v(x: i64) {
    this.#v = x
  }
}

function main() {
  let c = new C()
  const r: Ref<C> = c
  c.v = 5
  print(r.n)
}
// error: cannot change 'c' while 'r' borrows 'c' and is used later
// case: borrow_setter_call
class C {
  n: i64 = 1
  #v: i64 = 0
  get v(): i64 {
    return this.#v
  }
  set v(x: i64) {
    this.#v = x
  }
}

function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let c = new C()
  print(f(c.n, c.v = 5))
}
// error: cannot change 'c' while 'c.n' is lent to 'f' for this call
// case: borrow_shorthand_mut
// error: cannot use 'm' while a 'for...of' loop borrows 'm' mutably
// A mutable reference copied into an object by shorthand lends itself, as '{ m: m }' does, so
// the loop's borrow through r.m and a use of m can't overlap.
function main() {
  let xs: string[] = ["a", "b"];
  const m: Mut<string[]> = xs;
  const r = { m };
  for (const s of r.m) {
    for (let i = 0; i < 1000; i++) m.push("g" + i);
    console.log(s);
  }
}
// case: borrow_shorthand_mut_ok
// expect: 7 3
// A copied Mut used through its holder alone is fine.
function main() {
  let xs: i64[] = [1, 2];
  const m: Mut<i64[]> = xs;
  let r = { m };
  r.m.push(4);
  console.log(r.m[0] + r.m[1] + r.m[2], xs.length);
}
// case: borrow_this_getter
type I = { v: i64 }

class C {
  inner: I = { v: 1 }
  get peek(): i64 {
    return this.inner.v
  }
  run(this: Mut<this>): i64 {
    let m: Mut<C> = this
    const k = this.peek
    return m.inner.v + k
  }
}

function main() {
  let c = new C()
  print(c.run())
}
// error: cannot use 'this' while 'm' borrows 'this' mutably and is used later
// case: borrow_through_copy
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  const s = r
  p.x = 2
  print(s.x)
}
// error: cannot change 'p.x' while 's' borrows 'p' and is used later
// case: borrow_used_in_array
type Box = { s: string };
function main() {
  let xs: Box[] = [{ s: "a" + "1" }];
  const r: Ref<Box> = xs[0];
  xs[0] = { s: "z" + "9" };
  xs.push({ s: "b" + "2" });
  xs.push({ s: "c" + "3" });
  const ys = [r.s];
  console.log(ys[0]);
}
// error: cannot change 'xs[0]' while 'r' borrows
// case: borrow_used_in_as
function main() {
  let xs: i64[] = [1];
  const r: Ref<i64> = xs[0];
  xs.push(2);
  console.log(r as i32);
}
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
