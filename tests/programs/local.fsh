// Types, interfaces, enums and classes declared inside function bodies.
// case: local_declarations
// expect: 96 1 s
// expect: inner
function area(w: i64, h: i64): i64 {
  type Size = { w: i64; h: i64 };
  interface Shape { area(): i64 }
  class Rect implements Shape {
    s: Size;
    constructor(s: Size) { this.s = s; }
    area(): i64 { return this.s.w * this.s.h; }
  }
  enum Unit { Px = 1, Em = 16 }
  const r = new Rect({ w, h });
  return r.area() * Unit.Em;
}
function wrap<T>(x: T): T[] {
  class Holder {
    items: T[];
    constructor(items: T[]) { this.items = items; }
  }
  type Pair = [T, T];
  const p: Pair = [x.clone(), x.clone()];
  const h = new Holder([p[0].clone()]);
  return h.items;
}
function main() {
  console.log(area(2, 3), wrap(5).length, wrap("s")[0]);
  {
    type Size = string;
    const s: Size = "inner";
    console.log(s);
  }
}
// case: local_classes_enums_and_shadowing
// expect: local hi 0
// expect: circle 2
class Point { x: i64 = 0; }
class Store<T> {
  items: T[] = [];
  count(): i64 {
    type Counter = { n: i64; of: T[] };
    const c: Counter = { n: this.items.length as i64, of: [] };
    return c.n;
  }
}
function main() {
  class Point { y: string = "local"; }
  class Base { greet(): string { return "hi"; } }
  class Child extends Base { name: string = "c"; }
  enum Shape { Circle(f64), Square(f64) }
  const s: Shape = Shape.Circle(2.0);
  const p = new Point();
  console.log(p.y, new Child().greet(), new Store<i64>().count());
  match (s) {
    case Shape.Circle(r) => console.log("circle", r),
    case Shape.Square(w) => console.log("square", w),
  }
}
// case: local_capture
// error: the local class 'C' can't use 'k' from the function around it, which it may outlive; pass it to its constructor
function main() {
  const k = 3;
  class C {
    get(): i64 { return k; }
  }
  console.log(new C().get());
}
// case: local_outside
// error: cannot find type 'Id'
function f() {
  type Id = i64;
}
function main() {
  const x: Id = 1;
}
// case: local_before
// error: class 'P' is used before its declaration
class P { x: i64 = 1; }
function main() {
  const a = new P().x;
  class P { x: i64 = 7; }
}
// case: local_whole_block
// expect: 3 7 7
// expect: 20
// expect: 2 1
// expect: 5
class P { x: i64 = 1; }
enum E { A = 2 }
function main() {
  const n: Num = 3;
  const make = (): i64 => new P().x;
  function made(): i64 { return new P().x; }
  const e = (): i64 => E.A;
  type Num = i64;
  class P { x: i64 = 7; }
  enum E { A = 20 }
  console.log(n, make(), made());
  console.log(e());
  class A { b(): B { return new B(); } n(): i64 { return 1; } }
  class B { a(): A { return new A(); } n(): i64 { return 2; } }
  console.log(new A().b().n(), new B().a().n());
  class Holder { opts: Opts = { size: 5 }; }
  type Opts = { size: i64 };
  console.log(new Holder().opts.size);
}
// case: local_in_local_members
// expect: 7
// expect: s
// expect: red 1
type T = boolean;
function f<T>(v: T): T {
  class Box {
    x: i64 = 7;
    keep(v: T): T {
      type W = { w: T };
      type Pair = [Box, Box];
      const p: Pair = [new Box(), new Box()];
      const w: W = { w: v };
      console.log(p[1].x);
      return w.w;
    }
  }
  return new Box().keep(v);
}
function main() {
  console.log(f("s"));
  type Color = "red" | "blue";
  const Color = 1;
  const c: Color = "red";
  console.log(c, Color);
}
// case: local_capture_scope
// expect: 2
// expect: 9
function helper(): i64 { return 9; }
function main() {
  class C { f(): i64 { return helper(); } }
  {
    const helper = 2;
    console.log(helper);
  }
  console.log(new C().f());
}
// case: local_message
// error: type 'P' is not assignable to type 'string'
function main() {
  class P { x: i64 = 1; }
  const p: P = new P();
  const s: string = p;
}
