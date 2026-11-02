// case: unknown_type_typeof
// An unknown narrows by typeof to what it holds; any number reads as an f64, as in TypeScript.
function describe(u: unknown): string {
  if (typeof u === "string") return `string of ${u.length}`
  if (typeof u === "number") return `number ${u + 1}`
  if (typeof u === "boolean") return `boolean ${!u}`
  if (typeof u === "bigint") return `bigint ${u * 2n}`
  if (typeof u === "undefined") return "nothing"
  return "something else"
}
function main() {
  console.log(describe("fish"))
  console.log(describe(41))
  console.log(describe(2.5))
  console.log(describe(7 as u8))
  console.log(describe(true))
  console.log(describe(21n))
  console.log(describe(null))
  console.log(describe([1, 2]))
}
// expect: string of 4
// expect: number 42
// expect: number 3.5
// expect: number 8
// expect: boolean false
// expect: bigint 42
// expect: nothing
// expect: something else
// case: unknown_type_instanceof
class Animal {
  constructor(public name: string) {}
}
class Dog extends Animal {
  constructor(name: string, public tricks: i64) { super(name) }
}
class Rock {
  constructor(public weight: i64) {}
}
function main() {
  const things: unknown[] = [new Dog("rex", 3), new Animal("cat"), new Rock(9), "pebble"]
  for (const t of things) {
    if (t instanceof Dog) console.log("dog", t.name, t.tricks)
    else if (t instanceof Animal) console.log("animal", t.name)
    else if (t instanceof Rock) console.log("rock", t.weight)
    else console.log("not an object")
  }
}
// expect: dog rex 3
// expect: animal cat
// expect: rock 9
// expect: not an object
// case: unknown_type_predicate
type Box = { label: string; size: i64 }
function isBox(u: Ref<unknown>): u is Box {
  return typeof u !== "string" && typeof u !== "number"
}
function isNumber(u: Ref<unknown>): u is f64 {
  return typeof u === "number"
}
function main() {
  const values: unknown[] = [{ label: "crate", size: 3 }, "label", 7]
  for (const v of values) {
    if (isBox(v)) console.log(v.label, v.size)
    else if (isNumber(v)) console.log(v / 2)
    else console.log("neither")
  }
}
// expect: crate 3
// expect: neither
// expect: 3.5
// case: unknown_type_predicate_wrong
function isText(u: Ref<unknown>): u is string {
  return typeof u !== "boolean"
}
function main() {
  const v: unknown = 5
  if (isText(v)) console.log(v)
}
// panic: the type predicate 'isText' said 'v' is 'string', but it holds a 'i64'
// case: unknown_type_print
class Point {
  constructor(public x: i64, public y: i64) {}
}
function main() {
  const values: unknown[] = [1, "two", 3.5, true, null, new Point(1, 2), { a: [1, 2] }, 10n]
  for (const v of values) console.log(v)
  const few: unknown[] = [1, "two", null]
  console.log(few)
  let m = new Map<string, unknown>()
  m.set("n", 1)
  m.set("s", "x")
  console.log(m)
}
// expect: 1
// expect: two
// expect: 3.5
// expect: true
// expect: null
// expect: Point { x: 1, y: 2 }
// expect: { a: [ 1, 2 ] }
// expect: 10n
// expect: [ 1, 'two', null ]
// expect: Map(2) { 'n' => 1, 's' => 'x' }
// case: unknown_type_places
// An unknown is held in fields, returned, reassigned and given to generic code.
class Holder {
  value: unknown
  constructor(value: unknown) { this.value = value }
}
function wrap<T>(x: T): unknown {
  return x
}
function id<T>(x: T): T {
  return x
}
function main() {
  const h = new Holder("held")
  if (typeof h.value === "string") console.log(h.value.toUpperCase())
  const w = wrap(20)
  if (typeof w === "number") console.log(w * 2)
  const back = id(w)
  console.log(back)
  let v: unknown = 1
  v = "now a string"
  console.log(v)
  let later: unknown
  later = false
  console.log(later)
  const opt: unknown | null = null
  console.log(opt)
}
// expect: HELD
// expect: 40
// expect: 20
// expect: now a string
// expect: false
// expect: null
// case: unknown_type_defaults
// An optional or defaulted unknown parameter holds null when left out, which '??' replaces.
function shown(x: unknown = 5): unknown {
  return x
}
function maybe(x?: unknown): unknown {
  return x ?? "fallback"
}
function pick(b: boolean): unknown {
  return b ? "text" : 2
}
function main() {
  console.log(shown(), shown("given"), maybe(), maybe(3))
  let xs: unknown[] = []
  xs.push(1.5)
  xs.push("q")
  const o: { v: unknown } = { v: [1] }
  const t: [unknown, i64] = ["t", 1]
  console.log(xs, pick(true), pick(false), o, t)
}
// expect: 5 given fallback 3
// expect: [ 1.5, 'q' ] text 2 { v: [ 1 ] } [ 't', 1 ]
// case: unknown_type_references
function half(u: Ref<unknown>) {
  if (typeof u === "number") console.log(u / 2)
}
function rename(u: Mut<unknown>) {
  if (typeof u === "string") u = "renamed"
}
function main() {
  const a: unknown = 7
  const b: unknown = 2.5
  half(a)
  half(b)
  let s: unknown = "first"
  rename(s)
  console.log(s)
}
// expect: 3.5
// expect: 1.25
// expect: renamed
// case: unknown_type_compare
function main() {
  const values: unknown[] = [2, "b", null, true]
  for (const v of values) {
    if (v === 2) console.log("two")
    if (v === "b") console.log("bee")
    if (v === null) console.log("empty")
    if (v !== true) console.log("not true")
  }
}
// expect: two
// expect: not true
// expect: bee
// expect: not true
// expect: empty
// expect: not true
// case: unknown_type_compare_numbers
// Numbers in an unknown are JavaScript's, equal across the kinds Fish has.
function main() {
  const one: unknown = 1
  const float: unknown = 1.0
  const byte: unknown = 7 as u8
  if (one === 1.0) console.log("1 is 1.0")
  if (float === 1) console.log("1.0 is 1")
  if (byte === 7) console.log("7 as u8 is 7")
  if (one === float) console.log("both one")
  if (one !== "1") console.log("not the string")
}
// expect: 1 is 1.0
// expect: 1.0 is 1
// expect: 7 as u8 is 7
// expect: both one
// expect: not the string
// case: unknown_type_compare_integers
// Integers of different kinds compare exactly, never through an f64.
function main() {
  const a: unknown = 9007199254740992
  const b: unknown = 9007199254740993 as u64
  const neg: unknown = -1
  const byte: unknown = 255 as u8
  console.log(a === b, a === 9007199254740992 as u64, neg === byte, byte === 255)
}
// expect: false true false true
// case: unknown_type_exact_integer
// typeof "number" reads any number as an f64, rounding a large integer as TypeScript does; a
// type predicate gets the integer back exactly.
function isI64(u: Ref<unknown>): u is i64 {
  return typeof u === "number"
}
function main() {
  const big: unknown = 9007199254740993
  if (typeof big === "number") console.log(big)
  if (isI64(big)) console.log(big)
}
// expect: 9007199254740992
// expect: 9007199254740993
// case: unknown_type_inferred
function put<T>(xs: Mut<T[]>, x: T) {
  xs.push(x)
}
function main() {
  let xs: unknown[] = []
  put(xs, "s")
  put(xs, 4)
  console.log(xs)
}
// expect: [ 's', 4 ]
// case: unknown_type_optional_field
type Options = { extra?: unknown; size: i64 }
function main() {
  const o: Options = { size: 1 }
  const p: Options = { extra: "more", size: 2 }
  console.log(o.extra ?? "none", p.extra ?? "none")
}
// expect: none more
// case: unknown_type_json
function main() {
  const values: unknown[] = ["s", 1, [true, false], { a: 1 }]
  console.log(JSON.stringify(values))
}
// expect: ["s",1,[true,false],{"a":1}]
// case: unknown_type_comptime
function kind(u: unknown): string {
  if (typeof u === "number") return "number"
  if (typeof u === "string") return "string"
  return "other"
}
function made(): unknown {
  return 5
}
const k = comptime kind(5)
const j = comptime kind("x")
const m = comptime made()
function main() {
  console.log(k, j, m)
}
// expect: number string 5
// case: unknown_type_nothing_stored
function show(u: unknown) {
  if (typeof u === "string") console.log(u)
}
function main() {
  console.log("nothing goes in")
}
// expect: nothing goes in
// case: unknown_type_moves
function main() {
  const a: unknown = "s"
  const b = a
  console.log(a, b)
}
// error: unknown_type_moves.fsh:4:15: error[E0201]: 'a' was moved, so it can't be used here
// case: unknown_type_unnarrowed_property
function main() {
  const u: unknown = "fish"
  console.log(u.length)
}
// error: unknown_type_unnarrowed_property.fsh:3:15: error[E0502]: an 'unknown' could hold anything, so it has no property 'length' until it is narrowed; check what it holds first, with 'typeof', 'instanceof' or a type predicate
// case: unknown_type_unnarrowed_method
function main() {
  const u: unknown = "fish"
  console.log(u.toUpperCase())
}
// error: unknown_type_unnarrowed_method.fsh:3:15: error[E0502]: an 'unknown' could hold anything, so it has no property 'toUpperCase' until it is narrowed
// case: unknown_type_unnarrowed_assign
function main() {
  const u: unknown = 1
  const n: i64 = u
}
// error: unknown_type_unnarrowed_assign.fsh:3:18: error[E0101]: type 'unknown' is not assignable to type 'i64'
// case: unknown_type_unnarrowed_arithmetic
function main() {
  const u: unknown = 1
  console.log(u + 1)
}
// error: unknown_type_unnarrowed_arithmetic.fsh:3:15: error[E0103]: operator '+' cannot be applied to types 'unknown' and 'i64'
// case: unknown_type_as
function main() {
  const u: unknown = 1
  console.log(u as i64)
}
// error: unknown_type_as.fsh:3:15: error[E0111]: 'as' can't narrow 'unknown' to 'i64'
// case: unknown_type_holds_function
function main() {
  const u: unknown = (x: i64) => x
}
// error: unknown_type_holds_function.fsh:2:22: error[E0101]: type '(x: i64) => i64' is not assignable to type 'unknown'
// case: unknown_type_compare_values
@derive(Eq)
class P {
  constructor(public x: i64) {}
}
function main() {
  const values: unknown[] = [new P(1), [1, 2], 3]
  for (const v of values) {
    if (v === new P(1)) console.log("equal point")
    if (v === [1, 2]) console.log("equal array")
    if (v !== 3) console.log("not three")
  }
}
// expect: equal point
// expect: not three
// expect: equal array
// expect: not three
// case: unknown_type_json_bigint
function main() {
  const u: unknown = 10n
  console.log(JSON.stringify(u))
}
// error: unknown_type_json_bigint.fsh:3:30: error[E0509]: this 'unknown' can't be written as JSON, since the program puts a 'bigint' in one, which has no JSON form
// case: unknown_type_json_parse
function main() {
  const u = JSON.parse<unknown>("1")
}
// error: unknown_type_json_parse.fsh:2:24: error[E0509]: 'JSON.parse' can't read into an 'unknown'
