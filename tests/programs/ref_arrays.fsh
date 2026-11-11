// case: ref_arrays_literal
// An array of references borrows what its elements point at; an element read is the reference.
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  console.log(rs[0].s, rs[1].s, rs.length);
  let none: Ref<B>[] = [];
  console.log(none.length);
  const [first] = rs;
  console.log(first.s);
}
// expect: a b 2
// expect: 0
// expect: a
// case: ref_arrays_holders
// Elements that hold references: an Option of one, and a tagged union's member.
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let b1 = new B("a");
  let os: (Ref<B> | null)[] = [b1, null];
  const o = os[0];
  if (o !== null) console.log(o.s);
  console.log(os[1] === null);
  let ns: N[] = [{ of: "b", node: b1 }, { of: "n" }];
  const n: Ref<N> = ns[0];
  if (n.of === "b") console.log(n.node.s);
  console.log(ns[1].of);
}
// expect: a
// expect: true
// expect: a
// expect: n
// case: ref_arrays_move_referent
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  eat(b1);
  console.log(rs[0].s);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_change_referent
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  b1.s = "z";
  console.log(rs[0].s);
}
// error: cannot change 'b1.s' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_element_keeps_borrow
// A reference read out of the array borrows what the array does, after the array's last use.
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let r = rs[0];
  eat(b1);
  console.log(r.s);
}
// error: cannot move 'b1' while 'r' borrows 'b1' and is used later
// case: ref_arrays_holder_element_move
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let ns: N[] = [{ of: "b", node: b1 }];
  eat(b1);
  console.log(ns.length);
}
// error: cannot move 'b1' while 'ns' borrows 'b1' and is used later
// case: ref_arrays_return_local
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let b1 = new B("a");
  return [b1];
}
function main() { console.log(f().length); }
// error: can't return a reference to 'b1', which belongs to this function
// case: ref_arrays_owned_element
// A borrow where an owned element is wanted is a move out of the borrow, not an array of references.
type O = { k: i64; s: string };
const top: O = { k: 1, s: "a" };
function main() {
  let xs: O[] = [{ k: 2, s: "b" }, top];
  console.log(xs.length);
}
// error: can't move a value out of a reference to it, which only borrows it
// case: ref_arrays_mutable
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Mut<B>[] = [b1];
}
// error: arrays of mutable references are not supported yet
// case: ref_arrays_method
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(rs.map((r) => r.s).length);
}
// error: calls to 'map' on arrays of references are not supported yet
// case: ref_arrays_compare
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [b1];
  console.log(rs === ys);
}
// error: comparisons of arrays of references are not supported yet
// case: ref_arrays_print
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(rs);
}
// error: prints of arrays of references are not supported yet
// case: ref_arrays_spread
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys = [...rs];
}
// error: spreads of arrays of references are not supported yet
// case: ref_arrays_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys = rs.clone();
}
// error: clones of arrays of references are not supported yet
// case: ref_arrays_stack
// A stack of references: pushed, read, written by index, popped, and a variable pointed at an
// element; what is popped borrows what the array did, not the array, so the array still changes.
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let b3 = new B("c");
  let st: Ref<B>[] = [];
  st.push(b1);
  st.push(b2);
  const top = st.pop()!;
  st.push(b3);
  st[0] = b2;
  console.log(top.s, st.length, st[0].s);
  let cur = st[0];
  while (st.length > 0) {
    cur = st.pop()!;
    console.log(cur.s);
  }
  console.log(st.length);
}
// expect: b 2 b
// expect: c
// expect: b
// expect: 0
// case: ref_arrays_push_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let st: Ref<B>[] = [];
  st.push(b1);
  eat(b1);
  console.log(st.length);
}
// error: cannot move 'b1' while 'st' borrows 'b1' and is used later
// case: ref_arrays_push_inner_block
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let st: Ref<B>[] = [];
  {
    let b1 = new B("a");
    st.push(b1);
  }
  console.log(st[0].s);
}
// error: 'b1' doesn't live long enough: 'st' still borrows it after its block ends
// case: ref_arrays_index_write_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b0 = new B("0");
  let b1 = new B("a");
  let st: Ref<B>[] = [b0];
  st[0] = b1;
  eat(b1);
  console.log(st[0].s);
}
// error: cannot move 'b1' while 'st' borrows 'b1' and is used later
// case: ref_arrays_pop_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let st: Ref<B>[] = [];
  st.push(b1);
  const t = st.pop()!;
  eat(b1);
  console.log(t.s);
}
// error: cannot move 'b1' while 't' borrows 'b1' and is used later
// case: ref_arrays_pop_return
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B> {
  let b1 = new B("a");
  let st: Ref<B>[] = [b1];
  return st.pop()!;
}
function main() { console.log(f().s); }
// error: this function returns a reference but borrows nothing it could point into
// case: ref_arrays_rebind_inner_array
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b0 = new B("0");
  let u: Ref<B> = b0;
  {
    let b3 = new B("3");
    let st: Ref<B>[] = [b3];
    u = st[0];
  }
  console.log(u.s);
}
// error: 'u' can only be pointed at a variable, or a field of one, declared in its own scope
// case: ref_arrays_rebind_inner_referent
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b0 = new B("0");
  let u: Ref<B> = b0;
  let st: Ref<B>[] = [];
  {
    let b3 = new B("3");
    st.push(b3);
    u = st.pop()!;
  }
  console.log(u.s);
}
// error: 'b3' doesn't live long enough: 'u' still borrows it after its block ends
// case: ref_arrays_push_through_reference
class B { s: string; constructor(s: string) { this.s = s; } }
function fill(st: Mut<Ref<B>[]>) {
  let b1 = new B("a");
  st.push(b1);
}
function main() {
  let st: Ref<B>[] = [];
  fill(st);
  console.log(st[0].s);
}
// error: keeping references through the reference 'st' is not supported yet
// case: ref_arrays_loop
// A loop over references gives each reference; over values holding references, a borrow of each.
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  for (const r of rs) console.log(r.s);
  let ns: N[] = [{ of: "b", node: b1 }, { of: "n" }];
  for (const n of ns) {
    if (n.of === "b") console.log(n.node.s);
    else console.log(n.of);
  }
  let os: (Ref<B> | null)[] = [b2, null];
  for (const o of os) console.log(o === null ? "none" : o.s);
  let out: Ref<B>[] = [];
  for (const r of rs) out.push(r);
  for (let i: usize = 0; i < out.length; i++) console.log(out[i].s);
}
// expect: a
// expect: b
// expect: a
// expect: n
// expect: b
// expect: none
// expect: a
// expect: b
// case: ref_arrays_loop_change
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  for (const r of rs) {
    b1.s = "z";
    console.log(r.s);
  }
}
// error: cannot change 'b1.s' while a 'for...of' loop and 'r' borrow 'b1' and are used later
// case: ref_arrays_loop_collect_move
// References collected out of a loop borrow what the looped array did.
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let ns: N[] = [{ of: "b", node: b1 }];
  let out: Ref<B>[] = [];
  for (const n of ns) {
    if (n.of === "b") out.push(n.node);
  }
  eat(b1);
  console.log(out.length);
}
// error: cannot move 'b1' while 'out' borrows 'b1' and is used later
// case: ref_arrays_loop_push
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  for (const r of rs) rs.push(r);
}
// error: cannot change 'rs' while a 'for...of' loop is reading 'rs'
// case: ref_arrays_contexts
// Where an array of references can live: a parameter, a class's field, an object's field, a
// return borrowing its one reference parameter, a closure's capture, a generic 'T[]', an async
// function's parameter and a generator's.
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack {
  items: Ref<B>[] = [];
  add(this: Mut<this>, b: Ref<B>) { this.items.push(b); }
  top(): Ref<B> { return this.items[this.items.length - 1]; }
  take(this: Mut<this>): Ref<B> | null { return this.items.pop(); }
}
type Bag = { items: Ref<B>[]; n: i64 };
function count(rs: Ref<B>[]): usize { return rs.length; }
function first(rs: Ref<Ref<B>[]>): Ref<B> { return rs[0]; }
function both(a: Ref<B>): Ref<B>[] { return [a, a]; }
function wrap<T>(x: T): T[] { return [x]; }
async function size(rs: Ref<B>[]): Promise<usize> { return rs.length; }
function* names(rs: Ref<B>[]): Generator<string> { for (const r of rs) yield r.s; }
async function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: Ref<B>[] = [b1];
  console.log(first(rs).s, count(rs));
  let st = new Stack();
  st.add(b1);
  st.add(b2);
  console.log(st.top().s);
  const taken = st.take();
  console.log(taken === null ? "none" : taken.s, st.items.length);
  let bag: Bag = { items: [b1], n: 1 };
  bag.items.push(b2);
  bag.items[0] = b2;
  console.log(bag.items[0].s, bag.items.length);
  const pair = both(b1);
  console.log(pair[1].s, pair.length);
  let seen: Ref<B>[] = [b2];
  const read = () => seen[0].s;
  console.log(read());
  const r: Ref<B> = b1;
  console.log(wrap(r)[0].s);
  let rr: Ref<B>[][] = [[b1]];
  rr[0].push(b2);
  rr.push([b2]);
  console.log(rr[0][1].s, rr.length);
  const n = await size([b1, b2]);
  console.log(n);
  for (const s of names([b1, b2])) console.log(s);
}
// expect: a 1
// expect: b
// expect: b 1
// expect: b 2
// expect: a 2
// expect: b
// expect: a
// expect: b 2
// expect: 2
// expect: a
// expect: b
// case: ref_arrays_field_move
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack {
  items: Ref<B>[] = [];
  add(this: Mut<this>, b: Ref<B>) { this.items.push(b); }
}
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let st = new Stack();
  st.add(b1);
  eat(b1);
  console.log(st.items.length);
}
// error: cannot move 'b1' while 'st' borrows 'b1' and is used later
// case: ref_arrays_field_local
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack {
  items: Ref<B>[] = [];
  add(this: Mut<this>) {
    let b = new B("x");
    this.items.push(b);
  }
}
function main() {
  let st = new Stack();
  st.add();
  console.log(st.items[0].s);
}
// error: can't store in 'this' a reference to 'b', which belongs to this function
// case: ref_arrays_method_pop_move
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack {
  items: Ref<B>[] = [];
  add(this: Mut<this>, b: Ref<B>) { this.items.push(b); }
  take(this: Mut<this>): Ref<B> | null { return this.items.pop(); }
}
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let st = new Stack();
  st.add(b1);
  const t = st.take();
  eat(b1);
  console.log(t === null);
}
// error: cannot move 'b1' while 't' borrows 'b1' and is used later
// case: ref_arrays_object_field_move
class B { s: string; constructor(s: string) { this.s = s; } }
type Bag = { items: Ref<B>[]; n: i64 };
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let bag: Bag = { items: [b1], n: 1 };
  bag.items[0] = b2;
  eat(b2);
  console.log(bag.n);
}
// error: cannot move 'b2' while 'bag' borrows 'b2' and is used later
// case: ref_arrays_returned_move
class B { s: string; constructor(s: string) { this.s = s; } }
function both(a: Ref<B>): Ref<B>[] { return [a, a]; }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let ys = both(b1);
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used later
// case: ref_arrays_passed_move
class B { s: string; constructor(s: string) { this.s = s; } }
function pass(rs: Ref<B>[]): Ref<B>[] { return rs; }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let ys = pass([b1]);
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used later
// case: ref_arrays_capture_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const f = () => rs[0].s;
  eat(b1);
  console.log(f());
}
// error: cannot move 'b1' while 'f' borrows 'b1' and is used later
// case: ref_arrays_capture_push
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [];
  const g = () => { rs.push(b1); };
  g();
}
// error: keeping references in 'rs', which this closure captures, is not supported yet
// case: ref_arrays_generic_move
class B { s: string; constructor(s: string) { this.s = s; } }
function wrap<T>(x: T): T[] { return [x]; }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  const r: Ref<B> = b1;
  let ws = wrap(r);
  eat(b1);
  console.log(ws.length);
}
// error: cannot move 'b1' while 'ws' borrows 'b1' and is used later
// case: ref_arrays_nested_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rr: Ref<B>[][] = [[b1]];
  rr[0].push(b2);
  eat(b2);
  console.log(rr.length);
}
// error: cannot move 'b2' while 'rr' borrows 'b2' and is used later
// case: ref_arrays_copy_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [b2];
  ys = rs;
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used later
// case: ref_arrays_loop_local
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let st: Ref<B>[] = [];
  for (let i = 0; i < 2; i++) {
    let b = new B("x");
    st.push(b);
  }
  console.log(st.length);
}
// error: 'b' doesn't live long enough: 'st' still borrows it after its block ends
// case: ref_arrays_top_level
class B { s: string; constructor(s: string) { this.s = s; } }
const top = new B("t");
const all: Ref<B>[] = [top];
function main() { console.log(all[0].s); }
// error: top-level consts holding references are not supported yet
// case: ref_arrays_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function f(b: Ref<B>): Ref<B>[] { return new Array(2).fill(b); }
function main() { console.log(f(new B("a")).length); }
// error: arrays filled with references are not supported yet
// case: ref_arrays_pop_object
// A popped element holding a reference keeps what the array borrowed, through `!`.
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" }];
  const m = ms.pop()!;
  console.log(m.node.s, m.k);
  eat(b1);
}
// expect: a1 k
// case: ref_arrays_pop_object_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" }];
  const m = ms.pop()!;
  eat(b1);
  console.log(m.node.s);
}
// error: cannot move 'b1' while 'm' borrows 'b1' and is used later
// case: ref_arrays_pop_field_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" }];
  const n = ms.pop()!.node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_pop_tuple_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let ms: [Ref<B>, string][] = [[b1, "k"]];
  const m = ms.pop()!;
  eat(b1);
  console.log(m[0].s);
}
// error: cannot move 'b1' while 'm' borrows 'b1' and is used later
// case: ref_arrays_pop_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function pass(m: M): M { return m; }
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" }];
  const m = pass(ms.pop()!);
  eat(b1);
  console.log(m.node.s);
}
// error: cannot move 'b1' while 'm' borrows 'b1' and is used later
// case: ref_arrays_pop_nested_return
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function eat(_b: B) {}
function f(): Ref<B>[] {
  let b = new B("x" + 1);
  let rr: Ref<B>[][] = [[b]];
  return rr.pop()!;
}
function main() { console.log(f()[0].s); }
// error: can't return a reference to 'b'
// case: ref_arrays_rebind_coerced
// An element that would be copied to fit the reference's type can't be pointed at.
type Wide = { a: i64; z: i64; node: Ref<i64> };
type Narrow = { z: i64 };
function main() {
  let k: i64 = 1;
  let ws: Wide[] = [{ a: 1, z: 10, node: k }];
  let n0: Narrow = { z: 0 };
  let u: Ref<Narrow> = n0;
  u = ws[0];
  console.log(u.z);
}
// error: 'u' can only be pointed at a variable
// case: ref_arrays_null_test
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack { items: Ref<B>[] = []; }
function main() {
  let s: Stack | null = null;
  s = new Stack();
  console.log(s === null);
}
// expect: false
// case: ref_arrays_temporary_literal
// A reference read out of a temporary keeps what the temporary borrowed.
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function mk(m: Ref<M>): [Ref<B>, i64] { return [m.node, 1]; }
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  let t2: M = { node: b1 };
  const c = mk(t2)[0];
  const n = [t][0].node;
  console.log(n.s, c.s);
  eat(b1);
}
// expect: a1 a1
// case: ref_arrays_temporary_literal_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  const n = [t][0].node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_temporary_object_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  const n = { m: t }.m.node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_temporary_call_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function mk(m: M): [M, i64] { return [m, 1]; }
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  const n = mk(t)[0].node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_undefined_test
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack { items: Ref<B>[] = []; }
function main() {
  let s: Stack | undefined = new Stack();
  console.log(s === undefined);
}
// expect: false
// case: ref_arrays_loop_literal
// A loop over a temporary array of references: its variable holds what the literal did.
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let r: Ref<B> = b1;
  for (const m of [r]) console.log(m.s);
  eat(b1);
}
// expect: a1
// case: ref_arrays_loop_literal_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let r: Ref<B> = b1;
  let keep: Ref<B>[] = [];
  for (const m of [r]) { keep.push(m); }
  eat(b1);
  console.log(keep[0].s);
}
// error: cannot move 'b1' while 'keep' borrows 'b1' and is used later
// case: ref_arrays_temporary_conditional_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let r: Ref<B> = b1;
  const n = (b1.s.length > 0 ? [r] : [r])[0];
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_temporary_coalesce_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 1);
  let ms: M[] = [{ node: b1 }];
  let d: M = { node: b2 };
  const n = (ms.pop() ?? d).node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_temporary_new_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
