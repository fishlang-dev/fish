// case: brand_basic
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function next(id: UserId): UserId {
  return (id + 1) as UserId
}

function raw(id: UserId): usize {
  return id
}

function main() {
  const a = 5 as UserId
  const b: UserId = next(a)
  console.log(a, b, raw(b), `${b}`)
  print(b)
  const o = 3 as OrderId
  console.log(a === b, a < b, a === (5 as usize), o as usize)
}
// expect: 5 6 6 6
// expect: 6
// expect: false true true 3
// case: brand_positions
type UserId = Brand<usize, "UserId">
type Email = Brand<string, "Email">

class User {
  constructor(public id: UserId, public email: Email) {}
}

type Row = { id: UserId; name: string }

function find(users: Ref<User[]>, id: UserId): Email | null {
  for (const u of users) if (u.id === id) return u.email
  return null
}

function main(): void throws JsonError {
  const users = [new User(0 as UserId, "a@x.io" as Email), new User(1 as UserId, "b@x.io" as Email)]
  const id = 1 as UserId
  console.log(users[id].email, find(users, id) ?? ("none" as Email))
  const row: Row = { id, name: "b" }
  console.log(row, JSON.stringify(row))
  let names = new Map<UserId, string>()
  names.set(id, "b")
  let seen = new Set<UserId>()
  seen.add(id)
  console.log(names.get(id), seen.has(id), names.has(0 as UserId))
  let ids: UserId[] = [id, 0 as UserId]
  ids.sort((a, b) => (a as i64) - (b as i64))
  console.log(ids)
  const maybe: UserId | null = ids.length > 1 ? id : null
  if (maybe !== null) console.log(maybe + 1)
  const e = users[0].email
  console.log(e.length, e.toUpperCase(), e.startsWith("a"), e === users[0].email)
  const back = JSON.parse<Row>(`{"id": 7, "name": "z"}`)
  console.log(back.id, back.name)
  const f = (x: UserId): UserId => (x + 10) as UserId
  console.log(f(id))
}
// expect: b@x.io b@x.io
// expect: { id: 1, name: 'b' } {"id":1,"name":"b"}
// expect: b true false
// expect: [ 0, 1 ]
// expect: 2
// expect: 6 A@X.IO true true
// expect: 7 z
// expect: 11
// case: brand_generic
type UserId = Brand<usize, "UserId">
type Count = Brand<i64, "Count">
type Small = Brand<u32, "Small">

interface HasId {
  id: UserId
}

class Box<T> {
  constructor(public value: T) {}
  get(): T {
    return this.value.clone()
  }
}

function show(t: Brand<usize, string>): string {
  return `#${t}`
}

function any(id: Brand<usize, string>): usize {
  return id as usize
}

function first<T>(xs: Ref<T[]>): T {
  return xs[0].clone()
}

async function later(id: UserId): Promise<UserId> {
  await sleep(1)
  const local = id
  return local
}

function* count(from: UserId): Generator<UserId> {
  let i: usize = from
  while (i < from + 3) {
    yield i as UserId
    i++
  }
}

function idOf(h: HasId): UserId {
  return h.id
}

async function main() {
  const id = 4 as UserId
  const b = new Box<UserId>(id)
  console.log(b.get(), show(id), any(id), first([id]))
  const l = await later(id)
  console.log(l)
  for (const x of count(id)) console.log(x)
  console.log(idOf({ id }))
  const c = -2 as Count
  const s = 7 as Small
  console.log(c * 3, s + 1, c < (0 as Count), s as i64)
  const add = (x: UserId) => x + id
  console.log(add(1 as UserId))
  let o: { id: UserId | null } = { id: null }
  o.id = id
  console.log(o)
}
// expect: 4 #4 4 4
// expect: 4
// expect: 4
// expect: 5
// expect: 6
// expect: 4
// expect: -6 8 true 7
// expect: 5
// expect: { id: 4 }
// case: brand_from_base
type UserId = Brand<usize, "UserId">

function main() {
  const n: usize = 3
  const id: UserId = n
}
// error: type 'usize' is not assignable to type 'Brand<usize, "UserId">'; make one with 'as Brand<usize, "UserId">'
// case: brand_from_literal
type UserId = Brand<usize, "UserId">

function main() {
  const id: UserId = 5
}
// error: type 'i64' is not assignable to type 'Brand<usize, "UserId">'; make one with 'as Brand<usize, "UserId">'
// case: brand_from_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function main() {
  const o = 3 as OrderId
  const id: UserId = o
}
// error: type 'Brand<usize, "OrderId">' is not assignable to type 'Brand<usize, "UserId">'
// case: brand_family_from_base
function f(x: Brand<usize, string>) {}

