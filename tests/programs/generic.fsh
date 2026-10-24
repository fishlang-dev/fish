// case: generic_alias_arguments
type Pair<T> = { first: T; second: T }

function main() {
  const p: Pair = { first: 1, second: 2 }
}
// error: type 'Pair' expects 1 type argument, but got 0
// case: generic_bound
interface Shape {
  area(): i64
}

function total<S extends Shape>(s: S): i64 {
  return s.area()
}

function main() {
  print(total({ x: 1 }))
}
// error: type '{ x: i64 }' does not satisfy the constraint 'Shape': method 'area' is missing in type '{ x: i64 }' but required in type 'Shape'
// case: generic_bound_calls
// A call made inside an instance with one of its type parameters is typed as the definition
// typed it, and values of a type parameter go wherever the concrete type is declared.
interface H {
  a: i64 | boolean
}
class F {
  a = false
}
class G {
  get a(): boolean {
    return true
  }
}
function same<T extends H>(t: T): T {
  return t
}
function inferred<T>(t: T) {
  return t
}
function k<T extends H>(t: T): i64 {
  const r = same(t.clone()).a
  const s = inferred(t).a
  if (typeof r === "boolean") return r ? 1 : 0
  return typeof s === "number" ? r + s : r
}
function e<U extends { a: i64 | boolean }>(u: U): i64 {
  return 1
}
function pass<T extends H>(t: T): i64 {
  return e(same(t))
}
enum Color {
  Red,
  Green,
}
class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
  with(h: H): i64 {
    const r = h.a
    return typeof r === "number" ? r : 0
  }
}
function keep<T>(t: T): Box<T> {
  return new Box(t)
}
function set<T>(t: T, u: T): T {
  let o = { v: t }
  o.v = u
  return o.v
}
function f<T>(t: T): i64 {
  const b = new Box(t)
  return b.with({ a: true })
}
function main() {
  print(k({ a: 5 }), k(new F()), k(new G()), pass(new F()), pass(new G()))
  print(keep(Color.Green).get() === Color.Green, f(1))
  const u: i64 | boolean = 3
  const w: i64 | boolean = true
  print(set(u, w))
}
// expect: 10 0 1 1 1
// expect: true 0
// expect: true
// case: generic_bound_places
// Writes, receivers and method calls through a type parameter reach the concrete value as
// it is stored, while reading through the bound's types.
class Counter {
  n: i64 = 0
  get twice(): i64 {
    return this.n * 2
  }
  bump(this: Mut<this>): i64 {
    this.n = this.n + 1
    return this.n
  }
}

type Holder = { p: { c: Counter } }

interface Source {
  read(): i64 | boolean
  next(): Shape
}

interface Shape {
  sides: i64
}

class Square {
  sides = 4
  extra = 9
}

class Gate {
  read(): boolean {
    return true
  }
  next(): Square {
    return new Square()
  }
}

class Dial {
  read(): i64 {
    return 7
  }
  next(): Square {
    return new Square()
  }
}

function touch(h: Holder): i64 {
  let x = h
  x.p.c.n = 5
  const a = x.p.c.bump()
  return a * 100 + x.p.c.twice
}

function poll(s: Source): i64 {
  const r = s.read()
  const shape = s.next()
  if (typeof r === "number") return r + shape.sides
  return r ? shape.sides : 0
}

function main() {
  const wide = { p: { a: 1, c: new Counter(), z: 2 } }
  print(touch(wide))
  print(poll(new Gate()), poll(new Dial()))
}
// expect: 612
// expect: 4 11
// case: generic_bound_sites
// A call's view of the type parameters it passed belongs to the instance making it, and an
// inferred return holding a generic class is seen through the caller's parameters.
interface H {
  a: i64
}

class C {
  a: i64 = 7
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
}

function id<T>(t: T): T {
  return t
}

function f<T extends H>(t: T): i64 {
  const r: T = id(t)
  return r.a
}

function mk<T>(t: T) {
  return new Box(t)
}

function k<U extends H>(u: U): i64 {
  return mk(u).v.a
}

function main() {
  print(f(new C()), k(new C()), k({ a: 3 }))
}

