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
