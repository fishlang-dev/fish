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
// case: ref_arrays_mut_push_pop
// expect: 2 a1! b2
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  let ms: Mut<B>[] = [b1];
  ms.push(b2);
  ms[0].s = ms[0].s + "!";
  console.log(ms.length, ms[0].s, ms[1].s);
}
// case: ref_arrays_mut_element_changes_referent
// expect: z9
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  {
    let ms: Mut<B>[] = [b1];
    const m: Mut<B> = ms[0];
    m.s = "z" + 9;
  }
  console.log(b1.s);
}
// case: ref_arrays_mut_pop_gives_reference
// expect: c3 1
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  let ms: Mut<B>[] = [b1, b2];
  const m: Mut<B> = ms.pop()!;
  m.s = "c" + 3;
  console.log(m.s, ms.length);
}
// case: ref_arrays_mut_same_place_twice
// error: the new array being built borrows 'b1' mutably
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let ms: Mut<B>[] = [b1, b1];
  console.log(ms.length);
}
// case: ref_arrays_mut_element_held_array_used
// error: 'm' borrows 'ms[...]' mutably
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  let ms: Mut<B>[] = [b1];
  const m: Mut<B> = ms[0];
  ms.push(b2);
  m.s = "z" + 9;
}
// case: ref_arrays_mut_owner_used_while_held
// error: cannot use 'b1'
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let ms: Mut<B>[] = [b1];
  console.log(b1.s);
  ms[0].s = "z" + 9;
}
// case: ref_arrays_mut_method_refused
// error: calls to 'slice' on arrays of mutable references are not supported yet
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let ms: Mut<B>[] = [b1];
  const copy = ms.slice(0);
}
// case: ref_arrays_mut_spread_refused
// error: spreads of arrays of mutable references are not supported yet
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let ms: Mut<B>[] = [b1];
  const copy: Mut<B>[] = [...ms];
}
// case: ref_arrays_mut_loop_refused
// error: 'for...of' loops over arrays of mutable references are not supported yet
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a" + 1);
  let ms: Mut<B>[] = [b1];
  for (const m of ms) m.s = "z" + 9;
}
// case: ref_arrays_method
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  for (const r of rs.values()) console.log(r.s);
}
// error: calls to 'values' on arrays of references are not supported yet
// case: ref_arrays_compare
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [b1];
  console.log(rs === ys);
}
// error: values of type 'B' can't be compared with '==='
// case: ref_arrays_print
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(rs);
}
// expect: [ B { s: 'a' } ]
// case: ref_arrays_spread
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys = [...rs];
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys = rs.clone();
  console.log(ys[0].s);
}
// expect: a
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
// case: ref_arrays_callbacks
class B { s: string; n: i64; constructor(s: string, n: i64) { this.s = s; this.n = n; } }
function main() {
  let b1 = new B("a", 3);
  let b2 = new B("b", 1);
  let b3 = new B("c", 2);
  let rs: Ref<B>[] = [b1, b2, b3];
  rs.forEach((x) => console.log(x.s));
  console.log(rs.some((x) => x.s === "b"), rs.every((x) => x.n > 1));
  console.log(rs.findIndex((x) => x.n === 2), rs.findLastIndex((x) => x.n > 5));
  console.log(rs.map((x) => x.s).join("-"), rs.map((x, i) => x.n + i).join(","));
  console.log(rs.reduce((a, x) => a + x.n, 0), rs.reduceRight((a, x) => a + x.s, ""));
  console.log(rs.flatMap((x) => [x.n, x.n]).length);
  rs.sort((p, q) => p.n - q.n);
  console.log(rs[0].s, rs[1].s, rs[2].s);
  rs.reverse();
  console.log(rs[0].s);
  for (const k of rs.keys()) console.log(k);
  console.log(b1.s);
}
// expect: a
// expect: b
// expect: c
// expect: true false
// expect: 2 -1
// expect: a-b-c 3,2,4
// expect: 6 cba
// expect: 6
// expect: b c a
// expect: a
// expect: 0
// expect: 1
// expect: 2
// expect: a
// case: ref_arrays_callbacks_option
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: (Ref<B> | null)[] = [b1, null, b2];
  rs.forEach((x) => { if (x !== null) console.log(x.s); });
  console.log(rs.some((x) => x === null), rs.every((x) => x !== null));
  console.log(rs.findIndex((x) => x !== null && x.s === "b"));
  console.log(rs.map((x) => x === null ? "-" : x.s).join(""));
  console.log(rs.reduce((a, x) => x === null ? a : a + 1, 0));
  rs.sort((p, q) => (p === null ? 1 : 0) - (q === null ? 1 : 0));
  console.log(rs[2] === null);
}
// expect: a
// expect: b
// expect: true false
// expect: 2
// expect: a-b
// expect: 2
// expect: true
// case: ref_arrays_callbacks_object
class B { s: string; constructor(s: string) { this.s = s; } }
type H = { node: Ref<B>; n: i64 };
function main() {
  let b1 = new B("a");
  let b2 = new B("b");
  let rs: H[] = [{ node: b1, n: 2 }, { node: b2, n: 1 }];
  rs.forEach((x) => console.log(x.node.s));
  console.log(rs.some((x) => x.node.s === "b"), rs.findIndex((x) => x.n === 1));
  console.log(rs.map((x) => x.node.s).join(""), rs.reduce((a, x) => a + x.n, 0));
  rs.sort((p, q) => p.n - q.n);
  console.log(rs[0].node.s);
}
// expect: a
// expect: b
// expect: true 1
// expect: ab 3
// expect: b
// case: ref_arrays_callbacks_named
class B { s: string; n: i64; constructor(s: string, n: i64) { this.s = s; this.n = n; } }
function isB(x: Ref<B>): boolean { return x.s === "b"; }
function byN(p: Ref<B>, q: Ref<B>): i64 { return p.n - q.n; }
function main() {
  let b1 = new B("a", 2);
  let b2 = new B("b", 1);
  let rs: Ref<B>[] = [b1, b2];
  console.log(rs.some(isB), rs.findIndex(isB));
  rs.sort(byN);
  console.log(rs[0].s);
}
// expect: true 1
// expect: b
// case: ref_arrays_callback_keeps
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let keep: Ref<B>[] = [];
  rs.forEach((x) => { keep.push(x); });
  console.log(keep.length);
}
// error: keeping references in 'keep', which this closure captures, is not supported yet
// case: ref_arrays_callback_gives_reference
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const r = rs.reduce((a, x) => x);
  console.log(r.s);
}
// expect: a
// case: ref_arrays_join
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(rs.join(","));
}
// error: 'join' writes each element as 'String(x)' does
// case: ref_arrays_includes
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(rs.includes(b1));
}
// error: 'includes' compares elements by value
// case: ref_arrays_sort_bare
function main() {
  let a = "x";
  let rs: Ref<string>[] = [a];
  rs.sort();
}
// error: without a comparator orders numbers and strings, not 'Ref<string>'
// case: ref_arrays_element_methods
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const a = rs.at(0)!;
  const f = rs.find((x) => x.s === "b")!;
  const l = rs.findLast((x) => x.s !== "z")!;
  const h = rs.shift()!;
  let b3 = new B("c");
  rs.push(b3);
  console.log(a.s, f.s, l.s, h.s, rs.length, rs.at(-1)!.s);
}
// expect: a b b a 2 c
// case: ref_arrays_element_methods_option
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: (Ref<B> | null)[] = [b1, null, b2];
  const a = rs.at(0);
  const f = rs.find((x) => x !== null && x.s === "b");
  const h = rs.shift();
  if (a !== null && f !== null && h !== null) console.log(a.s, f.s, h.s);
}
// expect: a b a
// case: ref_arrays_element_methods_object
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
type H = { node: Ref<B> };
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: H[] = [{ node: b1 }, { node: b2 }];
  const a = rs.at(1)!;
  const f = rs.find((x) => x.node.s === "a")!;
  const h = rs.shift()!;
  console.log(a.node.s, f.node.s, h.node.s);
}
// expect: b a a
// case: ref_arrays_at_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.at(0)!;
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_at_option_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.at(0);
  eat(b1);
  if (v !== null) console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_find_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.find((x) => x.s === "a")!;
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_find_last_option_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1];
  const v = rs.findLast((x) => x !== null);
  eat(b1);
  if (v !== null) console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_find_object_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
