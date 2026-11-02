// case: objectmethods_class
// expect: sq 4 3
// expect: sq 9
type Shape = { name: string; area(): f64; scale<T>(x: T): T };
class Sq implements Shape {
  name: string = "sq";
  constructor(public s: f64) {}
  area(): f64 { return this.s * this.s; }
  scale<T>(x: T): T { return x; }
}
function show(x: Shape): void { console.log(x.name, x.area(), x.scale(3)); }
function dyn(xs: Dyn<Shape>[]): void { for (const x of xs) console.log(x.name, x.area()); }
function main(): void {
  show(new Sq(2));
  dyn([new Sq(3)]);
}
// case: objectmethods_mut_this
// expect: 5
type Counter = { bump(this: Mut<this>, by: i64): void; total(): i64 };
class C implements Counter {
  n: i64 = 0;
  bump(this: Mut<this>, by: i64): void { this.n += by; }
  total(): i64 { return this.n; }
}
function count(c: Mut<Counter>): void { c.bump(2); c.bump(3); }
function main(): void {
  let c = new C();
  count(c);
  console.log(c.total());
}
// case: objectmethods_inline
// expect: 16
// expect: 7
// expect: 4
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
class B { constructor(public v: i64) {} get(): i64 { return this.v; } }
function inline(x: { area(): f64 }): f64 { return x.area(); }
function take<T>(x: { get(): T }): T { return x.get(); }
function main(): void {
  console.log(inline(new Sq(4)));
  console.log(take<i64>(new B(7)));
  const d: Dyn<{ get(): i64 }> = new B(4);
  console.log(d.get());
}
// case: objectmethods_generic_alias
// expect: boxed
type Box<T> = { get(): T };
class B { constructor(public v: string) {} get(): string { return this.v; } }
function unbox(b: Box<string>): string { return b.get(); }
function main(): void { console.log(unbox(new B("boxed"))); }
// case: objectmethods_intersection
// expect: e e
type Slots = { label: string } & { emit(line: string): void };
class E { label: string = "e"; emit(line: string): void { console.log(this.label, line); } }
function out(s: Slots): void { s.emit(s.label); }
function main(): void { out(new E()); }
// case: objectmethods_destructure
// expect: e 3
// expect: e a
// expect: e
type Host = { label: string; size: i64; emit(line: string): void };
class E { label: string = "e"; size: i64 = 3; emit(line: string): void { console.log(this.label, line); } }
function a(h: Host): void {
  const { label, size } = h;
  console.log(label, size);
  h.emit("a");
}
function b({ label }: Host): void { console.log(label); }
function main(): void {
  a(new E());
  b(new E());
}
// case: objectmethods_destructure_method
// error: '{ ... }' can't take method 'emit' out of 'Host'; call it on the value, as in 'x.emit()'
type Host = { label: string; emit(line: string): void };
function a(h: Host): void { const { emit } = h; }
function main(): void {}
// case: objectmethods_object_value
// error: method 'get' is missing in type '{ a: i64; get: () => i64 }' but required in type 'T'; an object can't supply a method yet, so use a class
type T = { a: i64; get(): i64 };
function f(x: T): i64 { return x.get(); }
function main(): void { console.log(f({ a: 1, get: () => 2 })); }
// case: objectmethods_missing
// error: class 'A' incorrectly implements 'T': method 'get' is missing in type 'A' but required in type 'T'
type T = { get(): i64 };
class A implements T {}
function main(): void {}
// case: objectmethods_optional
// error: optional methods are not supported yet
type T = { a: i64; get?(): i64 };
function main(): void {}
// case: objectmethods_duplicate
// error: duplicate member 'a'
function f(x: { a: i64; a(): i64 }): void {}
function main(): void {}
// case: objectmethods_same_shape
// expect: 4
// expect: 1
class B { constructor(public v: i64) {} get(): i64 { return this.v; } }
function use(d: Dyn<{ get(): i64 }>): i64 { return d.get(); }
function main(): void {
  const d: Dyn<{ get(): i64 }> = new B(4);
  console.log(use(d));
  const xs: Dyn<{ get(): i64 }>[] = [new B(1)];
  const ys: Dyn<{ get(): i64 }>[] = xs;
  console.log(ys.length);
}
// case: objectmethods_same_shape_generic
// expect: 6
class B { get(): i64 { return 6; } }
function f<T>(d: Dyn<{ get(): T }>): T { return d.get(); }
function main(): void {
  const d: Dyn<{ get(): i64 }> = new B();
  console.log(f<i64>(d));
}
// case: objectmethods_same_shape_option
// expect: 9
class B { constructor(public v: i64) {} get(): i64 { return this.v; } }
function mk(): Dyn<{ get(): i64 }> { return new B(9); }
function main(): void {
  const o: Option<Dyn<{ get(): i64 }>> = mk();
  if (o !== null) console.log(o.get());
}
// case: objectmethods_keyof
// error: 'keyof' takes an object type or a class, not the interface 'Shape', whose methods aren't values in Fish; any type with a method is an interface, so move its fields into a 'type' with no methods and use that
type Shape = { name: string; area(): f64 };
type K = keyof Shape;
function main(): void { const k: K = "name"; console.log(k); }
