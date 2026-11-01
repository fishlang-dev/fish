// case: object_keys_flat
// expect: [ 'age', 'name', 'ok' ]
// expect: [ 3, 'ann', true ]
// expect: [ [ 'age', 3 ], [ 'name', 'ann' ], [ 'ok', true ] ]
// expect: age 3
// expect: name ann
// expect: ok true
// expect: { age: 3, name: 'ann', ok: true }
// Values are copies, and the object is still there afterwards.
function main() {
  const o = { age: 3, name: "ann", ok: true };
  console.log(Object.keys(o));
  console.log(Object.values(o));
  console.log(Object.entries(o));
  for (const [k, v] of Object.entries(o)) console.log(k, v);
  console.log(o);
}
// case: object_keys_nested
// expect: [ 'inner', 'n' ]
// expect: [ { x: 1, y: 2 }, 1 ]
// expect: [ [ 'x', 1 ], [ 'y', 2 ] ]
// expect: [ { x: 1, y: 2 }, 1 ] { inner: { x: 9, y: 2 }, n: 1 }
// A nested object's value is a clone, so changing the original later leaves it as it was, where
// JavaScript's would share it and show the change.
function main() {
  let o = { inner: { x: 1, y: 2 }, n: 1 };
  console.log(Object.keys(o));
  const vs = Object.values(o);
  console.log(vs);
  console.log(Object.entries(o.inner));
  o.inner.x = 9;
  console.log(vs, o);
}
// case: object_keys_union_field
// expect: [ 1, 'two' ]
// expect: a is the number 1
// expect: b is the string two
// expect: 4
function describe(k: string, v: i64 | string): string {
  if (typeof v === "string") return `${k} is the string ${v}`;
  return `${k} is the number ${v}`;
}
function main() {
  const o: { a: i64 | string, b: i64 | string } = { a: 1, b: "two" };
  console.log(Object.values(o));
  for (const [k, v] of Object.entries(o)) console.log(describe(k, v));
  const p = { x: 1, y: 3 };
  const xs: i64[] = Object.values(p);
  let sum = 0;
  for (const x of xs) sum += x;
  console.log(sum);
}
// case: object_keys_class
// expect: [ 'id', 'name', 'tags' ]
// expect: [ 7, 'ann', [ 'a' ] ]
// expect: [ 'id', 'name', 'tags' ]
// Bases' fields first, then the class's own in declaration order; '#private' fields are left out.
class Base {
  id: i64 = 7;
}
class User extends Base {
  name: string;
  #secret: string = "s";
  tags: string[];
  constructor(name: string) {
    super();
    this.name = name;
    this.tags = ["a"];
  }
  names(): string[] {
    return Object.keys(this);
  }
}
function main() {
  const u = new User("ann");
  console.log(Object.keys(u));
  console.log(Object.values(u));
  console.log(u.names());
}
// case: object_keys_parameters
// expect: [ 'x', 'y' ] [ 1, 2 ]
// expect: [ [ 'x', 1 ], [ 'y', 2 ] ]
// expect: []
type Point = { x: i64, y: i64 };
function lent(p: Ref<Point>) {
  console.log(Object.keys(p), Object.values(p));
}
function typed(p: Point) {
  console.log(Object.entries(p));
}
function main() {
  const p: Point = { x: 1, y: 2 };
  lent(p);
  typed(p);
  const empty = {};
  console.log(Object.keys(empty));
}
// case: object_keys_generic
// expect: [ [ 'id', 1 ], [ 'label', 'one' ] ]
// expect: [ [ 'id', 2 ], [ 'label', 'two' ] ]
// expect: [ 'id', 'label' ] [ 3, 'three' ]
// A body checked once per type it is called with gives each the fields its parameter's type has.
type Row = { id: i64, label: string };
function rows(r: Row) {
  console.log(Object.entries(r));
}
function keyed<T extends Row>(r: T) {
  console.log(Object.keys(r), Object.values(r));
}
function main() {
  rows({ id: 1, label: "one" });
  const r: Row = { id: 2, label: "two" };
  rows(r);
  keyed({ id: 3, label: "three" });
}
