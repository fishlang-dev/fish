// case: eq_structural
// expect: true false true
// expect: true
// expect: true false
// expect: true false
// expect: true
// expect: true false
// expect: true true
// expect: true true
type P = { x: i64; name: string };
type Tree = { v: i64; kids: Tree[] };
type Node = { v: i64; next: Node | null };
type Shape = { kind: "c"; r: i64 } | { kind: "s"; w: i64; h: i64 };
function eqs(): string {
  const a: P = { x: 1, name: "a" };
  const b: P = { x: 1, name: "a" };
  const c: P = { x: 2, name: "a" };
  return `${a === b} ${a !== c}`;
}
const C = comptime eqs();
function main() {
  const a: P = { x: 1, name: "a" };
  const b: P = { x: 1, name: "a" };
  const c: P = { x: 1, name: "b" };
  console.log(a === b, a === c, a !== c);
  const t1: [i64, string] = [1, "x"];
  const t2: [i64, string] = [1, "x"];
  console.log(t1 === t2);
  const xs = [1, 2, 3];
  const ys = [1, 2, 3];
  const zs = [1, 2];
  console.log(xs === ys, xs === zs);
  const tr1: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  const tr2: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  const tr3: Tree = { v: 1, kids: [{ v: 3, kids: [] }] };
  console.log(tr1 === tr2, tr1 === tr3);
  const n1: Node = { v: 1, next: { v: 2, next: null } };
  const n2: Node = { v: 1, next: { v: 2, next: null } };
  console.log(n1 === n2);
  const s1: Shape = { kind: "s", w: 1, h: 2 };
  const s2: Shape = { kind: "s", w: 1, h: 2 };
  const s3: Shape = { kind: "c", r: 1 };
  console.log(s1 === s2, s1 === s3);
  const o1: P | null = { x: 1, name: "a" };
  console.log(o1 === a, o1 !== null);
  console.log(C);
}
// case: eq_map
// error: values of type 'Map<string, i64>' can't be compared with '===': a Map isn't compared by value; compare its entries
type Holder = { m: Map<string, i64> };
function main() {
  const a: Holder = { m: new Map() };
  const b: Holder = { m: new Map() };
  console.log(a === b);
}
// case: eq_class_without_equals
// error: a class compares through 'equals(other: Ref<this>): boolean', which 'Point' doesn't have; add one, or '@derive(Eq)'
class Point { x: i64 = 1; }
function main() {
  console.log(new Point() === new Point());
}
// case: eq_no_overlap
// error: have no overlap
type A = { a: i64 };
type B = { b: i64 };
function main() {
  const a: A = { a: 1 };
  const b: B = { b: 1 };
  console.log(a === b);
}
// case: eq_derived_class
// expect: true false
// expect: false true
// expect: true
@derive(Eq)
class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) { this.x = x; this.y = y; }
}
@derive(Eq)
class Named {
  constructor(public name: string, public at: Point) {}
}
function main() {
  console.log(new Point(1, 2) === new Point(1, 2), new Point(1, 2) === new Point(2, 1));
  console.log(new Point(1, 2) !== new Point(1, 2), new Point(1, 2) !== new Point(1, 3));
  console.log(new Named("a", new Point(1, 2)) === new Named("a", new Point(1, 2)));
}
// case: eq_own_equals
// expect: true false
class Money {
  cents: i64;
  note: string;
  constructor(cents: i64, note: string) { this.cents = cents; this.note = note; }
  equals(other: Ref<this>): boolean { return this.cents === other.cents; }
}
function main() {
  console.log(new Money(5, "a") === new Money(5, "b"), new Money(5, "a") === new Money(6, "a"));
}
// case: eq_derived_enum
// expect: true false false
// expect: true
@derive(Eq)
enum Cmd { Move(i64, i64), Say(string), Stop }
function main() {
  const a: Cmd = Cmd.Move(1, 2);
  console.log(a === Cmd.Move(1, 2), a === Cmd.Move(2, 1), a === Cmd.Stop);
  console.log(Cmd.Say("hi") === Cmd.Say("hi"));
}
// case: eq_derive_json
// error: 'derive' knows 'Eq' so far; 'Json' isn't one it can derive yet
@derive(Json)
class P { x: i64 = 1; }
function main() {}
// case: eq_equals_shape
// error: 'P.equals' is what '===' compares instances with, so it takes 'other: Ref<this>' and returns a boolean
class P {
  x: i64 = 1;
  equals(other: i64): boolean { return this.x === other; }
}
function main() {
  console.log(new P() === new P());
}
// case: eq_enum_payload_not_eq
// error: a Map isn't compared by value
@derive(Eq)
enum E { M(Map<string, i64>), N }
function main() {
  const e: E = E.N;
  console.log(e === E.N);
}
// case: eq_derive_on_function
// error: 'derive' applies to a class or an enum
@derive(Eq)
function f() {}
function main() {}
// case: eq_equals_mut_receiver
// error: 'P.equals' is what '===' compares instances with, so it takes 'other: Ref<this>' and returns a boolean
class P {
  xs: i64[] = [1];
  equals(this: Mut<this>, other: Ref<this>): boolean { this.xs.push(2); return true; }
}
function main() {
  console.log(new P() === new P());
}
// case: eq_through_refs
// expect: true false
// expect: true true
// expect: true
type P = { x: i64; name: string };
class Pt { constructor(public x: i64) {} equals(other: Ref<this>): boolean { return this.x === other.x; } }
function same(a: Ref<P>, b: Ref<P>): boolean { return a === b; }
function sameArrays(a: Ref<i64[]>, b: i64[]): boolean { return a === b; }
function samePts(a: Ref<Pt>, b: Ref<Pt>): boolean { return a === b; }
function main() {
  const a: P = { x: 1, name: "a" };
  const b: P = { x: 1, name: "a" };
  const c: P = { x: 2, name: "a" };
  console.log(same(a, b), same(a, c));
  const ys = [1, 2];
  let found = false;
  for (const xs of [[1, 2]]) found = xs === ys;
  console.log(sameArrays([1, 2], [1, 2]), found);
  console.log(samePts(new Pt(3), new Pt(3)));
}
// case: eq_object_params
// expect: true false
// expect: true
type P = { x: i64; name: string };
function same(a: P, b: P): boolean { return a === b; }
function first(xs: P[], p: P): boolean { return xs[0] === p; }
function main() {
  console.log(same({ x: 1, name: "a" }, { x: 1, name: "a" }), same({ x: 1, name: "a" }, { x: 1, name: "b" }));
  console.log(first([{ x: 1, name: "a" }], { x: 1, name: "a" }));
}
// case: eq_generic_classes
// expect: true false
// expect: true false
@derive(Eq)
class Box<T> {
  constructor(public v: T) {}
}
class Pair<T> {
  constructor(public a: T, public b: T) {}
  equals(other: Ref<this>): boolean { return this.a === other.a; }
}
function main() {
  console.log(new Box(1) === new Box(1), new Box<string>("a") === new Box<string>("b"));
  console.log(new Pair(1, 2) === new Pair(1, 3), new Pair("a", "b") === new Pair("c", "b"));
}
// case: eq_derived_base
// expect: false true false
@derive(Eq)
class B { constructor(public x: i64, public s: string) {} }
@derive(Eq)
class D extends B {
  y: i64;
  constructor(x: i64, y: i64) { super(x, "k"); this.y = y; }
}
function main() {
  console.log(new D(1, 2) === new D(9, 2), new D(1, 2) === new D(1, 2), new D(1, 2) === new D(1, 3));
}
// case: eq_derived_base_without_equals
// error: 'B' has no method 'equals'
class B { constructor(public x: i64) {} }
@derive(Eq)
class D extends B {
  constructor(x: i64) { super(x); }
}
function main() {
  console.log(new D(1) === new D(1));
}
// case: eq_comptime_equals
// expect: true true
class Money {
  constructor(public cents: i64, public note: string) {}
  equals(other: Ref<this>): boolean { return this.cents === other.cents; }
}
function same(): boolean { return new Money(5, "a") === new Money(5, "b"); }
const SAME = comptime same();
function main() {
  console.log(SAME, same());
}
// case: eq_wider_object_params
// expect: true false
// expect: true false
function same3(a: { x: i64 }, b: { x: i64; y: i64 }): boolean { return a === b; }
function same(a: { x: i64 }, b: { x: i64 }): boolean { return a === b; }
function main() {
  console.log(same3({ x: 1 }, { x: 1, y: 2 }), same3({ x: 2 }, { x: 1, y: 2 }));
  const w = { x: 1, y: 2 };
  console.log(same({ x: 1 }, w.clone()), same(w, { x: 2 }));
}
// case: eq_macro_after_derived_base
// expect: true false
macro function keep(input: Ast): Ast { return input; }
@derive(Eq) class B { constructor(public x: i64) {} }
@keep @derive(Eq) class D extends B { constructor(x: i64) { super(x); } }
function main() {
  console.log(new D(1) === new D(1), new D(1) === new D(2));
}
