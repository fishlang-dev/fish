// case: dyn_boxing
// expect: built 3
interface Shape {
  area(): i64;
}

class Sq {
  side: i64;
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
}

class Named {
  name: string;
  tags: string[];
  constructor(name: string) {
    this.name = name;
    this.tags = [name + "!"];
  }
  area(): i64 {
    return 0;
  }
}

class Holder {
  shape: Dyn<Shape>;
  constructor(shape: Dyn<Shape>) {
    this.shape = shape;
  }
}

function make(big: boolean): Dyn<Shape> {
  if (big) return new Named("big" + "");
  return new Sq(3);
}

function main() {
  let shapes: Dyn<Shape>[] = [];
  shapes.push(new Sq(2));
  shapes.push(new Named("n" + ""));
  shapes.push(make(true));
  const one: Dyn<Shape> = new Named("one" + "");
  const h = new Holder(make(false));
  const moved = shapes.pop()!;
  const list: Dyn<Shape>[] = [new Sq(1), new Named("lit" + "")];
  console.log("built", shapes.length + 1);
}
// case: dyn_clone
// expect: 9 4 4
// expect: copy of a 1
interface Shape {
  area(): i64;
  grow(this: Mut<this>): void;
}

class Sq {
  side: i64;
  tags: string[] = ["t" + ""];
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
  grow(this: Mut<this>) {
    this.side++;
    this.tags.push("g");
  }
}

interface Labelled {
  label(): string;
}

class Tag {
  name: string;
  copies: i64;
  constructor(name: string, copies: i64) {
    this.name = name;
    this.copies = copies;
  }
  label(): string {
    return this.name + " " + this.copies;
  }
  clone(): Tag {
    return new Tag("copy of " + this.name, this.copies + 1);
  }
}

function main() {
  let a: Dyn<Shape> = new Sq(2);
  let b = a.clone();
  a.grow();
  const c = b.clone();
  console.log(a.area(), b.area(), c.area());
  const t: Dyn<Labelled> = new Tag("a" + "", 0);
  const u = t.clone();
  console.log(u.label());
}
// case: dyn_clone_atomic
// panic: this Dyn's value can't be cloned
// A Dyn whose interface changes its value clones it, and an Atomic can't be cloned.
interface Counter {
  count(this: Mut<this>): i64;
}

class Hits {
  n: Atomic<i64> = new Atomic(0);
  count(this: Mut<this>): i64 {
    return this.n.load();
  }
}