// Declared after main, so the definition check of the call inside f comes after its instance.
function later<U extends H>(u: U): i64 {
  return f(u)
}
// expect: 7 7 3
// case: generic_bound_union_write
// A write through a type parameter whose concrete type is a union has to narrow it first.
type A = { kind: 1; a: i64 }
type B = { kind: 2; a: i64; b: i64 }

function put<T extends { a: i64 }>(t: T): i64 {
  let x = t
  x.a = 9
  return x.a
}

function main() {
  const x: A | B = { kind: 2, a: 5, b: 1 }
  print(put(x))
}
// error: can't assign to 'a' through
// case: generic_bound_view
// A generic body is checked against its bounds, and every instance reads through them the
// same way, whatever concrete type it holds.
interface H {
  a: i64 | boolean
}

class Num {
  a: i64 = 3
}

class Flag {
  a = true
}

class Lazy {
  get a(): boolean {
    return false
  }
}

function copied(h: H): i64 {
  const x = h
  const r = x.a
  if (typeof r === "number") return r * 10
  return r ? 1 : 0
}

function bounded<T extends { a: i64 | boolean }>(t: T): i64 {
  const r = t.a
  return typeof r === "number" ? r : -1
}

function passed(h: H): i64 {
  return copied(h.clone()) + bounded2(h)
}

function bounded2<T extends H>(t: T): i64 {
  const r = t.a
  return typeof r === "boolean" ? 100 : 200
}

function wider<T extends { p: { a: i64 } }>(t: T, c: boolean): i64 {
  const q = c ? t.p : { a: 1 }
  return q.a
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
}

function boxed<T extends { a: i64 | boolean }>(t: T): i64 {
  const b = new Box(t)
  const r = b.get().a
  return typeof r === "number" ? r : -1
}

function main() {
  print(copied(new Num()), copied(new Flag()), copied(new Lazy()), copied({ a: 4 }))
  print(bounded({ a: 9 }), bounded({ a: true }), bounded(new Num()))
  print(passed(new Num()), passed(new Lazy()))
  print(wider({ p: { a: 5, b: 6 } }, true), wider({ p: { a: 5, b: 6 } }, false))
  print(boxed({ a: 8 }), boxed({ a: false }), boxed(new Flag()))
}
// expect: 30 1 0 40
// expect: 9 -1 3
// expect: 230 100
// expect: 5 1
// expect: 8 -1 -1
// case: generic_class_arguments
class Box<T> {
  constructor(public value: T) {}
}

function main() {
  const b: Box<i64, boolean> = new Box(1)
}
// error: type 'Box' expects 1 type argument, but got 2
// case: generic_class_bound
interface Measured {
  size(): i64
}

class Sized<T extends Measured> {
  constructor(public item: T) {}
}

function main() {
  new Sized(1)
}
// error: type 'i64' does not satisfy the constraint 'Measured': method 'size' is missing in type 'i64' but required in type 'Measured'
// case: generic_class_bound_view
// A bounded generic class's members read its type parameters through their bounds, in every
// instance of the class.
interface H {
  a: i64 | boolean
}
class F {
  a = false
}
class Holder<T extends H> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  num(): i64 {
    const r = this.v.a
    if (typeof r === "number") return r
    return r ? 1 : 0
  }
  again(): Holder<T> {
    return new Holder(this.v.clone())
  }
  view(): T {
    return this.v.clone()
  }
  get val(): T {
    return this.v.clone()
  }
  called(): i64 {
    const r = this.view().a
    if (typeof r === "number") return r
    const s = this.val.a
    return s === r ? 10 : 20
  }
}
class Obj<T extends { a: i64 | boolean }> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  num(): i64 {
    const r = this.v.a
    return typeof r === "number" ? r : -1
  }
}
function main() {
  print(new Holder(new F()).num(), new Holder({ a: 6 }).again().num(), new Obj({ a: false }).num(), new Obj({ a: 2 }).num())
  print(new Holder(new F()).called(), new Holder({ a: 3 }).called(), new Holder({ a: true }).called())
}
// expect: 0 6 -1 2
// expect: 10 3 10
// case: generic_class_deeper
interface I {
  wrap(): I
}

