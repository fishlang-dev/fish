// case: extend_map
// expect: 2 -1 2 true 2
// expect: 3 true 3 false
// expect: one [ 1 ] 1
// expect: 5 2
// A class extending Map or Set embeds one: the methods it doesn't declare run on the embedded
// collection, an override replaces one, and 'super' reaches the collection's.
class Pending extends Map<string, i64> {
  count: i64
  constructor() {
    super()
    this.count = 0
  }
  override get(k: string): i64 | null {
    return super.get(k) ?? -1
  }
  bump(this: Mut<this>, k: string) {
    this.count++
    this.set(k, (super.get(k) ?? 0) + 1)
  }
}

class Tags extends Set<string> {
  constructor(xs: string[]) { super(xs) }
  override has(x: string): boolean { return super.has(x.toLowerCase()) }
}

class Cache<K> extends Map<K, string> {
  get total(): usize { return super.size }
}

class Counted extends Pending {
  constructor() { super() }
  override get(k: string): i64 | null { return 5 }
}

function main() {
  let p = new Pending()
  p.set("a", 1)
  p.bump("a")
  p.bump("b")
  console.log(p.get("a"), p.get("z"), p.size, p.has("b"), p.count)
  let t = new Tags(["x", "y"])
  t.add("z")
  t.delete("x")
  t.add("x")
  console.log(t.size, t.has("Y"), t.values().length, t.has("w"))
  let c = new Cache<i64>()
  c.set(1, "one")
  console.log(c.get(1), c.keys(), c.total)
  let d = new Counted()
  d.set("q", 1)
  console.log(d.get("q"), d.size + 1)
}
// case: extend_map_no_types
class P extends Map {}

function main() {}
// error: 'Map' takes its key and value types, like 'Map<string, i64>'
// case: extend_map_as_map
class P extends Map<string, i64> {}

function take(m: Map<string, i64>) {}

function main() {
  const p = new P()
  take(p)
}
// error: 'P' extends 'Map<string, i64>' by embedding one, so it can't be used as 'Map<string, i64>'
// case: extend_map_override_missing
class P extends Set<string> {
  override set(k: string) {}
}

function main() {}
// error: 'set' can't be marked 'override': 'Set' has no member 'set' for it to replace
// case: extend_map_read_only
class P extends Map<string, i64> {
  put(k: string) { this.set(k, 1) }
}

function main() {}
// error: cannot add to 'this' because 'this' is read-only here; declare 'this: Mut<this>'
// case: extend_map_constant
class P extends Map<string, i64> {}

function main() {
  const p = new P()
  p.set("a", 1)
}
// error: cannot add to 'p' because 'p' is a constant
// case: extend_map_no_super
class P extends Map<string, i64> {
  constructor() {
    console.log(1)
    super()
  }
}

function main() {}
// error: a derived class's constructor must start with 'super(...)'
// case: extend_map_iterate
// expect: a 1
// expect: b 2
// expect: [ [ 'a', 1 ], [ 'b', 2 ] ] 2
// expect: x y
// expect: [ 'x', 'y' ] 2
// expect: 3 2 1
// Looping over, spreading or collecting a class extending Map or Set goes through the embedded
// collection, unless the class gives its own iterator.
class Scores extends Map<string, i64> {
  constructor(entries: [string, i64][]) { super(entries) }
}

class Names extends Set<string> {}

class Countdown extends Set<i64> {
  *[Symbol.iterator](): Generator<i64> {
    yield 3
    yield 2
    yield 1
  }
}