class G { m: M; constructor(m: M) { this.m = m; } }
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  const n = new G(t).m.node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_temporary_getter_move
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B> };
function eat(_b: B) {}
class G { m: M; constructor(m: M) { this.m = m; } get mm(): M { return { node: this.m.node }; } }
function idg(g: G): G { return g; }
function main() {
  let b1 = new B("a" + 1);
  let t: M = { node: b1 };
  let g = new G(t);
  const n = idg(g).mm.node;
  eat(b1);
  console.log(n.s);
}
// error: cannot move 'b1' while 'n' borrows 'b1' and is used later
// case: ref_arrays_assign_value_move
// An assignment used as a value borrows what it stored.
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 1);
  let u: Ref<B> = b2;
  let r: Ref<B> = b1;
  const n = (u = r);
  eat(b1);
  console.log(n.s, u.s);
}
// error: cannot move 'b1' while
// case: ref_arrays_assign_value_push
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 1);
  let u: Ref<B> = b2;
  let r: Ref<B> = b1;
  let rs: Ref<B>[] = [];
  rs.push(u = r);
  eat(b1);
  console.log(rs[0].s);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_assign_value_chain
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 1);
  let r: Ref<B> = b1;
  let u: Ref<B>[] = [b2];
  let v: Ref<B>[] = [b2];
  v[0] = u[0] = r;
  eat(b1);
  console.log(v[0].s);
}
// error: cannot move 'b1' while
// case: ref_arrays_assign_value
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 1);
  let u: Ref<B> = b2;
  let r: Ref<B> = b1;
  const n = (u = r);
  console.log(n.s, u.s);
  eat(b1);
}
// expect: a1 a1
// case: ref_arrays_return_temporary_element
// An element read from a call's array of references points where the call's result does.
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function list(a: Ref<B>): Ref<B>[] { return [a]; }
function first(a: Ref<B>): Ref<B> { return list(a)[0]; }
function pick(a: Ref<B>): Ref<B> { return [a][0]; }
function main() {
  let b1 = new B("a" + 1);
  console.log(first(b1).s, pick(b1).s);
}
// expect: a1 a1
// case: ref_arrays_loop_method_move
// A loop over a method's array of references leaves the receiver borrowed by what the body kept.
class B { s: string; constructor(s: string) { this.s = s; } }
class W { b: B; constructor() { this.b = new B("x" + 1); } all(): Ref<B>[] { return [this.b]; } }
function eatw(_w: W) {}
function main() {
  let w = new W();
  let keep: Ref<B>[] = [];
  for (const x of w.all()) keep.push(x);
  eatw(w);
  console.log(keep[0].s);
}
// error: cannot move 'w' while 'keep' borrows 'w' and is used later
// case: ref_arrays_loop_method
class B { s: string; constructor(s: string) { this.s = s; } }
class W { b: B; constructor() { this.b = new B("x" + 1); } all(): Ref<B>[] { return [this.b]; } }
function eatw(_w: W) {}
function main() {
  let w = new W();
  for (const x of w.all()) console.log(x.s);
  eatw(w);
}
// expect: x1