function main() {
  const n: usize = 1
  f(n)
}
// error: argument of type 'usize' is not assignable to parameter of type 'Brand<usize, string>'
// case: brand_mix
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function main() {
  const a = 1 as UserId
  const o = 3 as OrderId
  console.log(a + o)
}
// error: operator '+' can't mix 'Brand<usize, "UserId">' and 'Brand<usize, "OrderId">'; convert one side with 'as'
// case: brand_compare_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function main() {
  const a = 1 as UserId
  const o = 3 as OrderId
  console.log(a === o)
}
// error: operator '===' can't mix 'Brand<usize, "UserId">' and 'Brand<usize, "OrderId">'; convert one side with 'as'
// case: brand_compound_assign
type A = Brand<usize, "A">

function main() {
  let a = 1 as A
  a += 1
}
// error: type 'usize' is not assignable to type 'Brand<usize, "A">'
// case: brand_as_unrelated
type UserId = Brand<usize, "UserId">

function main() {
  const s = "x" as UserId
}
// error: '"x"' can't be converted to 'Brand<usize, "UserId">' with 'as'
// case: brand_base_kind
type B = Brand<string[], "X">

function main() {}
// error: a brand's base is a number, boolean, string or bigint type, not 'string[]'
// case: brand_arguments
function f(x: Brand<usize>) {}

function main() {}
// error: 'Brand' takes the type it brands and a tag naming it, like 'Brand<usize, "UserId">'
// case: brand_tag_parameter
function f<T>(x: Brand<usize, T>) {}

function main() {}
// error: brand tags holding type parameters are not supported yet
// case: brand_idiom
type InstanceId = usize & { readonly __arena?: "instance" }
type BodyId = usize & { readonly __arena?: "body" }
type Id = i64 & { __brand: "Id" }
type Name = { readonly __brand: "Name" } & string

class Arenas {
  names: string[] = []
  add(this: Mut<this>, name: string): InstanceId {
    this.names.push(name)
    return this.names.length
  }
  nameOf(id: InstanceId): string {
    return this.names[id - 1]
  }
}

function main() {
  let arenas = new Arenas()
  const a = arenas.add("a")
  const b: InstanceId = 2
  arenas.add("b")
  console.log(arenas.nameOf(a), arenas.nameOf(b), a + b)
  const id = 7 as Id
  const n = "fish" as Name
  console.log(id, n, n.length)
  let ids = new Map<InstanceId, BodyId>()
  ids.set(a, 3)
  console.log(ids.get(a))
}
// expect: a b 3
// expect: 7 fish 4
// expect: 3
// case: brand_idiom_other
type InstanceId = usize & { readonly __arena?: "instance" }
type BodyId = usize & { readonly __arena?: "body" }

function main() {
  const a: InstanceId = 1
  const b: BodyId = a
}
// error: type 'usize & { __arena?: "instance" }' is not assignable to type 'usize & { __arena?: "body" }'
// case: brand_idiom_strict
type Id = i64 & { __brand: "Id" }

function main() {
  const n: i64 = 1
  const id: Id = n
}
// error: type 'i64' is not assignable to type 'i64 & { __brand: "Id" }'; make one with 'as i64 & { __brand: "Id" }'
// case: brand_own_alias
type Brand<K, T> = K & { __brand: T }
type UserId = Brand<usize, "UserId">

class Unit {
  n = 1
}

function main() {
  const id = 3 as UserId
  console.log(id, new Unit().n)
}
// expect: 3 1
// case: brand_closure_argument
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function main() {
  const o = 1 as OrderId
  const f = (x: UserId): usize => x
  console.log(f(o))
}
// error: 7:17: error[E0101]: argument of type 'Brand<usize, "OrderId">' is not assignable to parameter of type 'Brand<usize, "UserId">'
// case: brand_closure_result
type UserId = Brand<usize, "UserId">

function main() {
  const n: usize = 5
  const f: () => UserId = () => n
  console.log(f())
}
// error: 5:27: error[E0101]: type '() => usize' is not assignable to type '() => Brand<usize, "UserId">'
// case: brand_function_value
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function idf(x: UserId): usize {
  return x
}

function main() {
  const o = 1 as OrderId
  const f = idf
  console.log(f(o))
}
// error: 11:17: error[E0101]: argument of type 'Brand<usize, "OrderId">' is not assignable to parameter of type 'Brand<usize, "UserId">'
// case: brand_field_write
type UserId = Brand<usize, "UserId">
type R = { id: UserId }