function main() {
  const d: Dyn<Counter> = new Hits();
  const e = d.clone();
}
// case: dyn_container_clone
// error: can't clone a value holding a Dyn
interface Counter { bump(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
}
class Tag {
  name: string;
  constructor(name: string) { this.name = name; }
  bump(): i64 { return 0; }
  clone(): Tag { console.log("own clone"); return new Tag(this.name + "'"); }
}
function main() {
  let xs: Dyn<Counter>[] = [new Hits(), new Tag("t" + "")];
  const ys = xs.clone();
  xs[0].bump(); xs[0].bump();
  console.log(xs[0].bump(), ys[0].bump());
}
// case: dyn_copy_arr_copy
// panic: can't be copied
// A copy that panics part way through a value drops what it already copied.
interface Counter { bump(this: Mut<this>): i64; size(): i64; }
class Hits { n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } size(): i64 { return 1; } }
class Q { bump(this: Mut<this>): i64 { return 0; } size(): i64 { return 2; } }
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  let cs: Dyn<Counter>[] = [];
  cs.push(new Q());
  cs.push(new Q());
  cs.push(new Hits());
  const holder = { cs: cs };
  const f: Fn = async () => holder.cs[0].size();
  const n = await f();
  console.log(n);
}
// case: dyn_copy_nested
// expect: 1
// A Dyn whose interface changes it, holding another Dyn but nothing pinned, copies as values do.
interface Logger { log(s: string): i64; }
class L { log(s: string): i64 { return s.length as i64; } }
interface Stack { push(this: Mut<this>, x: i64): void; size(): i64; }
class S {
  items: i64[] = [];
  logger: Dyn<Logger>;
  constructor(l: Dyn<Logger>) { this.logger = l; }
  push(this: Mut<this>, x: i64) { this.items.push(x); }
  size(): i64 { return this.items.length as i64 + this.logger.log("") ; }
}
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const l: Dyn<Logger> = new L();
  let s: Dyn<Stack> = new S(l);
  s.push(1);
  const holder = { s: s };
  const f: Fn = async () => holder.s.size();
  const n = await f();
  console.log(n);
}
// case: dyn_copy_own_clone
// expect: 1
// expect: h1
// A Dyn holding pinned state whose class has its own clone copies through that clone.
interface Counter { name: string; bump(this: Mut<this>): i64; }
class Hits {
  name: string = "h" + String(1);
  n: Atomic<i64> = new Atomic(0);
  bump(this: Mut<this>): i64 { return this.n.add(1); }
  clone(): Hits { let h = new Hits(); h.n.store(this.n.load()); return h; }
}
type Fn = () => Promise<string>;
async function main(): Promise<void> {
  let c: Dyn<Counter> = new Hits();
  c.bump();
  let d = c.clone();
  console.log(d.bump());
  const holder = { c: c };
  const f: Fn = async () => holder.c.name;
  const s = await f();
  console.log(s);
}
// case: dyn_copy_partial_copy
// panic: can't be copied
// A copy that panics part way through a value drops what it already copied.
interface Counter { bump(this: Mut<this>): i64; }
class Hits { n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } }
interface Plain { get(): i64; }
class P { get(): i64 { return 1; } }
interface Outer { total(): i64; poke(this: Mut<this>): void; }
class O {
  a: string; b: Dyn<Plain>; c: string[]; z: Dyn<Counter>;
  constructor(c: Dyn<Counter>) { this.a = "o" + String(1); this.b = new P(); this.c = ["x" + String(2)]; this.z = c; }
  total(): i64 { return this.a.length as i64; }
  poke(this: Mut<this>) { this.z.bump(); }
}
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  let o: Dyn<Outer> = new O(new Hits());
  const holder = { o: o };
  const f: Fn = async () => holder.o.total();
  const n = await f();
  console.log(n);
}
// case: dyn_from_reference
// error: can't move a value out of a reference to it into a Dyn
interface Shape { area(): i64; }
class Named {
  name: string;
  constructor(name: string) { this.name = name; }
  area(): i64 { return this.name.length as i64; }
}
function f(r: Ref<Named>): i64 {
  const d: Dyn<Shape> = r;
  return d.area();
}
function main() {
  const n = new Named("place" + "");
  console.log(f(n));
}
// case: dyn_generic_method
// error: its method 'draw' takes an interface or a function, so it has a version per argument type and no one to call through a Dyn
interface Pen {
  ink(): i64;
}

interface Canvas {
  draw(p: Pen): i64;
}

class Sheet {
  draw(p: Pen): i64 {
    return p.ink();
  }
}

function main() {
  const c: Dyn<Canvas> = new Sheet();
}
// case: dyn_holds_cell
// error: a 'Dyn<Counter>' may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock
interface Counter {
  count(): i64;
}

class Local {
  n: Cell<i64> = new Cell(0);
  count(): i64 {
    return this.n.get();
  }
}

function main() {
  const c: Dyn<Counter> = new Local();
}
// case: dyn_holds_reference
// error: so it can't hold a 'Ref<string>', which borrows from where it was made
interface Named {
  label(): i64;
}

class View {
  text: Ref<string>;
  constructor(text: Ref<string>) {
    this.text = text;
  }
  label(): i64 {
    return 1;
  }
}