class Box<T> {
  constructor(public t: T) {}

  wrap(): Box<Box<T>> {
    return new Box(this)
  }
}

function use(i: I): i64 {
  return 1
}

function main() {
  print(use(new Box(1)))
}
// error: never ends
// case: generic_class_many_users
// Many generic classes naming one generic class in their members' parameters share its
// definition's placeholders, so they don't count as instances that never end.
class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
}

class C0<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 0
  }
}

class C1<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 1
  }
}

class C2<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 2
  }
}

class C3<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 3
  }
}

class C4<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 4
  }
}

class C5<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 5
  }
}

class C6<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 6
  }
}

class C7<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 7
  }
}

class C8<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 8
  }
}

class C9<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 9
  }
}

class C10<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 10
  }
}

class C11<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 11
  }
}

class C12<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 12
  }
}

class C13<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 13
  }
}

class C14<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 14
  }
}

class C15<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 15
  }
}

class C16<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 16
  }
}

class C17<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 17
  }
}

class C18<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 18
  }
}

class C19<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 19
  }
}

class C20<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 20
  }
}

class C21<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 21
  }
}

class C22<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 22
  }
}

class C23<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 23
  }
}

class C24<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 24
  }
}

class C25<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 25
  }
}

class C26<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 26
  }
}

class C27<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 27
  }
}

class C28<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 28
  }
}

class C29<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 29
  }
}

class C30<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 30
  }
}

class C31<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 31
  }
}

class C32<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 32
  }
}

class C33<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 33
  }
}

class C34<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 34
  }
}

class C35<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 35
  }
}

class C36<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 36
  }
}

class C37<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 37
  }
}

class C38<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 38
  }
}

class C39<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  m(b: Box<T>): i64 {
    return 39
  }
}

function main() {
  print(new C0(1).m(new Box(2)), new C39(true).m(new Box(false)))
}
// expect: 0 39
// case: generic_class_param_view
// A generic class member's parameter typed with the class's type parameter reads through its
// bound in every instance, as at the definition, whatever object type the class holds.
interface H {
  a: i64 | boolean
}

class Holder<T extends H> {
  v: T
  n: i64
  constructor(v: T) {
    const r = v.a
    this.n = typeof r === "number" ? r : -1
    this.v = v
  }
  mk(t: T): i64 {
    const r = t.a
    return typeof r === "number" ? r : -1
  }
  wrapped(o: { w: T }): i64 {
    const r = o.w.a
    return typeof r === "number" ? r : -2
  }
}

function g<U extends H>(u: U): i64 {
  return new Holder(u.clone()).mk(u)
}

function main() {
  const h = new Holder({ a: true })
  print(h.n, h.mk({ a: false }), h.wrapped({ w: { a: false } }), g({ a: true }))
  const k = new Holder({ a: 4 })
  print(k.n, k.mk({ a: 6 }), k.wrapped({ w: { a: 8 } }), g({ a: 9 }))
}
// expect: -1 -1 -2 -1
// expect: 4 6 8 9
// case: generic_class_recursive
class Node<T> {
  constructor(public value: T, public next: Node<T>) {}
}

function main() {}
// error: contains itself, so it would have infinite size
// case: generic_class_static
class Box<T> {
  static make(): i64 {
    return 1
  }
}

function main() {}
// error: static methods in generic classes are not supported yet
// case: generic_class_unending
class Grow<T> {
  constructor(public value: T) {}

  next(): Grow<{ inner: T }> {
    return new Grow({ inner: this.value.clone() })
  }
}

function main() {
  print(new Grow(1).value)
}
// error: never ends
// case: generic_classes
interface Measured {
  size(): i64
}

class Point {
  constructor(public x: i64, public y: i64) {}

  size(): i64 {
    return this.x + this.y
  }
}

class Box<T> {
  count = 1

  constructor(public value: T) {}

  get(): T {
    return this.value.clone()
  }

  set(this: Mut<this>, value: T) {
    this.value = value
    this.count++
  }
}

class Sized<T extends Measured> {
  constructor(public item: T) {}

  total(): i64 {
    return this.item.size() * 10
  }
}