function main() {
  const s = new Scores([["a", 1], ["b", 2]])
  for (const [k, v] of s) console.log(k, v)
  console.log([...s], Array.from(s).length)
  let n = new Names()
  n.add("x")
  n.add("y")
  let line = ""
  for (const x of n) line += x + " "
  console.log(line.trim())
  console.log([...n], Array.from(n, (x) => x.length).length)
  console.log([...new Countdown()].join(" "))
}
// case: extend_map_print
// expect: P(2) [Map] { 'a' => 1, 'b' => 2, n: 3 }
// expect: Q(1) [Set] { 'x' }
// expect: R(0) [Map] {}
// expect: P(0) [Map] { n: 3 }
// expect: {
// expect:   deep: { deeper: { p: [P [Map]], q: Q(0) [Set] {}, r: R(0) [Map] {} } }
// expect: }
// expect: S(1) [Map] { 'z' => 9, n: 3, m: 'x' }
// A class extending Map or Set prints as Node prints one: its name, the collection's size and
// entries, then its own fields.
class P extends Map<string, i64> {
  n: i64
  constructor(e: [string, i64][]) {
    super(e)
    this.n = 3
  }
}

class Q extends Set<string> {}

class R extends Map<i64, i64> {}

class S extends P {
  m: string = "x"
}

function main() {
  console.log(new P([["a", 1], ["b", 2]]))
  let q = new Q()
  q.add("x")
  console.log(q)
  console.log(new R())
  console.log(new P([]))
  console.log({ deep: { deeper: { p: new P([["a", 1]]), q: new Q(), r: new R() } } })
  console.log(new S([["z", 9]]))
}
// case: extend_map_own_members
// expect: P(1) [Map] { 'a' => 'x', n: '1' } P(2) [Map] { 'a' => 'x', 'b' => 'y', n: '1' }
// expect: { n: 1 } [ [ 'n', 1 ] ] 1 {}
// Only the collection's members are delegated: 'clone' copies the whole object, and the hidden
// collection stays out of spreads, rests and Object.entries.
class P extends Map<string, string> {
  n: string = "1"
}

class Q extends Map<string, i64> {
  n: i64 = 1
}

function main() {
  let p = new P()
  p.set("a", "x")
  let q = p.clone()
  q.set("b", "y")
  console.log(p, q)
  const r = new Q()
  const { n, ...rest } = r
  console.log({ ...r }, Object.entries(r), n, rest)
}
// case: extend_map_chain
// expect: 100
// expect: P(2) [Map] { 'a' => 1, 'b' => 2 }
// expect: 2 S(2) [Map] { 'a' => 1, 'b' => 2, tag: 's' }
// expect: Lower(2) [Set] { 'a', 'b', seen: 3 } 3
// 'set' and 'add' give back the object itself, as JavaScript's return 'this', and the constructor
// adds its entries through an overriding 'set' or 'add'.
class P extends Map<string, i64> {
  override get(_k: string): i64 | null { return 100 }
}

class S extends Map<string, i64> {
  tag: string = "s"
}

class Lower extends Set<string> {
  seen: i64 = 0
  constructor(xs: string[]) { super(xs) }
  override add(this: Mut<this>, x: string): Mut<this> {
    this.seen++
    super.add(x.toLowerCase())
    return this
  }
}

function main() {
  let p = new P()
  console.log(p.set("a", 1).get("a"))
  console.log(p.set("b", 2))
  let s = new S()
  console.log(s.set("a", 1).set("b", 2).size, s)
  let l = new Lower(["A", "b", "a"])
  console.log(l, l.seen)
}
// case: extend_map_derive_eq
@derive(Eq)
class P extends Map<string, i64> {}

function main() {}
// error: 'derive(Eq)' can't compare a class extending 'Map': a Map isn't compared by value
// case: extend_map_override_signature
class P extends Map<string, i64> {
  override get(k: i64): string { return "no" }
}

function main() {}
// error: 'get' overrides 'Map.get', so its parameter 'k' takes 'string' as that one does, not 'i64'
// case: extend_map_override_result
class P extends Map<string, i64> {
  override has(_k: string): i64 { return 1 }
}

function main() {}
// error: 'has' overrides 'Map.has', so it gives 'boolean' as that one does, not 'i64'
// case: extend_map_unknown
class P extends Map<string, i64> {}

function main() {
  let p = new P()
  p.foo()
}
// error: 'P' has no method 'foo'
// case: extend_map_loop_borrow
class P extends Map<string, i64> {}

function main() {
  let p = new P()
  for (const [k, _v] of p) p.set(k, 1)
}
// error: cannot change 'p' while a 'for...of' loop is reading 'p'