function main() {
  const s = "abc" + "";
  const v: Dyn<Named> = new View(s);
}
// case: dyn_in_shared
// expect: 800 800
interface Counter { bump(): i64; get(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
  get(): i64 { return this.n.load(); }
}
class Plain {
  hits: Hits = new Hits();
}
async function work(st: shared<{ h: Dyn<Counter>; p: Plain }>): Promise<i64> {
  for (let i = 0; i < 100; i++) { st.h.bump(); st.p.hits.bump(); await yieldNow(); }
  return 0;
}
async function main() {
  const d: Dyn<Counter> = new Hits();
  const st = shared({ h: d, p: new Plain() });
  let ts: JoinHandle<i64>[] = [];
  for (let k = 0; k < 8; k++) ts.push(spawn(work(st.clone())));
  while (ts.length > 0) { const t = ts.pop()!; await t; }
  console.log(st.h.get(), st.p.hits.get());
}
// case: dyn_index_write
// error: this is part of a value read through a Dyn, which gives a copy, so writing it would change only the copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface HasXs { xs: i64[]; }
class X { xs: i64[] = [1]; }
function main() { let h: Dyn<HasXs> = new X(); h.xs[0] = 4; console.log(h.xs[0]); }
// case: dyn_inherited_own
// expect: closed root
interface Door { close(this: Own<this>): string; }
class Base {
  pad: string;
  constructor() { this.pad = "root" + ""; }
  close(this: Own<this>): string { return "closed " + this.pad; }
}
class Derived extends Base {
  extra: string;
  constructor() { super(); this.extra = "e" + ""; }
}
function main() {
  const d: Dyn<Door> = new Derived();
  console.log(d.close());
}
// case: dyn_instanceof
// error: keeps no record of its value's class, so 'instanceof' can't test it
interface Shape { area(): i64; }
class Sq { s: string; constructor(s: string) { this.s = s; } area(): i64 { return this.s.length as i64; } }
function main() { const a: Dyn<Shape> = new Sq("a" + ""); console.log(a instanceof Sq); }
// case: dyn_interface_result
// error: 'make' returns the interface type 'Shape', which each type implementing 'Factory' gives its own way, so a Dyn can't call it; have it return 'Dyn<Shape>'
interface Shape {
  area(): i64;
}

interface Factory {
  make(): Shape;
}

class Sq {
  area(): i64 {
    return 1;
  }
}

class F {
  make(): Sq {
    return new Sq();
  }
}

function main() {
  const f: Dyn<Factory> = new F();
  const s = f.make();
}
// case: dyn_interface_result_slot
// expect: 7
interface Shape { area(): i64; }
interface Maker { make(): Shape; id(): i64; }
class Sq { area(): i64 { return 1; } }
class M { make(): Sq { return new Sq(); } id(): i64 { return 7; } }
function main() {
  const d: Dyn<Maker> = new M();
  console.log(d.id());
}
// case: dyn_into_other_dyn
// error: a 'Dyn<Shape>' can't become a 'Dyn<Empty>' yet
interface Empty {}
interface Shape { area(): i64; }
class Sq { s: string; constructor(s: string) { this.s = s; } area(): i64 { return this.s.length as i64; } }
function main() {
  const s: Dyn<Shape> = new Sq("abc" + "");
  const g: Dyn<Empty> = s;
  const h = g.clone();
  console.log(1);
}
// case: dyn_lend_mut
// error: this is part of a value read through a Dyn, which gives a copy, so lending it mutably would change only the copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface Box { inner: Inner; touch(this: Mut<this>): void; get(): Inner; }
class B { inner: Inner = new Inner(); touch(this: Mut<this>) { this.inner.m.set("t", 1); this.inner.xs.push(1); this.inner.xs[0] = 5; } get(): Inner { return this.inner.clone(); } }
interface HasM2 { m: Map<string, i64>; } class M2 { m: Map<string, i64> = new Map<string, i64>(); } function g(m: Mut<Map<string, i64>>) { m.set("a", 1); } function main() { let d: Dyn<HasM2> = new M2(); g(d.m); console.log(d.m.size); }
// case: dyn_methods
// expect: 4 9 0 13
// expect: sq n n!
// expect: 5 6
// expect: closed main shutting
interface Shape {
  label: string;
  area(): i64;
  grow(this: Mut<this>, by: i64): void;
}

class Base {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  area(): i64 {
    return 0;
  }
}

class Sq {
  side: i64;
  label: string = "sq";
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
  grow(this: Mut<this>, by: i64) {
    this.side += by;
  }
}

class Named extends Base {
  tags: string[];
  constructor(name: string) {
    super(name);
    this.tags = [name + "!"];
  }
  grow(this: Mut<this>, by: i64) {
    this.tags.push("x");
  }
  get first(): string {
    return this.tags[0];
  }
}

interface Tagged {
  first: string;
}

interface Door {
  close(this: Own<this>): string;
}

class Gate {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  close(this: Own<this>): string {
    return "closed " + this.name;
  }
}

class Port {
  close(): string {
    return "shutting";
  }
}

function total(shapes: Ref<Dyn<Shape>[]>): i64 {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}

function main() {
  let shapes: Dyn<Shape>[] = [new Sq(2), new Sq(3), new Named("n" + "")];
  console.log(shapes[0].area(), shapes[1].area(), shapes[2].area(), total(shapes));
  const t: Dyn<Tagged> = new Named("n" + "");
  console.log(shapes[0].label, shapes[2].label, t.first);
  let one: Dyn<Shape> = new Sq(2);
  one.grow(3);
  const big = one.area() / 5;
  one.grow(1);
  console.log(big, one.area() / 6);
  const g: Dyn<Door> = new Gate("main" + "");
  const p: Dyn<Door> = new Port();
  const a = g.close();
  const b = p.close();
  console.log(a, b);
}
// case: dyn_missing_method
// error: method 'area' is missing in type 'Circle' but required in type 'Shape'
interface Shape {
  area(): i64;
}

class Circle {
  r: i64 = 1;
}

function main() {
  const s: Dyn<Shape> = new Circle();
}
// case: dyn_mut_method
// error: 'bump' changes its object, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface Box { inner: Inner; touch(this: Mut<this>): void; get(): Inner; }
class B { inner: Inner = new Inner(); touch(this: Mut<this>) { this.inner.m.set("t", 1); this.inner.xs.push(1); this.inner.xs[0] = 5; } get(): Inner { return this.inner.clone(); } }
class C { n: i64 = 0; bump(this: Mut<this>) { this.n++; } } interface HasC { c: C; } class HC { c: C = new C(); } function main() { let d: Dyn<HasC> = new HC(); d.c.bump(); console.log(d.c.n); }
// case: dyn_mut_through_const
// error: cannot call 'bump' on 'one' because it is a constant
interface Counter {
  bump(this: Mut<this>): void;
}

class C {
  n: i64 = 0;
  bump(this: Mut<this>) {
    this.n++;
  }
}

function main() {
  const one: Dyn<Counter> = new C();
  one.bump();
}
// case: dyn_nested_clone
// expect: 0 1 2 3 4
// expect: 0 1
// Interfaces that change nothing share their Dyn's value between clones, inner Dyns too.
interface Counter { bump(): i64; }
interface Outerish { total(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
}
class Outer {
  inner: Dyn<Counter>;
  constructor(c: Dyn<Counter>) { this.inner = c; }
  total(): i64 { return this.inner.bump(); }
}
function main() {
  const d: Dyn<Outerish> = new Outer(new Hits());
  const a = d.total();
  const b = d.total();
  const e = d.clone();
  const x = d.total();
  const y = e.total();
  const z = d.total();
  console.log(a, b, x, y, z);
  const h: Dyn<Counter> = new Hits();
  const h1 = h.bump();
  const h2 = h.bump();
  console.log(h1, h2);
}
// case: dyn_not_interface
// error: 'Dyn' takes the interface its values implement, like 'Dyn<Handler>'
function main() {
  const d: Dyn<i64> = 1;
}
// case: dyn_own_moves
// error: 'g' was moved, so it can't be used here
interface Door {
  close(this: Own<this>): string;
}

class Gate {
  close(this: Own<this>): string {
    return "closed";
  }
}

function main() {
  const g: Dyn<Door> = new Gate();
  const a = g.close();
  const b = g.close();
}
// case: dyn_own_panic
// panic: attempt to divide by zero
interface Door { close(this: Own<this>, by: i64): string; }
class Gate {
  name: string;
  constructor(name: string) { this.name = name; }
  close(this: Own<this>, by: i64): string { const z = 10 / by; return "closed " + this.name + z; }
}
class Port {
  name: string;
  constructor(name: string) { this.name = name; }
  close(by: i64): string { const z = 10 / by; return "shut " + this.name + z; }
}
function main() {
  const p: Dyn<Door> = new Port("p" + "");
  const s = "keep" + "";
  console.log(p.close(0));
}
// case: dyn_own_reference
// error: 'get' takes its object over and frees it, so the reference it gives would point at nothing
interface Named { get(this: Own<this>): Ref<string>; }
class Impl {
  name: string;
  constructor(name: string) { this.name = name; }
  get(): Ref<string> { return this.name; }
}
function main() {
  const d: Dyn<Named> = new Impl("hello" + " world");
  const r = d.get();
  const junk = "zzzzzzzzzzzzzzzz" + "zzzz";
  console.log(r, junk);
}
// case: dyn_primitive
// expect: 2
interface Empty {}
function main() {
  const e: Dyn<Empty> = "str" + "ing";
  const f: Dyn<Empty> = 5;
  let arr: Dyn<Empty>[] = [e, f];
  console.log(arr.length);
}
// case: dyn_reference_borrows
// error: cannot change 'd' while 'r' borrows 'd'
interface Named { get(): Ref<string>; }
class Impl {
  name: string;
  constructor(name: string) { this.name = name; }
  get(): Ref<string> { return this.name; }
}
function main() {
  let d: Dyn<Named> = new Impl("hello" + " world");
  const r = d.get();
  d = new Impl("other" + "");
  console.log(r);
}
// case: dyn_shared_state
// expect: 0 1 2
// expect: 3
// A Dyn whose interface changes nothing is shared by its copies, so state it keeps in an Atomic
// is one state, through an async callable's calls too.
interface Counter { next(): i64; }
class Ticks { n: Atomic<i64> = new Atomic(0); next(): i64 { return this.n.add(1); } }
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const f: Fn = async () => holder.counter.next();
  const a = await f();
  const b = await f();
  const c = await f();
  console.log(a, b, c);
  const g = f.clone();
  const d = await g();
  console.log(d);
}
// case: dyn_tasks
// expect: 3200 64
interface Handler {
  handle(n: i64): i64;
}

class Double {
  handle(n: i64): i64 {
    return n * 2;
  }
}

class Tagged {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  handle(n: i64): i64 {
    return n + (this.tag.length as i64);
  }
}

async function run(hs: Dyn<Handler>[], n: i64): Promise<i64> {
  let total = 0;
  for (const h of hs) {
    total += h.handle(n);
    await yieldNow();
  }
  return total;
}

async function main() {
  let tasks: JoinHandle<i64>[] = [];
  for (let n = 0; n < 64; n++) {
    let hs: Dyn<Handler>[] = [new Double(), new Tagged("ab" + "")];
    tasks.push(spawn(run(hs, 16)));
  }
  let sum = 0;
  let count = 0;
  for (let n = 0; n < 64; n++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
}
// case: dyn_uncopyable
// panic: can't be copied
// A Dyn whose interface changes its value is copied by cloning; one holding an Atomic can't
// be, so the copy an async callable makes for its call panics rather than split the state.
interface Counter { label: string; bump(this: Mut<this>): i64; }
class Ticks { label: string = "ticks"; n: Atomic<i64> = new Atomic(0); bump(this: Mut<this>): i64 { return this.n.add(1); } }
type Fn = () => Promise<string>;
async function main(): Promise<void> {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const f: Fn = async () => holder.counter.label;
  const r = await f();
  console.log(r);
}
// case: dyn_undeclared_mut
// error: 'C' can't be a 'Dyn<Counter>': its method 'bump' changes its object, which 'Counter' doesn't declare; declare 'this: Mut<this>' on it in the interface
interface Counter {
  bump(): void;
}

class C {
  n: i64 = 0;
  bump(this: Mut<this>) {
    this.n++;
  }
}

function main() {
  let one: Dyn<Counter> = new C();
}
