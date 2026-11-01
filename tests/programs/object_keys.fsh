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
// case: object_keys_map
// error: 'Object.keys' reads an object's fields, and a Map has none; use the Map's own 'keys()'
function main() {
  const m = new Map<string, i64>();
  console.log(Object.keys(m));
}
// case: object_keys_set
// error: 'Object.values' reads an object's fields, and a Set has none; use the Set's own 'values()'
function main() {
  const s = new Set<string>();
  console.log(Object.values(s));
}
// case: object_keys_temporary
// error: 'Object.values' reads a variable or a field; store this value in a 'const' first
function make() {
  return { a: 1 };
}
function main() {
  console.log(Object.values(make()));
}
// case: object_keys_tuple
// error: 'Object.keys' reads the fields of an object or a class instance, not '[i64, string]'
function main() {
  const t: [i64, string] = [1, "a"];
  console.log(Object.keys(t));
}
// case: object_keys_number
// error: 'Object.entries' reads the fields of an object or a class instance, not 'i64'
function main() {
  const n = 3;
  console.log(Object.entries(n));
}
// case: object_keys_no_fields
// error: '{}' has no fields, so 'Object.values' would give an array of nothing
function main() {
  const e = {};
  console.log(Object.values(e));
}
// case: object_keys_other_static
// error: 'Object' has no 'assign' yet; it has 'keys', 'values' and 'entries'
function main() {
  const o = { a: 1 };
  console.log(Object.assign(o));
}
// case: object_keys_optional_call
// error: 'Object' is always there, so 'Object.keys' is called without '?.'
function main() {
  const o = { a: 1 };
  console.log(Object?.keys(o));
}
// case: object_keys_arguments
// error: 'Object.keys' takes the object to read
function main() {
  const o = { a: 1 };
  console.log(Object.keys(o, o));
}
// case: object_keys_shadowed
// expect: mine
// A program's own 'Object' is the one called.
class Object {
  static keys(o: { a: i64 }): string {
    return "mine";
  }
}
function main() {
  const o = { a: 1 };
  console.log(Object.keys(o));
}
