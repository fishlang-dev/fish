// case: generic_extends_shapes
class Store {
  count = 0
  constructor(public label: string) {}

  bump(this: Mut<this>) {
    this.count++
  }

  describe(): string {
    return `${this.label}:${this.count}`
  }
}

class Cache<V> extends Store {
  items: V[] = []

  constructor(label: string, first: V) {
    super(label)
    this.items.push(first)
  }

  add(this: Mut<this>, v: V) {
    this.items.push(v)
    super.bump()
  }

  describe(): string {
    return `${super.describe()} (${this.items.length})`
  }
}

class List<T> {
  constructor(public items: T[]) {}

  first(): T {
    return this.items[0].clone()
  }

  size(): usize {
    return this.items.length
  }
}

class Sorted<T> extends List<T> {
  last(): T {
    return this.items[this.items.length - 1].clone()
  }
}

class Pair<A, B> {
  constructor(public a: A, public b: B) {}
}

class Keyed<K> extends Pair<K, string[]> {
  constructor(k: K) {
    super(k, ["x"])
  }
}

class Named extends List<string> {
  name(): string {
    return this.first()
  }
}

function main() {
  let c = new Cache<string>("words", "a")
  c.add("b")
  console.log(c.describe(), c.count, c.items.length)
  const s = new Sorted([3, 1, 2])
  console.log(s.first(), s.last(), s.size())
  const t = new Sorted<string>(["x", "y"])
  console.log(t.first(), t.last())
  const n = new Named(["ann", "bob"])
  console.log(n.name(), n.size())
  const k = new Keyed(7)
  console.log(k.a, k.b.length)
}
// expect: words:1 (2) 1 2
// expect: 3 2 3
// expect: x y
// expect: ann 2
// expect: 7 1
// case: generic_extends_dispatch
interface Sized {
  size(): usize
}

class List<T> {
  constructor(public items: T[]) {}

  size(): usize {
    return this.items.length
  }

  label(): string {
    return "list"
  }
}

class Stack<T> extends List<T> {
  push(this: Mut<this>, x: T) {
    this.items.push(x)
  }

  label(): string {
    return `stack of ${super.label()}`
  }
}

class Words extends List<string> {}

function total(xs: Dyn<Sized>[]): usize {
  let n: usize = 0
  for (const x of xs) n += x.size()
  return n
}

function sizeOf(s: Ref<Sized>): usize {
  return s.size()
}

function kind(v: Ref<Stack<i64> | Words>): string {
  if (v instanceof Stack) return `stack ${v.size()}`
  return `words ${v.items.join(",")}`
}

function main() {
  let s = new Stack<i64>([1])
  s.push(2)
  console.log(s.label(), s.size(), sizeOf(s))
  const w = new Words(["a", "b", "c"])
  console.log(kind(s), kind(w))
  const all: Dyn<Sized>[] = [new Stack(["x"]), new Words(["y", "z"])]
  console.log(total(all))
}
// expect: stack of list 2 2
// expect: stack 2 words a,b,c
// expect: 3
// case: generic_extends_explicit_constructor
class Wrap<T> {
  constructor(public x: T) {}
}

class Pair<T> extends Wrap<T> {
  constructor(x: T, public y: T) {
    super(x)
  }

  both(): T[] {
    return [this.x.clone(), this.y.clone()]
  }
}

function main() {
  const p = new Pair("a", "b")
  console.log(p.both().join("+"), p)
}
// expect: a+b Pair { x: 'a', y: 'b' }
// case: generic_extends_rest
class Bag<T> {
  items: T[]

  constructor(...xs: T[]) {
    this.items = xs
  }
}

class Tagged<T> extends Bag<T> {}

function main() {
  const t = new Tagged("a", "b", "c")
  const u = new Tagged<i64>(1, 2)
  console.log(t.items.join(""), u.items.length)
}
// expect: abc 2
// case: generic_extends_self
class A<T> extends A<T> {}

function main() {}
// error: class 'A<T>' embeds itself through 'extends'
// case: generic_extends_missing_args
class L<T> {
  constructor(public x: T) {}
}

class A<T> extends L {}

function main() {}
// error: type 'L' expects 1 type argument, but got 0
// case: generic_extends_override_reached
class L<T> {
  constructor(public x: T) {}

  show(): string {
    return this.name()
  }

  name(): string {
    return "l"
  }
}

class A<T> extends L<T> {
  name(): string {
    return "a"
  }
}

function main() {}
// error: overriding 'name' is an error here: 'L<T>' reaches it through 'this'
// case: generic_statics
class Box<T> {
  private constructor(public value: T) {}

  static of<T>(x: T): Box<T> {
    return new Box(x)
  }

  static zero(): i64 {
    return Box.helper() - 1
  }

  private static helper(): i64 {
    return 1
  }
}

class List<T> {
  constructor(public items: T[]) {}

  static empty<T>(): List<T> {
    return new List<T>([])
  }
}

class Sorted<T> extends List<T> {}

function main() {
  const b = Box.of(5)
  const s = Box.of("hi")
  console.log(b.value, s.value, Box.zero())
  const e = List.empty<string>()
  console.log(e.items.length, Sorted.empty<i64>().items.length)
}
// expect: 5 hi 0
// expect: 0 0
// case: generic_static_private
class Box<T> {
  constructor(public value: T) {}

  twice(): i64 {
    return Box.helper() * 2
  }

  private static helper(): i64 {
    return 21
  }
}

function main() {
  console.log(new Box(1).twice(), new Box("s").twice())
}
// expect: 42 42
// case: generic_static_class_param
class Box<T> {
  constructor(public value: T) {}

  static make(x: T): Box<T> {
    return new Box(x)
  }
}

function main() {}
// error: a static method can't use the class's type parameter 'T'; give the method its own, as in 'static make<T>(...)'
