// case: computed_keys_literals
// expect: { '3': 3, a: 1, b: 2, c4: 4 }
// expect: 1 2 4
// Keys written as literals and templates of literals name the object's fields.
function main() {
  const o = { ["a"]: 1, [`b`]: 2, [3]: 3, [`c${4}`]: 4 };
  console.log(o);
  console.log(o.a, o.b, o.c4);
}
// case: computed_keys_consts
// expect: 1 2 x-y
// A const holding a literal, local or top-level, and an `as const` value name fields too.
const TOP = "top";
function main() {
  const local = "here";
  const o = { [TOP]: 1, [local]: 2, [`${TOP}_${local}`]: "x-y" };
  console.log(o.top, o.here, o.top_here);
}
// case: computed_keys_enums
// expect: { '0': 'zero', '1': 'one', name: 'n' }
// expect: zero one n
// An enum member names a field by its value.
enum Num { Zero, One }
enum Str { Name = "name" }
function main() {
  const o = { [Num.Zero]: "zero", [Num.One]: "one", [Str.Name]: "n" };
  console.log(o);
  console.log(o["0"], o["1"], o.name);
}
// case: computed_keys_typed
// expect: 1 2
// A literal with computed keys fits a declared object type by those names.
const A = "a";
type T = { a: i64; b: i64 };
function main() {
  const t: T = { [A]: 1, ["b"]: 2 };
  console.log(t.a, t.b);
}
// case: computed_keys_class_members
// expect: 3 6 7
// A class's fields, methods and accessors may have computed names known while compiling.
const NAME = "count";
enum M { Double = "double" }
class C {
  [NAME]: i64 = 3;
  [M.Double](): i64 { return this.count * 2; }
  get [`plus${4}`](): i64 { return this.count + 4; }
}
function main() {
  const c = new C();
  console.log(c.count, c.double(), c.plus4);
}
// case: computed_keys_types
// expect: 1 2
// Object types and interfaces may name members with computed keys too.
const K = "k";
enum E { First, Second }
type T = { [K]: i64; [E.Second]: i64 };
interface I { [K](): i64 }
class D implements I { k(): i64 { return 2; } }
function main() {
  const t: T = { k: 1, [E.Second]: 2 };
  const d: I = new D();
  console.log(t.k, d.k());
}
// case: computed_keys_destructuring
// expect: 1 2
// A destructuring pattern may name fields with computed keys too.
const A = "a";
function main() {
  const o = { a: 1, b: 2 };
  const { [A]: x, ["b"]: y } = o;
  console.log(x, y);
}
// case: computed_keys_runtime
// error: a computed key has to be known while compiling, and this is a 'string'
// A key known only at run time can't name a field; that needs a Map.
function main() {
  let k = "a";
  const o = { [k]: 1 };
  console.log(o);
}
// case: computed_keys_class_runtime
// error: a computed key has to be known while compiling, and a class's or a type's member name can only read a top-level const or enum
function name(): string { return "x"; }
class C {
  [name()]: i64 = 1;
}
function main() {
  console.log(new C());
}
// case: computed_keys_symbol_iterator
// error: '[Symbol.iterator]' members are not supported yet
// `Symbol.iterator` names no field; iterating a class through it is a feature of its own.
class Bag {
  *[Symbol.iterator](): Generator<i64> { yield 1; }
}
function main() {
  console.log(new Bag());
}
// case: computed_keys_index
// expect: { k: 5, x: 3 } 6 3
// Indexing an object or an instance with a key known while compiling reads, writes or calls the
// field it names.
enum M { Double = "double" }
const B = "b";
class C {
  [B]: i64 = 3;
  [M.Double](): i64 { return this.b * 2; }
}
function main() {
  const k = "k";
  let o = { [k]: 1, x: 2 };
  o[k] = 5;
  o["x"] += 1;
  const c = new C();
  console.log(o, c[M.Double](), c[B]);
}
// case: computed_keys_spread_and_const
// expect: { a: 9, k: 5 } z
// Computed keys sit beside spreads, and keep their literal types under `as const`.
const A = "a";
function main() {
  const o = { k: 5 };
  const s = { ...o, [A]: 9 };
  const z = { [A]: "z" } as const;
  const lit: "z" = z.a;
  console.log(s, lit);
}
// case: computed_keys_duplicate
// error: duplicate property 'a'
function main() {
  const o = { a: 1, ["a"]: 2 };
  console.log(o);
}
// case: computed_keys_class_template_const
// error: a computed key has to be known while compiling, and this is a 'string'
// A const holding a template with values in it is a string, so it names no member.
const A = "a";
const AB = `${A}b`;
class C {
  [AB]: i64 = 1;
}
function main() {
  console.log(new C());
}