function main() {
  let o: R = { id: 2 as UserId }
  o.id = 7
}
// error: 6:10: error[E0101]: type 'i64' is not assignable to type 'Brand<usize, "UserId">'
// case: brand_optional_field_write
type UserId = Brand<usize, "UserId">

function main() {
  const n: usize = 1
  let o: { id: UserId | null } = { id: null }
  o.id = n
}
// error: 6:10: error[E0101]: type 'usize' is not assignable to type 'null | Brand<usize, "UserId">'
// case: brand_loose_to_strict
type L = usize & { readonly __b?: "X" }
type S = usize & { readonly __b: "X" }

function main() {
  const l: L = 5
  const s: S = l
}
// error: 6:16: error[E0101]: type 'usize & { __b?: "X" }' is not assignable to type 'usize & { __b: "X" }'
// case: brand_increment
type UserId = Brand<usize, "UserId">

function main() {
  let u = 1 as UserId
  u++
}
// error: 5:3: error[E0103]: operator '++' gives a 'usize', which a 'Brand<usize, "UserId">' is made from only with 'as'; write it as an assignment, like 'x = (x + 1) as Brand<usize, "UserId">'
// case: brand_string_append
type E = Brand<string, "E">

function main() {
  let e = "a" as E
  e += "b"
}
// error: type 'string' is not assignable to type 'Brand<string, "E">'; make one with 'as Brand<string, "E">'
// case: brand_callbacks
type UserId = Brand<usize, "UserId">
type M = Unit<f64, "m">
type L = usize & { readonly __b?: "X" }
type Flag = Brand<boolean, "Flag">

function app(f: (x: UserId) => UserId, n: UserId): UserId {
  return f(n)
}

function add(a: M, b: M): M {
  return a + b
}

function main() {
  const id = app((x) => x, 3 as UserId)
  let xs: M[] = [1 as M, 2 as M]
  console.log(id, xs.reduce((a: M, b: M): M => a + b, 0 as M), xs.reduce(add, 0 as M))
  let mut: { id: UserId } = { id }
  mut.id = 9 as UserId
  switch (mut.id) {
    case 9:
      console.log("nine")
      break
    default:
      console.log("other")
  }
  let l: L = 5
  l++
  const f = true as Flag
  if (f) console.log(mut.id, l, Math.max(id, 7), Math.sqrt(2.25 as Brand<f64, "F">))
}
// expect: 3 3 3
// expect: nine
// expect: 9 6 7 1.5
// case: brand_channel_send
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

async function main() {
  const c = new Channel<UserId>(1)
  await c.send(1 as OrderId)
}
// error: 6:16: error[E0101]: argument of type 'Brand<usize, "OrderId">' is not assignable to parameter of type 'Brand<usize, "UserId">'
// case: brand_await_result
type LU = usize & { readonly __b?: "u" }
type LO = usize & { readonly __b?: "o" }

async function f(): Promise<LU> {
  return 1 as LU
}

async function main() {
  const o: LO = await f()
  console.log(o)
}
// error: 9:17: error[E0101]: type 'usize & { __b?: "u" }' is not assignable to type 'usize & { __b?: "o" }'
// case: brand_generator_yield
type LU = usize & { readonly __b?: "u" }
type LO = usize & { readonly __b?: "o" }

function* g(): Generator<LU> {
  yield 1 as LU
}

function main() {
  for (const x of g()) {
    const o: LO = x
    console.log(o)
  }
}
// error: 10:19: error[E0101]: type 'usize & { __b?: "u" }' is not assignable to type 'usize & { __b?: "o" }'
// case: brand_spread
type LU = usize & { readonly __b?: "u" }
type LO = usize & { readonly __b?: "o" }

function main() {
  const ids: LU[] = [1 as LU]
  const o: LO[] = [...ids]
  console.log(o)
}
// error: 6:20: error[E0101]: type 'usize & { __b?: "u" }' is not assignable to type 'usize & { __b?: "o" }'
// case: brand_object_spread_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function main() {
  const r = { id: 1 as UserId, n: 2 }
  const o: { id: OrderId; n: i64 } = { ...r }
  console.log(o)
}
// error: 6:38: error[E0101]: type '{ id: Brand<usize, "UserId">; n: i64 }' is not assignable to type '{ id: Brand<usize, "OrderId">; n: i64 }'
// case: brand_async_kept
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">


async function f(n: usize): Promise<UserId> {
  await sleep(1)
  return n as UserId
}

async function* ids(): AsyncGenerator<UserId> {
  yield 1 as UserId
  yield 2 as UserId
}

function* more(): Generator<UserId | null> {
  yield 3 as UserId
  yield null
}