type H = { node: Ref<B> };
function main() {
  let b1 = new B("a");
  let rs: H[] = [{ node: b1 }];
  const v = rs.find((x) => x.node.s === "a")!;
  eat(b1);
  console.log(v.node.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_shift_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.shift()!;
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_at_change
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.at(0)!;
  b1.s = "z";
  console.log(v.s);
}
// error: cannot change 'b1.s' while 'v' borrows 'b1' and is used later
// case: ref_arrays_at_return_local
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(): Ref<B> {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  return rs.at(0)!;
}
function main() { console.log(f().s); }
// error: this function returns a reference but borrows nothing it could point into
// case: ref_arrays_find_return_local
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(): Ref<B> {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  return rs.find((x) => true)!;
}
function main() { console.log(f().s); }
// error: this function returns a reference but borrows nothing it could point into
// case: ref_arrays_at_return_parameter
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function first(xs: Ref<Ref<B>[]>): Ref<B> { return xs.at(0)!; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(first(rs).s);
}
// expect: a
// case: ref_arrays_at_return_parameter_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function first(xs: Ref<Ref<B>[]>): Ref<B> { return xs.at(0)!; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = first(rs);
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used later
// case: ref_arrays_at_rebind
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b0 = new B("z"); let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let cur: Ref<B> = b0;
  { cur = rs.at(0)!; }
  { cur = rs.shift()!; }
  console.log(cur.s);
}
// expect: a
// case: ref_arrays_at_rebind_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b0 = new B("z");
  let cur: Ref<B> = b0;
  { let b1 = new B("a"); let rs: Ref<B>[] = [b1]; cur = rs.at(0)!; }
  console.log(cur.s);
}
// error: 'cur' can only be pointed at a variable
// case: ref_arrays_at_field_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { r: Ref<B>; constructor(r: Ref<B>) { this.r = r; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const k = new K(rs.at(0)!);
  eat(b1);
  console.log(k.r.s);
}
// error: cannot move 'b1' while 'k' borrows 'b1' and is used later
// case: ref_arrays_find_push_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [];
  qs.push(rs.find((x) => true)!);
  eat(b1);
  console.log(qs[0].s);
}
// error: cannot move 'b1' while 'qs' borrows 'b1' and is used later
// case: ref_arrays_index_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(x: Ref<B>, y: B) { console.log(x.s, y.s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs[0], b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_pop_argument_same_call_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(x: Ref<B>, y: B) { console.log(x.s, y.s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.pop()!, b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_at_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(x: Ref<B>, y: B) { console.log(x.s, y.s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.at(0)!, b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_nested_index_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(x: Ref<B>, y: B) { console.log(x.s, y.s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[][] = [[b1]];
  show(rs[0][0], b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_new_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { r: Ref<B>; o: B; constructor(r: Ref<B>, o: B) { this.r = r; this.o = o; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const k = new K(rs[0], b1);
  console.log(k.r.s);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
// case: ref_arrays_literal_argument_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(xs: Ref<B>[], y: B) { console.log(xs[0].s, y.s); }
function main() {
  let b1 = new B("a");
  let r: Ref<B> = b1;
  show([r], b1);
}
// error: cannot move 'b1' while 'r' borrows 'b1' and is used later
// case: ref_arrays_owned_at
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let xs: B[] = [new B("a")];
  const v = xs.at(0)!;
  xs.push(new B("b"));
  console.log(v.s, xs.length);
}
// expect: a 2
// case: ref_arrays_copy_ok_filter
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.filter((x) => x.s !== "z");
  console.log(ys.length, ys[0].s);
}
// expect: 2 a
// case: ref_arrays_copy_ok_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.slice(0, 1);
  console.log(ys.length, ys[0].s);
}
// expect: 1 a
// case: ref_arrays_copy_ok_concat
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.concat(rs);
  console.log(ys.length, ys[0].s);
}
// expect: 4 a
// case: ref_arrays_copy_ok_toReversed
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toReversed();
  console.log(ys.length, ys[0].s);
}
// expect: 2 b
// case: ref_arrays_copy_ok_toSorted
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSorted((p, q) => (p.s.length as i64) - (q.s.length as i64));
  console.log(ys.length, ys[0].s);
}
// expect: 2 a
// case: ref_arrays_copy_ok_flat
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[][] = [[b1], [b2]];
  const ys = rs.flat();
  console.log(ys.length, ys[1].s);
}
// expect: 2 b
// case: ref_arrays_copy_ok_from
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = Array.from(rs);
  console.log(ys.length, ys[0].s);
}
// expect: 2 a
// case: ref_arrays_copy_ok_opt
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  const ys = rs.filter((x) => x !== null).concat(rs.slice(1)).toReversed();
  console.log(ys.length, ys[0] === null);
}
// expect: 2 true
// case: ref_arrays_copy_bad_filter
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.filter((x) => x.s !== "z");
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.slice(0, 1);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_concat
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.concat(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_concat_other
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [b3];
  const ys = rs.concat(qs);
  eat(b3);
  console.log(ys[1].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_copy_bad_concat_literal
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.concat([b3]);
  eat(b3);
  console.log(ys[1].s);
}
// error: 'ys' would keep borrowing this temporary, which is gone once its statement ends; give it
// case: ref_arrays_copy_bad_toReversed
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toReversed();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_toSorted
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSorted((p, q) => (p.s.length as i64) - (q.s.length as i64));
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_flat
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[][] = [[b1], [b2]];
  const ys = rs.flat();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_from
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = Array.from(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let ys: Ref<B>[] = [b1];
  { let b3 = new B("c"); let rs: Ref<B>[] = [b3]; ys = rs.slice(0); }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_copy_bad_change
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.slice(0);
  b1.s = "z";
  console.log(ys[0].s);
}
// error: cannot change 'b1.s' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_obj
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
type H = { node: Ref<B> };
function main() {
  let b1 = new B("a");
  let rs: H[] = [{ node: b1 }];
  const ys = rs.slice(0);
  eat(b1);
  console.log(ys[0].node.s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_opt_chain
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  const ys = rs.filter((x) => x !== null).concat(rs.slice(1)).toReversed();
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_field_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[] = []; all(): Ref<B>[] { return this.items.slice(0); } }
function main() {
  let b1 = new B("a");
  let k = new K();
  k.items.push(b1);
  const ys = k.all();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_arg_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], y: B) { console.log(xs[0].s, y.s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.slice(0), b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_copy_bad_loop_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  for (const x of rs.slice(0)) { eat(b1); console.log(x.s); }
}
// error: cannot move 'b1' while a 'for...of' loop and 'x' borrow 'b1' and are used
// case: ref_arrays_copy_bad_index_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.slice(0)[0];
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used
// case: ref_arrays_copy_free_filter
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.filter((x) => x.s !== "z");
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.slice(0, 1);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_concat
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.concat(rs);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_concat_other
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [b3];
  const ys = rs.concat(qs);
  eatAll(qs);
  console.log(ys[1].s);
}
// expect: c
// case: ref_arrays_copy_free_toReversed
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toReversed();
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: b
// case: ref_arrays_copy_free_toSorted
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSorted((p, q) => (p.s.length as i64) - (q.s.length as i64));
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_from
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = Array.from(rs);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_ret_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  return rs.slice(0, 1);
}
function main() { console.log(f()[0].s); }
// error: can't return a reference to 'b1', which belongs to this function and is gone once it
// case: ref_arrays_copy_param_filter
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(rs: Ref<Ref<B>[]>): Ref<B>[] { return rs.filter((x) => x.s !== "z"); }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = f(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copies_bad_assign
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [b2];
  ys = rs.slice(0);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copies_bad_chain
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.slice(0).filter((x) => x.s === "a").toReversed()[0];
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used
// case: ref_arrays_copies_bad_closure_capture
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const f = () => rs.slice(0).length;
  eat(b1);
  console.log(f());
}
// error: cannot move 'b1' while 'f' borrows 'b1' and is used
// case: ref_arrays_copies_bad_concat_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    let qs: Ref<B>[] = [b3];
    ys = rs.concat(qs);
  }
  console.log(ys[1].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_copies_bad_field
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[]; constructor(items: Ref<B>[]) { this.items = items; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const k = new K(rs.slice(0));
  eat(b1);
  console.log(k.items[0].s);
}
// error: cannot move 'b1' while 'k' borrows 'b1' and is used
// case: ref_arrays_copies_bad_flat_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    let rr: Ref<B>[][] = [[b3]];
    ys = rr.flat();
  }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_copies_bad_from_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    let rs: Ref<B>[] = [b3];
    ys = Array.from(rs);
  }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_copies_bad_loop_acc
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let acc: Ref<B>[] = [];
  for (let i = 0; i < 2; i++) acc = acc.concat(rs);
  eat(b1);
  console.log(acc[0].s);
}
// error: cannot move 'b1' while 'acc' borrows 'b1' and is used
// case: ref_arrays_copies_bad_method_ret
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[] = []; add(this: Mut<this>, b: Ref<B>) { this.items.push(b); } copy(): Ref<B>[] { return this.items.slice(0); } }
function main() {
  let b1 = new B("a");
  let k = new K();
  k.add(b1);
  const ys = k.copy();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copies_bad_option_elem
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  const ys = rs.filter((x) => x !== null);
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copies_bad_push_elem
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let out: Ref<B>[] = [];
  out.push(rs.slice(0)[0]);
  eat(b1);
  console.log(out[0].s);
}
// error: cannot move 'b1' while 'out' borrows 'b1' and is used
// case: ref_arrays_copies_bad_push_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let rr: Ref<B>[][] = [];
  rr.push(rs.slice(0));
  eat(b1);
  console.log(rr[0][0].s);
}
// error: cannot move 'b1' while 'rr' borrows 'b1' and is used
// case: ref_arrays_copies_bad_reassign_self
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  rs = rs.slice(1);
  eat(b2);
  console.log(rs[0].s);
}
// error: cannot move 'b2' while 'rs' borrows 'b2' and is used
// case: ref_arrays_copies_bad_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(xs: Ref<B>[]): Ref<B>[] { return xs.filter((x) => x.s === "a"); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = f(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copies_bad_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.slice(0), b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_copies_bad_scope_push
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let out: Ref<B>[] = [];
  {
    let b1 = new B("a");
    let rs: Ref<B>[] = [b1];
    out.push(rs.filter((x) => true)[0]);
  }
  console.log(out[0].s);
}
// error: 'b1' doesn't live long enough: 'out' still borrows it after its block
// case: ref_arrays_copies_ok_chain
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.slice(0).filter((x) => x.s === "a").toReversed()[0];
  rs.pop();
  console.log(v.s);
}
// expect: a
// case: ref_arrays_copies_ok_owned_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys = xs.slice(0);
  xs.push(new B("b"));
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copies_ok_reassign_self
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  rs = rs.slice(1);
  console.log(rs[0].s);
}
// expect: b
// case: ref_arrays_copies_ok_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function f(xs: Ref<B>[]): Ref<B>[] { return xs.slice(0); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = f(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_store_bad_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.fill(b3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_fill_range
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.fill(b3, 0, 1);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_fill_temp
class B { s: string; constructor(s: string) { this.s = s; } }
function mk(): B { return new B("t"); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  rs.fill(mk());
  console.log(rs[0].s);
}
// error: 'rs' would keep borrowing this temporary, which is gone once its statement ends; give it
// case: ref_arrays_store_bad_old_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.fill(b3);
  eat(b2);
  console.log(rs[1].s);
}
// error: cannot move 'b2' while 'rs' borrows 'b2' and is used
// case: ref_arrays_store_bad_old_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.splice(0, 1, b3);
  eat(b2);
  console.log(rs[1].s);
}
// error: cannot move 'b2' while 'rs' borrows 'b2' and is used
// case: ref_arrays_store_bad_old_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(0, 1, b3);
  eat(b2);
  console.log(ys[1].s);
}
// error: cannot move 'b2' while 'ys' borrows 'b2' and is used
// case: ref_arrays_store_bad_old_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.unshift(b3);
  eat(b2);
  console.log(rs[1].s);
}
// error: cannot move 'b2' while 'rs' borrows 'b2' and is used
// case: ref_arrays_store_bad_old_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(0, b3);
  eat(b2);
  console.log(ys[1].s);
}
// error: cannot move 'b2' while 'ys' borrows 'b2' and is used
// case: ref_arrays_store_bad_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.splice(0, 1, b3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_splice_both
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const gone = rs.splice(0, 1, b3);
  eat(b3);
  console.log(gone[0].s, rs[0].s);
}
// error: cannot move 'b3' while 'rs' and 'gone' borrow 'b3' and are used
// case: ref_arrays_store_bad_splice_result
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const gone = rs.splice(0, 1);
  eat(b1);
  console.log(gone[0].s);
}
// error: cannot move 'b1' while 'gone' borrows 'b1' and is used
// case: ref_arrays_store_bad_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(0, 1, b3);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_store_bad_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.unshift(b3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_unshift_elem
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [b3];
  rs.unshift(qs[0]);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_unshift_obj
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: N[] = [{ of: "b", node: b1 }];
  rs.unshift({ of: "b", node: b3 });
  eat(b3);
  console.log(rs.length);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_bad_unshift_two
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c"); let b4 = new B("d");
  let rs: Ref<B>[] = [b1];
  rs.unshift(b3, b4);
  eat(b4);
  console.log(rs[1].s);
}
// error: cannot move 'b4' while 'rs' borrows 'b4' and is used
// case: ref_arrays_store_bad_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(0, b3);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_store_bad_with_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.with(0, b3), b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_store_field_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r3: Ref<B> = b3;
  rs.fill(r3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_field_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r3: Ref<B> = b3;
  rs.splice(0, 1, r3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_field_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r3: Ref<B> = b3;
  const ys = rs.toSpliced(0, 1, r3);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_store_field_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r3: Ref<B> = b3;
  rs.unshift(r3);
  eat(b3);
  console.log(rs[0].s);
}
// error: cannot move 'b3' while 'rs' borrows 'b3' and is used
// case: ref_arrays_store_field_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r3: Ref<B> = b3;
  const ys = rs.with(0, r3);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_store_free_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.with(0, b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: c
// case: ref_arrays_store_ok_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.fill(b3);
  console.log(rs.length, rs[0].s);
}
// expect: 2 c
// case: ref_arrays_store_ok_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.splice(0, 1, b3);
  console.log(rs.length, rs[0].s);
}
// expect: 2 c
// case: ref_arrays_store_ok_splice_result
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const gone = rs.splice(0, 1);
  rs.pop();
  console.log(gone[0].s, rs.length);
}
// expect: a 0
// case: ref_arrays_store_ok_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(0, 1, b3);
  console.log(ys.length, ys[0].s);
}
// expect: 2 c
// case: ref_arrays_store_ok_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  rs.unshift(b3);
  console.log(rs.length, rs[0].s);
}
// expect: 3 c
// case: ref_arrays_store_ok_unshift_elem
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [b3];
  rs.unshift(qs[0]);
  qs.pop();
  console.log(rs[0].s);
}
// expect: c
// case: ref_arrays_store_ok_with
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(0, b3);
  console.log(ys.length, ys[0].s);
}
// expect: 2 c
// case: ref_arrays_store_ref_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Mut<Ref<B>[]>, b3: Ref<B>): usize {
  rs.fill(b3);
  return rs.length;
}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs, b3));
}
// error: keeping references through the reference 'rs' is not supported yet; do it on what 'rs'
// case: ref_arrays_store_ref_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Mut<Ref<B>[]>, b3: Ref<B>): usize {
  rs.splice(0, 1, b3);
  return rs.length;
}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs, b3));
}
// error: keeping references through the reference 'rs' is not supported yet; do it on what 'rs'
// case: ref_arrays_store_ref_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Mut<Ref<B>[]>, b3: Ref<B>): usize {
  const ys = rs.toSpliced(0, 1, b3);
  return ys.length;
}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs, b3));
}
// expect: 1
// case: ref_arrays_store_ref_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Mut<Ref<B>[]>, b3: Ref<B>): usize {
  rs.unshift(b3);
  return rs.length;
}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs, b3));
}
// error: keeping references through the reference 'rs' is not supported yet; do it on what 'rs'
// case: ref_arrays_store_ref_with
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Mut<Ref<B>[]>, b3: Ref<B>): usize {
  const ys = rs.with(0, b3);
  return ys.length;
}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs, b3));
}
// expect: 1
// case: ref_arrays_store_scope_fill
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  let keep: Ref<B>[] = [];
  {
    let b3 = new B("c");
    rs.fill(b3);
    keep = rs;
  }
  console.log(keep[0].s);
}
// error: 'b3' doesn't live long enough: 'keep' still borrows it after its block
// case: ref_arrays_store_scope_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  let keep: Ref<B>[] = [];
  {
    let b3 = new B("c");
    rs.splice(0, 1, b3);
    keep = rs;
  }
  console.log(keep[0].s);
}
// error: 'b3' doesn't live long enough: 'keep' still borrows it after its block
// case: ref_arrays_store_scope_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  let keep: Ref<B>[] = [];
  {
    let b3 = new B("c");
    const ys = rs.toSpliced(0, 1, b3);
    keep = ys;
  }
  console.log(keep[0].s);
}
// error: 'b3' doesn't live long enough: 'keep' still borrows it after its block
// case: ref_arrays_store_scope_unshift
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  let keep: Ref<B>[] = [];
  {
    let b3 = new B("c");
    rs.unshift(b3);
    keep = rs;
  }
  console.log(keep[0].s);
}
// error: 'b3' doesn't live long enough: 'keep' still borrows it after its block
// case: ref_arrays_store_scope_with
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  let keep: Ref<B>[] = [];
  {
    let b3 = new B("c");
    const ys = rs.with(0, b3);
    keep = ys;
  }
  console.log(keep[0].s);
}
// error: 'b3' doesn't live long enough: 'keep' still borrows it after its block
// case: ref_arrays_lent_with_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.with(0, b3), b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_lent_concat_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [];
  show(rs.concat([b1]), b1);
}
// error: cannot move 'b1' while 'b1' is lent to 'show' for this
// case: ref_arrays_lent_with_index_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(x: Ref<B>, _b: B) { console.log(x.s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.with(0, b3)[0], b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_lent_with_chain_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.with(0, b3).slice(0).toReversed(), b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_lent_tospliced_at_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(x: Ref<B>, _b: B) { console.log(x.s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.toSpliced(0, 0, b3).at(0)!, b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_lent_ok_with_arg
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function show(xs: Ref<B>[]) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show(rs.with(0, b3));
  eat(b3);
}
// expect: c
// case: ref_arrays_copy_ok_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.splice(0, 1);
  console.log(ys.length, ys[0].s);
}
// expect: 1 a
// case: ref_arrays_copy_ok_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(1, 1);
  console.log(ys.length, ys[0].s);
}
// expect: 1 a
// case: ref_arrays_copy_ok_with
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(1, rs[0]);
  console.log(ys.length, ys[0].s);
}
// expect: 2 a
// case: ref_arrays_copy_bad_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.splice(0, 1);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(1, 1);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_bad_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(1, rs[0]);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_copy_free_splice
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.splice(0, 1);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_toSpliced
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.toSpliced(1, 1);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_copy_free_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.with(1, rs[0]);
  rs.push(b3);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_spread_bad_assign_field
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[] = []; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let k = new K();
  k.items = [...rs];
  eat(b1);
  console.log(k.items[0].s);
}
// error: cannot move 'b1' while 'k' borrows 'b1' and is used
// case: ref_arrays_spread_bad_copy
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = [...rs];
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_spread_bad_field
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[]; constructor(items: Ref<B>[]) { this.items = [...items]; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const k = new K(rs);
  eat(b1);
  console.log(k.items[0].s);
}
// error: cannot move 'b1' while 'k' borrows 'b1' and is used
// case: ref_arrays_spread_bad_mixed_new
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys: Ref<B>[] = [...rs, b3];
  eat(b3);
  console.log(ys[1].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_spread_bad_mixed_old
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys: Ref<B>[] = [b3, ...rs];
  eat(b1);
  console.log(ys[1].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_spread_bad_nested
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const rr: Ref<B>[][] = [[...rs]];
  eat(b1);
  console.log(rr[0][0].s);
}
// error: cannot move 'b1' while 'rr' borrows 'b1' and is used
// case: ref_arrays_spread_bad_obj
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: N[] = [{ of: "b", node: b1 }];
  const ys = [...rs];
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_spread_bad_owned_spread
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let xs = [b1];
  const ys: Ref<B>[] = [...xs];
  console.log(ys.length);
}
// error: spreads of owned values into arrays of references are not supported
// case: ref_arrays_spread_bad_push_many
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let out: Ref<B>[] = [];
  out.push(...rs);
  eat(b1);
  console.log(out[0].s);
}
// error: '...' spreads into an array literal, or as an argument into a rest parameter, as in
// case: ref_arrays_spread_bad_push_spread
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let rr: Ref<B>[][] = [];
  rr.push([...rs]);
  eat(b1);
  console.log(rr[0][0].s);
}
// error: cannot move 'b1' while 'rr' borrows 'b1' and is used
// case: ref_arrays_spread_bad_rest_keep
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[] = []; add(this: Mut<this>, ...xs: Ref<B>[]) { for (const x of xs) this.items.push(x); } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let k = new K();
  k.add(...rs);
  eat(b1);
  console.log(k.items[0].s);
}
// error: can't store in 'this' a reference to 'xs[...]', which belongs to this function and is
// case: ref_arrays_spread_bad_rest_ret
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function first(...xs: Ref<B>[]): Ref<B> { return xs[0]; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = first(...rs);
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used
// case: ref_arrays_spread_bad_rest_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(_b: B, ...xs: Ref<B>[]) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(b1, ...rs);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_spread_bad_ret
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  return [...rs];
}
function main() { console.log(f().length); }
// error: can't return a reference to 'b1', which belongs to this function and is gone once it
// case: ref_arrays_spread_bad_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(xs: Ref<B>[]): Ref<B>[] { return [...xs]; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = f(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_spread_bad_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show([...rs], b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_spread_bad_same_call_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  show([...rs.with(0, b3)], b3);
}
// error: cannot move 'b3' while 'b3' is lent to 'show' for this
// case: ref_arrays_spread_bad_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    let qs: Ref<B>[] = [b3];
    ys = [...qs];
  }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_spread_bad_temp
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = [...rs.with(0, b3)];
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_spread_bad_temp_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = [...rs.slice(0)];
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_spread_bad_two
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  let qs: Ref<B>[] = [b3];
  const ys = [...rs, ...qs];
  eat(b3);
  console.log(ys[1].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_spread_free_copy
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = [...rs];
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_spread_ok_copy
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = [...rs];
  console.log(ys.length, ys[1].s);
}
// expect: 2 b
// case: ref_arrays_spread_ok_mixed
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1, b2];
  const r: Ref<B> = b3;
  const ys = [...rs, r, b3, ...rs];
  console.log(ys.length, ys[2].s, ys[4].s);
}
// expect: 6 c a
// case: ref_arrays_spread_ok_option
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  const ys = [...rs, null];
  console.log(ys.length);
}
// expect: 3
// case: ref_arrays_spread_ok_rest
class B { s: string; constructor(s: string) { this.s = s; } }
function all(...xs: Ref<B>[]): usize { return xs.length; }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  console.log(all(...rs));
}
// expect: 2
// case: ref_arrays_spread_ok_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function f(xs: Ref<B>[]): Ref<B>[] { return [...xs]; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs)[0].s);
}
// expect: a
// case: ref_arrays_spread_ok_string
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  const cs = [..."ab"];
  console.log(cs.length);
}
// expect: 2
// case: ref_arrays_temp_call_at
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function mk(b: Ref<B>): Ref<B>[] { return [b]; }
function main() {
  let b1 = new B("a");
  const v = mk(b1).at(0)!;
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used
// case: ref_arrays_temp_call_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function mk(b: Ref<B>): Ref<B>[] { return [b]; }
function main() {
  let b1 = new B("a");
  const ys = mk(b1).slice(0);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_temp_chain_with_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.with(0, b3).slice(0);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_temp_concat_with
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.concat(rs.with(0, b3));
  eat(b3);
  console.log(ys[1].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_temp_field_slice_free
class B { s: string; constructor(s: string) { this.s = s; } }
class K { items: Ref<B>[] = []; }
function main() {
  let b1 = new B("a");
  let k = new K();
  k.items.push(b1);
  const ys = k.items.slice(0);
  k.items.pop();
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_temp_lit_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  const r: Ref<B> = b1;
  const ys = [r].slice(0);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_temp_nested_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rr: Ref<B>[][] = [[b1]];
  const ys = rr[0].slice(0);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_temp_ok_nested_slice
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rr: Ref<B>[][] = [[b1]];
  const ys = rr[0].slice(0);
  rr.pop();
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_temp_owned_spread_pop
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys: Ref<B>[] = [...xs];
  xs.pop();
  console.log(ys[0].s);
}
// error: spreads of owned values into arrays of references are not supported
// case: ref_arrays_temp_owned_spread_read
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys: Ref<B>[] = [...xs];
  console.log(ys[0].s);
}
// error: spreads of owned values into arrays of references are not supported
// case: ref_arrays_clone_bad_clone_index
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.clone()[0];
  eat(b1);
  console.log(v.s);
}
// error: cannot move 'b1' while 'v' borrows 'b1' and is used
// case: ref_arrays_clone_bad_elem_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rr: Ref<B>[][] = [[b1]];
  const ys = rr[0].clone();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_field_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class K { items: Ref<B>[] = []; add(this: Mut<this>, b: Ref<B>) { this.items.push(b); } copy(): Ref<B>[] { return this.items.clone(); } }
function main() {
  let b1 = new B("a");
  let k = new K();
  k.add(b1);
  const ys = k.copy();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_holder_obj
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
type H = { items: Ref<B>[] };
function main() {
  let b1 = new B("a");
  let h: H = { items: [b1] };
  const c = h.clone();
  eat(b1);
  console.log(c.items[0].s);
}
// error: cannot move 'b1' while 'c' borrows 'b1' and is used
// case: ref_arrays_clone_bad_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.clone();
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_nested
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rr: Ref<B>[][] = [[b1]];
  const ys = rr.clone();
  eat(b1);
  console.log(ys[0][0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_obj_elem
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: N[] = [{ of: "b", node: b1 }];
  const ys = rs.clone();
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_option
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  const ys = rs.clone();
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_ret_local
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  return rs.clone();
}
function main() { console.log(f().length); }
// error: can't return a reference to 'b1', which belongs to this function and is gone once it
// case: ref_arrays_clone_bad_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function f(xs: Ref<Ref<B>[]>): Ref<B>[] { return xs.clone(); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = f(rs);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_clone_bad_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.clone(), b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_clone_bad_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    let qs: Ref<B>[] = [b3];
    ys = qs.clone();
  }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_clone_bad_temp_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.with(0, b3).clone();
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_clone_fixed_clone
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const c = rs.clone().clone();
  eat(b1);
  console.log(c[0].s);
}
// error: cannot move 'b1' while 'c' borrows 'b1' and is used
// case: ref_arrays_clone_free_hand_away
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.clone();
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_clone_free_push
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.clone();
  rs.push(b3);
  console.log(ys.length, rs.length, ys[0].s);
}
// expect: 1 2 a
// case: ref_arrays_clone_holder_obj_then_drop
class B { s: string; constructor(s: string) { this.s = s; } }
type H = { items: Ref<B>[] };
function eatH(_h: H) {}
function main() {
  let b1 = new B("a");
  let h: H = { items: [b1] };
  const c = h.clone();
  eatH(h);
  console.log(c.items[0].s);
}
// error: cannot move 'h' while 'c' borrows 'h' and is used
// case: ref_arrays_clone_ok
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.clone();
  console.log(ys.length, ys[1].s);
}
// expect: 2 b
// case: ref_arrays_clone_ok_clone_index
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const v = rs.clone()[0];
  rs.pop();
  console.log(v.s);
}
// expect: a
// case: ref_arrays_clone_ok_nested_free
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rr: Ref<B>[][] = [[b1]];
  const ys = rr.clone();
  rr.pop();
  console.log(ys[0][0].s);
}
// expect: a
// case: ref_arrays_show_eq_in_object
class B { s: string; constructor(s: string) { this.s = s; } }
@derive(Eq)
class E { s: string; constructor(s: string) { this.s = s; } }
type H = { items: Ref<E>[] };
function main() {
  let e1 = new E("a"); let e2 = new E("a");
  let h1: H = { items: [e1] };
  let h2: H = { items: [e2] };
  let h3: H = { items: [] };
  console.log(h1 === h2, h1 === h3);
}
// expect: true false
// case: ref_arrays_show_eq_nested
class B { s: string; constructor(s: string) { this.s = s; } }
@derive(Eq)
class E { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let e1 = new E("a"); let e2 = new E("a");
  let xs: Ref<E>[][] = [[e1], []];
  let ys: Ref<E>[][] = [[e2], []];
  let zs: Ref<E>[][] = [[], [e2]];
  console.log(xs === ys, xs === zs);
}
// expect: true false
// case: ref_arrays_show_eq_none
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [b1];
  console.log(rs === ys);
}
// error: values of type 'B' can't be compared with '===': a class compares through 'equals(other:
// case: ref_arrays_show_eq_null
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] | null = [b1];
  console.log(rs === null, rs !== null);
}
// expect: false true
// case: ref_arrays_show_eq_option
class B { s: string; constructor(s: string) { this.s = s; } }
@derive(Eq)
class E { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let e1 = new E("a"); let e2 = new E("a");
  let xs: (Ref<E> | null)[] = [e1, null];
  let ys: (Ref<E> | null)[] = [e2, null];
  let zs: (Ref<E> | null)[] = [null, e2];
  console.log(xs === ys, xs === zs);
}
// expect: true false
// case: ref_arrays_show_eq_string
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  const a = "x"; const b = "y";
  let xs: Ref<string>[] = [a, b];
  let ys: Ref<string>[] = [a, b];
  let zs: Ref<string>[] = [b, a];
  console.log(xs === ys, xs === zs);
}
// expect: true false
// case: ref_arrays_show_eq_true
class B { s: string; constructor(s: string) { this.s = s; } }
@derive(Eq)
class E { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let e1 = new E("a"); let e2 = new E("a"); let e3 = new E("b");
  let xs: Ref<E>[] = [e1, e3];
  let ys: Ref<E>[] = [e2, e3];
  let zs: Ref<E>[] = [e1];
  let ws: Ref<E>[] = [e3, e1];
  let n1: Ref<E>[] = [];
  let n2: Ref<E>[] = [];
  console.log(xs === ys, xs === zs, xs === ws, n1 === n2, xs !== ys, xs !== ws);
}
// expect: true false false true false true
// case: ref_arrays_show_print_after_change
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1];
  rs.push(b2);
  rs.unshift(b2);
  console.log(rs, rs.slice(1), [...rs, b1].length);
}
// expect: [ B { s: 'b' }, B { s: 'a' }, B { s: 'b' } ] [ B { s: 'a' }, B { s: 'b' } ] 4
// case: ref_arrays_show_print_basic
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: (Ref<B> | null)[] = [b1, null];
  console.log(rs);
}
// expect: [ B { s: 'a' }, null ]
// case: ref_arrays_show_print_empty
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let rs: Ref<B>[] = [];
  console.log(rs);
}
// expect: []
// case: ref_arrays_show_print_in_object
class B { s: string; constructor(s: string) { this.s = s; } }
type H = { items: Ref<B>[]; n: i64 };
function main() {
  let b1 = new B("a");
  let h: H = { items: [b1], n: 2 };
  console.log(h);
}
// expect: { items: [ B { s: 'a' } ], n: 2 }
// case: ref_arrays_show_print_nested
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rr: Ref<B>[][] = [[b1, b2], []];
  console.log(rr);
}
// expect: [ [ B { s: 'a' }, B { s: 'b' } ], [] ]
// case: ref_arrays_show_print_obj_elems
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let b1 = new B("a");
  let rs: N[] = [{ of: "b", node: b1 }, { of: "n" }];
  console.log(rs);
}
// expect: [ { node: B { s: 'a' }, of: 'b' }, { of: 'n' } ]
// case: ref_arrays_show_print_strings
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  const a = "x"; const b = "y";
  let xs: Ref<string>[] = [a, b];
  console.log(xs);
}
// expect: [ 'x', 'y' ]
// case: ref_arrays_show_print_template
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(`${rs.length} ${rs[0].s}`, rs, 1);
}
// expect: 1 a [ B { s: 'a' } ] 1
// case: ref_arrays_gives_bad_capture
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const r: Ref<B> = b3;
  const ys = rs.map((x) => r);
  eat(b3);
  console.log(ys[0].s);
}
// error: cannot move 'b3' while 'ys' borrows 'b3' and is used
// case: ref_arrays_gives_bad_capture_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x): Ref<B> => b3);
  eat(b3);
  console.log(ys[0].s);
}
// error: can't return a reference to 'b3', which belongs to this function and is gone once it
// case: ref_arrays_gives_bad_identity
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x) => x);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_gives_bad_local
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x): Ref<B> => { const t = new B("t"); return t; });
  console.log(ys[0].s);
}
// error: can't return a reference to 't', which belongs to this function and is gone once it
// case: ref_arrays_gives_bad_owned_move
class B { s: string; constructor(s: string) { this.s = s; } }
function eatBs(_xs: B[]) {}
function main() {
  let xs = [new B("a")];
  const ys = xs.map((x) => x);
  eatBs(xs);
  console.log(ys[0].s);
}
// error: cannot move 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gives_bad_owned_push
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys = xs.map((x) => x);
  xs.push(new B("b"));
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gives_bad_owned_ret
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let xs = [new B("a")];
  return xs.map((x) => x);
}
function main() { console.log(f().length); }
// error: can't return a reference to 'xs', which belongs to this function and is gone once it
// case: ref_arrays_gives_bad_reduce
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const best = rs.reduce((acc, x) => x.s > acc.s ? x : acc);
  eat(b2);
  console.log(best.s);
}
// error: cannot move 'b2' while 'best' borrows 'b2' and is used
// case: ref_arrays_gives_bad_reduce_init
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const r: Ref<B> = b3;
  const best = rs.reduce((acc, x) => x.s > acc.s ? x : acc, r);
  eat(b3);
  console.log(best.s);
}
// error: cannot move 'b3' while 'best' borrows 'b3' and is used
// case: ref_arrays_gives_bad_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(xs: Ref<B>[], _b: B) { console.log(xs[0].s); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  show(rs.map((x) => x), b1);
}
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used
// case: ref_arrays_gives_flatmap_ref
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.flatMap((x) => [x]);
  eat(b1);
  console.log(ys[0].s);
}
// error: closures returning references are not supported
// case: ref_arrays_gives_foreach_ref
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  rs.forEach((x) => x);
}
// error: closures returning references are not supported
// case: ref_arrays_gives_free_identity
class B { s: string; constructor(s: string) { this.s = s; } }
function eatAll(_xs: Ref<B>[]) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x) => x);
  eatAll(rs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_gives_ok_capture
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const r: Ref<B> = b3;
  const ys = rs.map((x) => r);
  console.log(ys[0].s);
}
// expect: c
// case: ref_arrays_gives_ok_identity
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.map((x) => x);
  console.log(ys.length, ys[1].s);
}
// expect: 2 b
// case: ref_arrays_gives_ok_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a"), new B("b")];
  const ys = xs.map((x) => x);
  console.log(ys.length, ys[1].s);
}
// expect: 2 b
// case: ref_arrays_gives_ok_reduce
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const best = rs.reduce((acc, x) => x.s > acc.s ? x : acc);
  console.log(best.s);
}
// expect: b
// case: ref_arrays_gives_other_closure
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  const f = (x: Ref<B>) => x;
  console.log(f(b1).s);
}
// error: closures returning references are not supported
// case: ref_arrays_gave_bad_capture_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(ys: Ref<B>[], _b: B) { console.log(ys[0].s); }
function main() {
  let b1 = new B("a"); let b3 = new B("c");
  let rs: Ref<B>[] = [b1];
  const r: Ref<B> = b3;
  show(rs.map((x) => r), b3);
}
// error: cannot move 'b3' while 'r' borrows 'b3' and is used
// case: ref_arrays_gave_bad_capture_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  let ys: Ref<B>[] = [];
  {
    let b3 = new B("c");
    const r: Ref<B> = b3;
    ys = rs.map((x) => r);
  }
  console.log(ys[0].s);
}
// error: 'b3' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_gave_bad_chain
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys = xs.map((x) => x).slice(0);
  xs.push(new B("b"));
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_chain_index
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const v = xs.map((x) => x)[0];
  xs.pop();
  console.log(v.s);
}
// error: cannot change 'xs' while 'v' borrows 'xs' and is used
// case: ref_arrays_gave_bad_child
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class P { child: Ref<B>; constructor(child: Ref<B>) { this.child = child; } }
function main() {
  let b1 = new B("a");
  let ps = [new P(b1)];
  const ys = ps.map((p) => p.child);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_gave_bad_child_ref
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
class P { child: Ref<B>; constructor(child: Ref<B>) { this.child = child; } }
function main() {
  let b1 = new B("a");
  let p1 = new P(b1);
  let ps: Ref<P>[] = [p1];
  const ys = ps.map((p) => p.child);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_gave_bad_inner_closure
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x) => { const g = () => x; return g(); });
  console.log(ys[0].s);
}
// error: closures returning references are not supported
// case: ref_arrays_gave_bad_local_in_block
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x): Ref<B> => { const t = new B("t"); const r: Ref<B> = t; return r; });
  console.log(ys[0].s);
}
// error: can't return a reference to 't', which belongs to this function and is gone once it
// case: ref_arrays_gave_bad_loop
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  let acc: Ref<B>[] = [];
  for (let i = 0; i < 2; i++) acc = acc.concat(xs.map((x) => x));
  xs.pop();
  console.log(acc[0].s);
}
// error: cannot change 'xs' while 'acc' borrows 'xs' and is used
// case: ref_arrays_gave_bad_method
class B { s: string; constructor(s: string) { this.s = s; } }
class K {
  items: B[] = [];
  refs(): Ref<B>[] { return this.items.map((x) => x); }
  add(this: Mut<this>, b: B) { this.items.push(b); }
}
function main() {
  let k = new K();
  k.add(new B("a"));
  const ys = k.refs();
  k.add(new B("b"));
  console.log(ys[0].s);
}
// error: cannot mutably lend 'k' while 'ys' borrows 'k' and is used
// case: ref_arrays_gave_bad_named
class B { s: string; constructor(s: string) { this.s = s; } }
function pick(x: Ref<B>): Ref<B> { return x; }
function main() {
  let xs = [new B("a")];
  const ys = xs.map(pick);
  xs.pop();
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_object_result
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let xs = [new B("a")];
  const ys = xs.map((x): N => ({ of: "b", node: x }));
  xs.pop();
  console.log(ys.length);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_objs_temp
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let b1 = new B("a");
  let ns: N[] = [{ of: "b", node: b1 }];
  const ys = ns.slice(0).map((n) => n);
  console.log(ys.length);
}
// error: 'ys' would keep borrowing this temporary, which is gone once its statement ends; give it
// case: ref_arrays_gave_bad_option_result
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map((x): Ref<B> | null => x.s === "a" ? x : null);
  eat(b1);
  console.log(ys.length);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_gave_bad_owned_field
