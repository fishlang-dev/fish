// case: union_bounds_basic
// A type parameter bounded by a union takes any member, and its values go where the bound goes.
function show<K extends i64 | string>(k: K): K {
  console.log(k, described(k))
  return k
}

function described(v: i64 | string): string {
  return typeof v === "string" ? "text" : "number"
}

function main() {
  const n: i64 = show(4)
  const s: string = show("a")
  console.log(n + 1, s)
}
// expect: 4 number
// expect: a text
// expect: 5 a
// case: union_bounds_primitive
// A primitive bound gives the parameter its operators and methods.
function twice<T extends string>(s: T): string {
  return s + s + `!${s}` + s.toUpperCase()
}

function inc<N extends i64>(n: N): i64 {
  return n + 1
}

function main() {
  console.log(twice("ab"), inc(4))
}
// expect: abab!abAB 5
// case: union_bounds_literals
// Comparing with a member, and a conditional return type each instance decides.
type Kind = "a" | "b"
type Out<K> = K extends "a" ? i64 : string

function pick<K extends Kind>(k: K): Out<K> throws JsonError {
  console.log(k === "a")
  return JSON.parse<Out<K>>(k === "a" ? "1" : "\"one\"")
}

function main() throws JsonError {
  const n: i64 = pick("a")
  const s: string = pick("b")
  console.log(n + 1, s)
}
// expect: true
// expect: false
// expect: 2 one
// case: union_bounds_conditional_param
// A conditional return type over the parameter itself, distributing at the definition.
function same<K extends i64 | string>(k: K): K extends i64 ? i64 : string {
  return k
}

function main() {
  const n: i64 = same(4)
  const s: string = same("x")
  console.log(n * 2, s)
}
// expect: 8 x
// case: union_bounds_indexed
// An indexed access type chosen by the type argument.
type Rec = { a: i64; b: string }

function read<K extends "a" | "b">(_k: K, text: string): Rec[K] throws JsonError {
  return JSON.parse<Rec[K]>(text)
}

function main() throws JsonError {
  const x: i64 = read("a", "12")
  console.log(x + 1, read("b", "\"hi\""))
}
// expect: 13 hi
// case: union_bounds_brands
// Kinds of id as brands of one base: a record type chosen per kind, arithmetic on the base, and
// a conversion back to the parameter.
type ObjId = Brand<usize, "object">
type ClsId = Brand<usize, "class">
type ObjRec = { kind: "object"; fields: i64 }
type ClsRec = { kind: "class"; name: string }
type RecordOf<T> = T extends ObjId ? ObjRec : T extends ClsId ? ClsRec : never

function describe<T extends ObjId | ClsId>(t: T, r: RecordOf<T>): string {
  const at: usize = t - 21
  console.log(at, t as usize, r)
  return r.kind
}

function next<T extends ObjId | ClsId>(t: T): T {
  return (t + 1) as T
}

function main() {
  console.log(describe(30 as ClsId, { kind: "class", name: "C" }))
  console.log(describe(22 as ObjId, { kind: "object", fields: 2 }))
  const o: ObjId = next(5 as ObjId)
  console.log(o)
}
// expect: 9 30 { kind: 'class', name: 'C' }
// expect: class
// expect: 1 22 { fields: 2, kind: 'object' }
// expect: object
// expect: 6
// case: union_bounds_brands_wrong_record
// error: argument of type '{ fields: i64; kind: string }' is not assignable to parameter of type '{ kind: "class"; name: string }'
type ObjId = Brand<usize, "object">
type ClsId = Brand<usize, "class">
type ObjRec = { kind: "object"; fields: i64 }
type ClsRec = { kind: "class"; name: string }
type RecordOf<T> = T extends ObjId ? ObjRec : T extends ClsId ? ClsRec : never

function describe<T extends ObjId | ClsId>(t: T, r: RecordOf<T>): usize {
  console.log(r)
  return t as usize
}

function main() {
  describe(30 as ClsId, { kind: "object", fields: 2 })
}
// case: union_bounds_class
// A generic class keyed by a union of names and brands, used with one member and with all.
type ObjId = Brand<usize, "object">
type ClsId = Brand<usize, "class">
type Type = "i64" | "string" | ObjId | ClsId

class TypeMap<K extends Type, V> {
  keys: K[] = []
  values: V[] = []
  set(this: Mut<this>, k: K, v: V) {
    console.log("set", named(k))
    this.keys.push(k)
    this.values.push(v)
  }
}

function named(t: Type): string {
  if (t === "i64" || t === "string") return t
  return "id"
}

function main() {
  let m = new TypeMap<ClsId, string>()
  m.set(3 as ClsId, "three")
  let all = new TypeMap<Type, i64>()
  all.set("i64", 1)
  all.set(5 as ObjId, 2)
  console.log(m.keys, all.keys.length, all.values)
}
// expect: set id
// expect: set i64
// expect: set id
// expect: [ 3 ] 2 [ 1, 2 ]
// case: union_bounds_unsatisfied
// error: type 'boolean' does not satisfy the constraint 'i64 | string'
function show<K extends i64 | string>(k: K): K {
  return k
}

function main() {
  console.log(show(true))
}
// case: union_bounds_class_unsatisfied
// error: type 'i64' does not satisfy the constraint '"a" | "b"'
class Box<K extends "a" | "b"> {
  constructor(public k: K) {}
}

function main() {
  const b = new Box<i64>(1)
  console.log(b.k)
}
// case: union_bounds_definition
// error: type 'K' is not assignable to return type 'i64'
// The definition is checked against the whole bound, so a string member refuses this.
function f<K extends i64 | string>(k: K): i64 {
  return k
}

function main() {}
// case: union_bounds_instance_as
// error: 'i64' can't be converted to 'string' with 'as', since neither fits the other
// Each instance checks a conversion to the type its argument chooses.
type Out<K> = K extends "a" ? i64 : string

function g<K extends "a" | "b">(k: K): Out<K> {
  console.log(k)
  return 1 as Out<K>
}

function main() {
  console.log(g("a"))
  console.log(g("b"))
}
// case: union_bounds_class_bound
// error: a type parameter's bound must be an interface, an object type, or a union, primitive, literal or brand type, not 'C'
class C {}

function f<K extends C>(k: K) {}

function main() {}