async function main() {
  const a: UserId = await f(4)
  const [b, c] = await Promise.all([f(5), f(6)])
  const h = spawn(async () => 7 as UserId)
  const d: UserId = await h
  console.log(a, b, c, d)
  for await (const x of ids()) {
    const u: UserId = x
    console.log(u)
  }
  let g = more()
  console.log(g.next(), g.next(), g.next())
  const ch = new Channel<UserId>(2)
  await ch.send(8 as UserId)
  ch.close()
  for await (const v of ch) {
    const u: UserId = v
    console.log(u)
  }
  const ch2 = new Channel<UserId>(1)
  await ch2.send(9 as UserId)
  const r = await ch2.receive()
  const o: UserId | null = r
  console.log(o)
} 
// expect: 4 5 6 7
// expect: 1
// expect: 2
// expect: { done: false, value: 3 } { done: false, value: null } { done: true }
// expect: 8
// expect: 9
// case: brand_spreads_kept
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function* g(): Generator<UserId> {
  yield 1 as UserId
}

function main() {
  for (const x of g()) {
    const u: UserId = x
    console.log(u)
  }
  const ids: UserId[] = [1 as UserId]
  const o: UserId[] = [...ids]
  const r = { id: 1 as UserId, n: 2 }
  const s: { id: UserId; n: i64 } = { ...r }
  console.log(o, s)
}
// expect: 1
// expect: [ 1 ] { id: 1, n: 2 }
// case: brand_inferred_kept
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function app<T>(x: T, f: (v: T) => void) {
  f(x)
}

function mk<T>(x: T) {
  return { v: x }
}

async function main(): Promise<void> throws Error {
  app<UserId>(1 as UserId, (v) => {
    const o: UserId = v
    console.log(o)
  })
  const p = new Promise<UserId>((res) => res(2 as UserId))
  const a: UserId = await p
  const r = mk<UserId>(3 as UserId)
  const b: UserId = r.v
  const { promise, resolve } = Promise.withResolvers<UserId>()
  resolve(4 as UserId)
  const c: UserId = await promise
  console.log(a, b, c)
}
// expect: 1
// expect: 2 3 4
// case: brand_contextual_arrow_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function app<T>(x: T, f: (v: T) => void) {
  f(x)
}

function main() {
  app<UserId>(1 as UserId, (v) => {
    const o: OrderId = v
  })
}
// error: 10:24: error[E0101]: type 'Brand<usize, "UserId">' is not assignable to type 'Brand<usize, "OrderId">'
// case: brand_new_promise_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

async function main() {
  const p = new Promise<UserId>((res) => res(1 as UserId))
  const o: OrderId = await p
}
// error: 6:22: error[E0101]: type 'Brand<usize, "UserId">' is not assignable to type 'Brand<usize, "OrderId">'
// case: brand_inferred_return_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

function mk<T>(x: T) {
  return { v: x }
}

function main() {
  const r = mk<UserId>(1 as UserId)
  const o: OrderId = r.v
}
// error: 10:22: error[E0101]: type 'Brand<usize, "UserId">' is not assignable to type 'Brand<usize, "OrderId">'
// case: brand_resolvers_other
type UserId = Brand<usize, "UserId">
type OrderId = Brand<usize, "OrderId">

async function main(): Promise<void> throws Error {
  const { promise, resolve } = Promise.withResolvers<UserId>()
  resolve(1 as UserId)
  const v = await promise
  const o: OrderId = v
}
// error: 8:22: error[E0101]: type 'Brand<usize, "UserId">' is not assignable to type 'Brand<usize, "OrderId">'

// case: brand_union_given_to_a_callback
// expect: true 2
type A = Brand<usize, "a">;
type B = Brand<usize, "b">;
type T = "x" | "y" | A | B;
function big(t: Exclude<T, string>, n: usize): boolean { return t > n; }
function main() {
  let objects: Exclude<T, string>[] = [];
  objects.push(3 as A);
  objects.push(5 as B);
  const n: usize = 4;
  console.log(objects.some((m) => big(m, n)), objects.filter((m) => big(m, 1)).length);
}

// case: brand_optional_field_narrowed_holding_a_literal
// expect: i64
// expect: id 7
type A = Brand<usize, "A">;
type B = Brand<usize, "B">;
type T = "i64" | "string" | A | B;
type P = { kind: "p"; c?: T };
function make(c: T): P { return { kind: "p", c }; }
function show(t: T): string { return typeof t === "string" ? t : `id ${t as usize}`; }
function main() {
  const r = make("i64");
  console.log(r.c !== undefined ? show(r.c) : "none");
  const s = make(7 as B);
  console.log(s.c !== undefined ? show(s.c) : "none");
}