class B { s: string; constructor(s: string) { this.s = s; } }
class P { own: B; constructor(own: B) { this.own = own; } }
function main() {
  let ps = [new P(new B("a"))];
  const ys = ps.map((p): Ref<B> => p.own);
  ps.pop();
  console.log(ys[0].s);
}
// error: cannot change 'ps' while 'ys' borrows 'ps' and is used
// case: ref_arrays_gave_bad_owned_same_call
class B { s: string; constructor(s: string) { this.s = s; } }
function show(ys: Ref<B>[], _xs: B[]) { console.log(ys[0].s); }
function main() {
  let xs = [new B("a")];
  show(xs.map((x) => x), xs);
}
// error: cannot move 'xs' while 'xs' is lent to 'show' for this
// case: ref_arrays_gave_bad_param_owned_elem
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [[new B("a")]];
  const ys = xs.map((row): Ref<B> => row[0]);
  xs.pop();
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_push_map
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  let out: Ref<B>[] = [];
  out.push(xs.map((x) => x)[0]);
  xs.pop();
  console.log(out[0].s);
}
// error: cannot change 'xs' while 'out' borrows 'xs' and is used
// case: ref_arrays_gave_bad_reduce_owned_init
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a"), new B("b")];
  let b3 = new B("0");
  const r: Ref<B> = b3;
  const best = xs.reduce((acc, x) => x.s > acc.s ? x : acc, r);
  xs.pop();
  console.log(best.s);
}
// error: cannot change 'xs' while 'best' borrows 'xs' and is used
// case: ref_arrays_gave_bad_reduce_right
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const best = rs.reduceRight((acc, x) => x.s > acc.s ? x : acc);
  eat(b1);
  console.log(best.s);
}
// error: cannot move 'b1' while 'best' borrows 'b1' and is used
// case: ref_arrays_gave_bad_ref_local
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const xr: Ref<B[]> = xs;
  const ys = xr.map((x) => x);
  xs.pop();
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_ret_local_refs
class B { s: string; constructor(s: string) { this.s = s; } }
function f(): Ref<B>[] {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  return rs.map((x) => x);
}
function main() { console.log(f().length); }
// error: can't return a reference to 'b1', which belongs to this function and is gone once it
// case: ref_arrays_gave_bad_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function f(xs: Ref<B[]>): Ref<B>[] { return xs.map((x) => x); }
function main() {
  let xs = [new B("a")];
  const ys = f(xs);
  xs.pop();
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_scope
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let ys: Ref<B>[] = [];
  {
    let xs = [new B("a")];
    ys = xs.map((x) => x);
  }
  console.log(ys[0].s);
}
// error: 'xs' doesn't live long enough: 'ys' still borrows it after its block
// case: ref_arrays_gave_bad_spread_map
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a")];
  const ys = [...xs.map((x) => x)];
  xs.pop();
  console.log(ys[0].s);
}
// error: cannot change 'xs' while 'ys' borrows 'xs' and is used
// case: ref_arrays_gave_bad_temp_owned
class B { s: string; constructor(s: string) { this.s = s; } }
function mk(): B[] { return [new B("t")]; }
function main() {
  const ys = mk().map((x) => x);
  console.log(ys[0].s);
}
// error: 'ys' would keep borrowing this temporary, which is gone once its statement ends; give it
// case: ref_arrays_gave_bad_temp_refs
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B) {}
function mk(b: Ref<B>): Ref<B>[] { return [b]; }
function main() {
  let b1 = new B("a");
  const ys = mk(b1).map((x) => x);
  eat(b1);
  console.log(ys[0].s);
}
// error: cannot move 'b1' while 'ys' borrows 'b1' and is used
// case: ref_arrays_gave_ok_child
class B { s: string; constructor(s: string) { this.s = s; } }
class P { child: Ref<B>; constructor(child: Ref<B>) { this.child = child; } }
function main() {
  let b1 = new B("a");
  let ps = [new P(b1)];
  const ys = ps.map((p) => p.child);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_gave_ok_index
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let b1 = new B("a"); let b2 = new B("b");
  let rs: Ref<B>[] = [b1, b2];
  const ys = rs.map((x, i) => i === 0 ? rs[1] : x);
  console.log(ys[0].s, ys[1].s);
}
// expect: b b
// case: ref_arrays_gave_ok_named
class B { s: string; constructor(s: string) { this.s = s; } }
function pick(x: Ref<B>): Ref<B> { return x; }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  const ys = rs.map(pick);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_gave_ok_object_result
class B { s: string; constructor(s: string) { this.s = s; } }
type N = { of: "b"; node: Ref<B> } | { of: "n" };
function main() {
  let xs = [new B("a")];
  const ys = xs.map((x): N => ({ of: "b", node: x }));
  console.log(ys);
}
// expect: [ { node: B { s: 'a' }, of: 'b' } ]
// case: ref_arrays_gave_ok_reduce_owned_init
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let xs = [new B("a"), new B("b")];
  let b3 = new B("0");
  const r: Ref<B> = b3;
  const best = xs.reduce((acc, x) => x.s > acc.s ? x : acc, r);
  console.log(best.s);
}
// expect: b
// case: ref_arrays_gave_ok_ret_param
class B { s: string; constructor(s: string) { this.s = s; } }
function f(xs: Ref<B[]>): Ref<B>[] { return xs.map((x) => x); }
function main() {
  let xs = [new B("a")];
  const ys = f(xs);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_gave_ok_ret_param_refs
class B { s: string; constructor(s: string) { this.s = s; } }
function f(rs: Ref<B>[]): Ref<B>[] { return rs.map((x) => x); }
function main() {
  let b1 = new B("a");
  let rs: Ref<B>[] = [b1];
  console.log(f(rs)[0].s);
}
// expect: a
// case: ref_arrays_gave_ok_strings
class B { s: string; constructor(s: string) { this.s = s; } }
function main() {
  let names = ["a", "b"];
  const ys = names.map((s) => s + "!");
  names.push("c");
  console.log(ys);
}
// expect: [ 'a!', 'b!' ]
// case: ref_arrays_gave_ok_temp_refs
class B { s: string; constructor(s: string) { this.s = s; } }
function mk(b: Ref<B>): Ref<B>[] { return [b]; }
function main() {
  let b1 = new B("a");
  const ys = mk(b1).map((x) => x);
  console.log(ys[0].s);
}
// expect: a
// case: ref_arrays_gives_index_of_temporary
// error: would keep borrowing this temporary
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" + 1 }];
  const y = ms.slice(0).map((m) => m)[0];
  console.log(y.k);
}
// case: ref_arrays_gives_index_of_temporary_returned
// error: can't return a reference to a temporary
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function f(q: Ref<M[]>): Ref<M> { return q.slice(0).map((m) => m)[0]; }
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" + 1 }];
  console.log(f(ms).k);
}
// case: ref_arrays_gives_index_of_named
// expect: k1
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" + 1 }];
  const y = ms.map((m) => m)[0];
  console.log(y.k);
}
// case: ref_arrays_gives_index_through_cast
// error: would keep borrowing this temporary
class B { s: string; constructor(s: string) { this.s = s; } }
type M = { node: Ref<B>; k: string };
function main() {
  let b1 = new B("a" + 1);
  let ms: M[] = [{ node: b1, k: "k" + 1 }];
  const y = (ms.slice(0).map((m) => m) as Ref<M>[])[0];
  console.log(y.k);
}
// case: ref_arrays_copy_index_through_cast_moved
// error: cannot move 'b3'
class B { s: string; constructor(s: string) { this.s = s; } }
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let b3 = new B("c" + 3);
  let rs: Ref<B>[] = [b1];
  const lit: Ref<B>[] = [b3];
  const y = (rs.concat(lit) as Ref<B>[])[1];
  eat(b3);
  console.log(y.s);
}
// case: ref_arrays_lifetime_returned
// expect: a1
class B { s: string; constructor(s: string) { this.s = s; } }
function both<A extends Lifetime>(x: Ref<B, A>, _other: Ref<B>): Ref<B, A>[] { return [x]; }
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  const rs = both(b1, b2);
  eat(b2);
  console.log(rs[0].s);
}
// case: ref_arrays_lifetime_returned_moved
// error: cannot move 'b1' while 'rs' borrows 'b1' and is used later
class B { s: string; constructor(s: string) { this.s = s; } }
function both<A extends Lifetime>(x: Ref<B, A>, _other: Ref<B>): Ref<B, A>[] { return [x]; }
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  const rs = both(b1, b2);
  eat(b1);
  console.log(rs[0].s);
}
// case: ref_arrays_lifetime_alias
// expect: a1 1
class B { s: string; constructor(s: string) { this.s = s; } }
type Stack<A extends Lifetime> = { items: Ref<B, A>[]; n: i64 };
function start<A extends Lifetime>(x: Ref<B, A>, _other: Ref<B>): Stack<A> { return { items: [x], n: 1 }; }
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  const st = start(b1, b2);
  eat(b2);
  console.log(st.items[0].s, st.n);
}
// case: ref_arrays_lifetime_alias_moved
// error: cannot move 'b1' while 'st' borrows 'b1' and is used later
class B { s: string; constructor(s: string) { this.s = s; } }
type Stack<A extends Lifetime> = { items: Ref<B, A>[]; n: i64 };
function start<A extends Lifetime>(x: Ref<B, A>, _other: Ref<B>): Stack<A> { return { items: [x], n: 1 }; }
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  const st = start(b1, b2);
  eat(b1);
  console.log(st.items[0].s, st.n);
}
// case: ref_arrays_lifetime_class
// expect: a1
// expect: b2
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack<A extends Lifetime> {
  items: Ref<B, A>[] = [];
  add(this: Mut<this>, x: Ref<B, A>): void { this.items.push(x); }
  top(): Ref<B, A> { return this.items[this.items.length - 1]; }
}
function main() {
  let b1 = new B("a" + 1);
  let b2 = new B("b" + 2);
  let st = new Stack();
  st.add(b1);
  console.log(st.top().s);
  st.add(b2);
  console.log(st.top().s);
}
// case: ref_arrays_lifetime_class_moved
// error: cannot move 'b1'
class B { s: string; constructor(s: string) { this.s = s; } }
class Stack<A extends Lifetime> {
  items: Ref<B, A>[] = [];
  add(this: Mut<this>, x: Ref<B, A>): void { this.items.push(x); }
  top(): Ref<B, A> { return this.items[this.items.length - 1]; }
}
function eat(_b: B): i64 { return 1; }
function main() {
  let b1 = new B("a" + 1);
  let st = new Stack();
  st.add(b1);
  eat(b1);
  console.log(st.top().s);
}
