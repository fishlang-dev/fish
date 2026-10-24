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
// error: cannot find type 'Num'
function main() {
  const n: Num = 1;
  type Num = i64;
}
// case: local_message
// error: type 'P' is not assignable to type 'string'
function main() {
  class P { x: i64 = 1; }
  const p: P = new P();
  const s: string = p;
}