type Labelled<T> = { label: i64; box: Box<T> }

function unbox<T>(b: Box<T>): T {
  return b.get()
}

function main() {
  let a = new Box(5)
  a.set(6)
  const b = new Box<Point>(new Point(1, 2))
  print(a.get(), a.count, b.get().y, b.value.size())
  print(unbox(a), unbox(new Box(true)))
  const l: Labelled<i64> = { label: 1, box: new Box(9) }
  print(l.label, l.box.get())
  print(new Sized(new Point(3, 4)).total())
  const nested = new Box(new Box(7))
  print(nested.get().get())
}
// expect: 6 2 2 3
// expect: 6 true
// expect: 1 9
// expect: 70
// expect: 7
// case: generic_conflict
function same<T>(a: T, b: T): T {
  return a
}

function main() {
  same(1, true)
}
// error: the type argument for 'T' can't be both 'i64' and 'boolean'
// case: generic_default
function id<T = i64>(x: T): T {
  return x
}

function main() {}
// error: default type arguments are not supported yet
// case: generic_explicit_mismatch
function id<T>(x: T): T {
  return x
}

function main() {
  id<boolean>(1)
}
// error: argument of type 'i64' is not assignable to parameter of type 'boolean'
// case: generic_function
// A generic function nothing calls is still checked, and compiles to nothing.
function id<T, U>(x: i64): i64 {
  return x
}

function main() {
  print(id(1))
}
// error: can't infer a type for 'T'; pass the type arguments explicitly
// case: generic_generator_param
// expect: 2 7
// A generic function taking a Generator<T> infers T from what the generator yields.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function collect<T>(g: Generator<T>): T[] {
  let out: T[] = [];
  for (const x of g) out.push(x);
  return out;
}
function* gen(): Generator<P> { yield new P(1); yield new P(7); }
function main() {
  const ps = collect(gen());
  console.log(ps.length, ps[1].n);
}
// case: generic_interface_argument
interface Shape {
  area(): i64
}

function id<T>(x: T): T {
  return x
}

function main() {
  id<Shape>(1)
}
// error: an interface can't be a type argument, since it describes values without being one
// case: generic_member
interface Named {
  name: i64
}

function size<T extends Named>(x: T): i64 {
  return x.size
}

function main() {}
// error: property 'size' does not exist on type 'T'
// case: generic_not_generic
class Point {}

function main() {
  const p: Point<i64> = new Point()
}
// error: type 'Point' is not generic
// case: generic_operator
function add<T>(a: T, b: T): T {
  return a + b
}

function main() {}
// error: operator '+' cannot be applied to types 'T' and 'T'
// case: generic_phantom
interface Getter {
  get(): i64
}

class Tag<T> {
  n: i64 = 7

  get(): i64 {
    return this.n
  }
}

function h<U extends Getter>(u: U): i64 {
  return u.get()
}

function f<T>(x: T): i64 {
  return h(new Tag<T>())
}

function main() {
  print(f(true))
}
// expect: 7
// case: generic_print
function show<T>(x: T) {
  print(x)
}

function main() {}
// error: a value of type 'T' can't be printed
// case: generic_string_clone
class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v.clone();
  }
}

function main() {
  const b = new Box<string>("g" + 1);
  console.log(b.get(), b.v);
}
// expect: g1 g1
// case: generic_type
function main() {
  let x: Array<i64> = 1
}
// error: type 'i64' is not assignable to type 'i64[]'
// case: generic_type_argument_count
function id<T>(x: T): T {
  return x
}

function main() {
  id<i64, boolean>(1)
}
// error: expected 1 type argument, but got 2
// case: generic_unending
function grow<T>(x: T, n: i64): i64 {
  if (n === 0) return 0
  return grow({ inner: x }, n - 1)
}

function main() {
  print(grow(1, 3))
}
// error: instantiating 'grow' never ends: each instance needs another with larger type arguments
// case: generic_wrap_unending
interface I {
  n(): i64
}

class Wrap<T> {
  constructor(public t: T) {}

  n(): i64 {
    return 1
  }
}

function f(x: I, depth: i64): i64 {
  if (depth === 0) return x.n()
  return f(new Wrap(x), depth - 1)
}

