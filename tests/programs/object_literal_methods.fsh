// case: object_literal_methods_basic
// expect: 25 7
// expect: hi fish
// Methods and getters in an object literal read its properties through 'this'.
function main() {
  const p = { x: 3, y: 4, norm() { return this.x * this.x + this.y * this.y; }, get sum() { return this.x + this.y; } };
  console.log(p.norm(), p.sum);
  const name = "fish";
  const g = { name, greet(): string { return "hi " + this.name; } };
  console.log(g.greet());
}
// case: object_literal_methods_mut_this
// expect: 5 10
// expect: 10
// A method declaring 'this: Mut<this>' changes the object, and a setter does, as in a class.
function main() {
  let counter = {
    count: 0,
    inc(this: Mut<this>, by: i64) { this.count += by; },
    get doubled() { return this.count * 2; },
    set value(v: i64) { this.count = v; },
  };
  counter.inc(2);
  counter.inc(3);
  console.log(counter.count, counter.doubled);
  counter.value = 10;
  console.log(counter.count);
}
// case: object_literal_methods_read_only
// error: cannot assign to 'this.n' because 'this' is read-only here; declare 'this: Mut<this>'
function main() {
  let o = { n: 0, bump() { this.n = 1; } };
  o.bump();
}
// case: object_literal_methods_fits
// expect: 6 2
// The object fits an object type with a method, and one with its fields.
type Area = { area(): i64 };
function measure(s: Area): i64 { return s.area(); }
function width(o: { w: i64 }): i64 { return o.w; }
function main() {
  const r = { w: 2, h: 3, area() { return this.w * this.h; } };
  const s = { w: 2, h: 3, area() { return this.w * this.h; } };
  console.log(measure(r), width(s));
}
// case: object_literal_methods_factories
// expect: hi fish 42
// Literals returned from a function and from an arrow, each an instance of its own type.
function make(name: string) { return { name, greet() { return "hi " + this.name; } }; }
const twice = (n: i64) => ({ n, doubled(): i64 { return this.n * 2; } });
function main() {
  console.log(make("fish").greet(), twice(21).doubled());
}
// case: object_literal_methods_nested
// expect: 3
// A literal inside a method is made inside it.
function main() {
  const outer = { k: 2, inner() { return { v: this.k, next(): i64 { return this.v + 1; } }; } };
  console.log(outer.inner().next());
}
// case: object_literal_methods_generic_types
// expect: 3 two
// Each literal's properties keep the types they were given.
function main() {
  const a = { v: 1, plus(x: i64): i64 { return this.v + x; } };
  const b = { v: "two", shown(): string { return this.v; } };
  console.log(a.plus(2), b.shown());
}
// case: object_literal_methods_capture
// error: a method in an object literal can't use 'base' from the function around it yet
function main() {
  const base = 10;
  const o = { add(x: i64) { return base + x; } };
  console.log(o.add(1));
}