function main() {
  print(f(new Wrap(1), 3))
}
// error: never ends
// case: generic_methods
// expect: n20 40 true
// expect: 20 a
// expect: v 3
// expect: 4 27 abb
class Box<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  map<U>(f: (x: T) => U): Box<U> { return new Box(f(this.value.clone())); }
  pair<U>(other: U): [T, U] { return [this.value.clone(), other]; }
}
class Util {
  static of<V>(v: V): Box<V> { return new Box(v); }
  first<T>(xs: Ref<T[]>): T { return xs[0].clone(); }
  twice<T>(x: T, f: (y: T) => T): T { return f(f(x)); }
}
function main() {
  const b = new Box(20);
  const s = b.map((x) => "n" + x);
  console.log(s.value, b.map((x) => x * 2).value, b.map<boolean>((x) => x > 5).value);
  const p = b.pair("a");
  console.log(p[0], p[1]);
  console.log(Util.of("v").value, Util.of<i64>(3).value);
  const u = new Util();
  console.log(u.first([4, 5]), u.twice(3, (y) => y * 3), u.twice("a", (y) => y + "b"));
}
// case: generic_methods_bounds_and_folds
// expect: i3 16 123 3
// expect: 2 2
interface Named { name(): string }
class Item {
  n: string;
  constructor(n: string) { this.n = n; }
  name(): string { return this.n; }
}
class Store<T> {
  items: T[];
  constructor(items: T[]) { this.items = items; }
  pick<K extends Named>(k: K): string { return k.name() + this.items.length; }
  fold<A>(start: A, f: (acc: A, x: Ref<T>) => A): A {
    let acc = start;
    for (const x of this.items) acc = f(acc, x);
    return acc;
  }
}
function total<T>(s: Ref<Store<T>>): i64 {
  return s.fold(0, (acc, _x) => acc + 1);
}
function main() {
  const s = new Store([1, 2, 3]);
  console.log(s.pick(new Item("i")), s.fold(10, (a, x) => a + x), s.fold("", (a, x) => a + x), total(s));
  const w = new Store(["a", "b"]);
  console.log(w.fold<i64>(0, (a, x) => a + (x.length as i64)), total(w));
}
// case: generic_callbacks_typed_from_arguments
// expect: n2 1
function apply<T, U>(x: T, f: (y: T) => U): U { return f(x); }
function main() {
  console.log(apply(2, (y) => "n" + y), apply("a", (y) => y.length));
}
// case: generic_method_type_argument_count
// error: expected 1 type argument, but got 2
class Box<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  map<U>(f: (x: T) => U): U { return f(this.value.clone()); }
}
function main() {
  console.log(new Box(1).map<i64, string>((x) => x));
}
// case: generic_arrows_and_nested_functions
// expect: 1 s 2 a+b 5
// expect: one 1
// expect: 5
const swap = <A, B>(p: [A, B]): [B, A] => [p[1], p[0]];
function main() {
  const id = <T>(x: T): T => x;
  function pairUp<T>(a: T, b: T): T[] {
    return [a, b];
  }
  const twice = <T,>(x: T, f: (y: T) => T): T => f(f(x));
  console.log(id(1), id("s"), pairUp(1, 2).length, pairUp("a", "b").join("+"), twice(3, (y) => y + 1));
  const s = swap([1, "one"]);
  console.log(s[0], s[1]);
  const inner = () => id(5);
  console.log(inner());
}
// case: generic_arrow_capture
// error: 'addK' is generic, so it is made apart from the function around it and can't use 'k' from there; pass it as a parameter, or declare it at the top level
function main() {
  const k = 3;
  const addK = <T>(x: T): i64 => k;
  console.log(addK(1));
}
// case: generic_arrow_value
// error: 'id' is generic, a family of functions made one per call, so it can only be called here, not used as a value
function main() {
  const id = <T>(x: T): T => x;
  const f = id;
}
// case: generic_arrow_passed
// error: a generic arrow is a family of functions, one per call, so it can only be held by a const and called; passing or storing one needs one type for it, as in '(x: i64) => i64'
function apply(f: (x: i64) => i64): i64 { return f(1); }
function main() {
  console.log(apply(<T>(x: T): T => x));
}
// case: generic_arrow_this
// error: 'get' is generic, so it is made anew for each call and can't use 'this'; pass what it needs as a parameter
class C {
  n: i64 = 1;
  m(): i64 {
    const get = <T>(x: T): i64 => this.n;
    return get(1);
  }
}
function main() {
  console.log(new C().m());
}
// case: generic_review_k8
// error: can't infer a type for 'T'; pass the type arguments explicitly
function on<T>(h: (e: T) => void): i64 { return 1; }
function main() {
  console.log(on((e) => console.log("hi")));
}
// case: generic_review_h3
// error: 'twice' is generic, so it is made apart from the function around it and can't use 'pick' from there; pass it as a parameter, or declare it at the top level
function id<T>(x: T): T { return x.clone(); }
function pick<T>(x: T): string { return "top"; }
function main() {
  const pick = <T>(x: T): string => "local";
  const twice = <T>(x: T): string => pick(x);
  console.log(twice(true));
}
// case: generic_review_h1
// error: 'f' is generic, so it is made apart from the function around it and can't use 'K' from there; pass it as a parameter, or declare it at the top level
const K: i64 = 10;
function main() {
  const f = <T>(x: T): i64 => K;
  const K = 5;
  console.log(f(1));
}
// case: generic_review_h7
// error: 'keep' is generic, so it is made apart from the function around it and can't use its types; declare it at the top level
function outer<U>(u: U): U {
  const keep = <T>(x: T, y: U): U => y;
  return keep(1, u);
}
function main() { console.log(outer(3), outer("s")); }
// case: generic_review_i3a
// expect: a
async function main() {
  const ag = async <T>(x: T): Promise<T> => x;
  const r = await ag("a");
  console.log(r);
}
// case: generic_review_i3b
// expect: w
async function work(): Promise<string> {
  const id = <T>(x: T): T => x;
  return id("w");
}
async function main() {
  const s = await work();
  console.log(s);
}
// case: generic_review_h9
// expect: 1
function main() {
  const one = <T>(x: T): i64 => 1;
  console.log(one("a"));
}
// case: generic_review_h5
// expect: 3
function main() {
  function g<T>(x: T, n: i64): i64 { if (n === 0) return 0; return g(x, n - 1) + 1; }
  console.log(g("a", 3));
}
// case: generic_review_f1
// expect: 1
interface Container<T> { get(): T }
class K<T> implements Container<T> {
  v: T;
  constructor(v: T) { this.v = v; }
  get(): T { return this.v.clone(); }
}
function mk<T>(v: T): Dyn<Container<T>> { return new K(v); }
function main() {
  const d = mk(1);
  console.log(d.get());
}
// case: generic_review_f5
// expect: 100
interface Container<T> { get(): T }
class J implements Container<i64> { get(): i64 { return 100; } }
function a<T>(c: Container<T>, d: T): T { return c.get(); }
function main() {
  console.log(a(new J(), 1));
}
// case: generic_self_call
// expect: 3
function deep<U>(u: U, n: i64): i64 { if (n === 0) return 0; return 1 + deep(u, n - 1); }
function main() { console.log(deep("z", 3)); }
// case: generic_method_self_call
// expect: 3 2
class Box<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  deep<U>(u: U, n: i64): i64 { if (n === 0) return 0; return 1 + this.deep(u, n - 1); }
  other<U>(u: U): i64 { return this.deep(u, 2); }
}
function main() { const b = new Box(1); console.log(b.deep("z", 3), b.other(true)); }
// case: generic_recursive_type_argument
// expect: 1
class Node { kids: Node[] = []; n: i64 = 1; }
function count<T>(node: Ref<Node>, tag: T): usize { return node.kids.length; }
function main() {
  let r = new Node();
  r.kids.push(new Node());
  console.log(count(r, true));
}
// case: generic_callback_passed_on
// expect: 2
function walk2<T>(n: i64, visit: () => T): i64 {
  if (n === 0) { visit(); return 0; }
  return 1 + walk2<T>(n - 1, visit);
}
function main() { console.log(walk2(2, () => 5)); }
