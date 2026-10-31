// case: static_readonly
function square(n: i64): i64 {
  return n * n
}

class Config {
  static readonly port = 8080
  static readonly name: string = "fish"
  static readonly area = square(Config.side) + 1
  private static readonly side = 3
  static readonly primes: i64[] = [2, 3, 5]

  static describe(): string {
    return `${Config.name}:${Config.port}`
  }
}

function main() {
  print(Config.port, Config.name, Config.area)
  print(Config.describe())
  print(Config.primes.length, Config.primes[2])
}
// expect: 8080 fish 10
// expect: fish:8080
// expect: 3 5
// case: static_readonly_inherited
class Base {
  static readonly limit = 10
}

class Derived extends Base {}

function main() {
  print(Derived.limit)
}
// expect: 10
// case: static_readonly_comptime
class Sizes {
  static readonly kib = 1024
  static readonly mib = Sizes.kib * 1024
}

const total = Sizes.mib * 2

function main() {
  const next = comptime Sizes.mib + 1
  print(total, next)
}
// expect: 2097152 1048577
// case: static_accessors
const hits = new Atomic(0)

class Counter {
  static get hits(): i64 {
    return hits.load()
  }

  static set hits(n: i64) {
    hits.store(n)
  }

  static get doubled(): i64 {
    return Counter.hits * 2
  }
}

function main() {
  Counter.hits = 5
  print(Counter.hits, Counter.doubled)
  Counter.hits += 2
  Counter.hits++
  print(Counter.hits)
}
// expect: 5 10
// expect: 8
// case: static_mutable
class A {
  static n = 1
}

function main() {}
// error: a static field that isn't 'readonly' would be a global that changes; declare it 'static readonly n', whose value is computed while compiling, or hold an Atomic or a Lock in one
// case: static_no_value
class A {
  static readonly n: i64
}

function main() {}
// error: a 'static readonly' field needs its value where it is declared, as in 'static readonly n = ...'
// case: static_assign_readonly
class A {
  static readonly n = 1
}

function main() {
  A.n = 2
}
// error: cannot assign to 'n' because it is a read-only property
// case: static_getter_only
class A {
  static get n(): i64 {
    return 1
  }
}

function main() {
  A.n = 2
}
// error: cannot assign to 'n' because it is a read-only property
// case: static_setter_only
class A {
  static set n(v: i64) {}
}

function main() {
  print(A.n)
}
// error: property 'n' has a setter but no getter
// case: static_setter_value
class A {
  static get n(): i64 {
    return 1
  }

  static set n(v: i64) {}
}

function main() {
  const x = (A.n = 2)
}
// error: a static setter gives no value, so an assignment to it can only be a statement of its own
// case: static_private
class A {
  private static readonly secret = 1
}

function main() {
  print(A.secret)
}
// error: property 'secret' is private and only accessible within class 'A'
// case: static_duplicate
class A {
  static readonly n = 1

  static n(): i64 {
    return 2
  }
}

function main() {}
// error: duplicate property 'n'
// case: static_not_comptime
class A {
  static readonly n = Date.now()
}

function main() {
  print(A.n)
}
// error: 'now' can't run while compiling: comptime code only computes values
// case: static_protected
class Base {
  protected static readonly secret = 4
}

class Derived extends Base {
  static reveal(): i64 {
    return Base.secret * 2
  }
}

function main() {
  print(Derived.reveal())
}
// expect: 8
// case: static_private_subclass
class Base {
  private static readonly secret = 4
}

class Derived extends Base {
  static reveal(): i64 {
    return Base.secret
  }
}

function main() {
  print(Derived.reveal())
}
// error: property 'secret' is private and only accessible within class 'Base'
// case: static_accessor_shadows_field
class B {
  static readonly x = 1
}

class D extends B {
  static get x(): i64 {
    return 2
  }
}

function main() {
  print(B.x, D.x)
}
// expect: 1 2
// case: static_setter_hides_getter
class B {
  static get x(): i64 {
    return 1
  }
}

class D extends B {
  static set x(v: i64) {}
}

function main() {
  print(D.x)
}
// error: 'D' declares only a setter for 'x', which hides the getter of its base; declare a getter in 'D' too
// case: static_accessors_inherited
const stored = new Atomic(0)

class B {
  static get x(): i64 {
    return stored.load()
  }

  static set x(v: i64) {
    stored.store(v)
  }
}

class D extends B {}

function main() {
  D.x = 3
  D.x++
  print(B.x, D.x)
}
// expect: 4 4
// case: static_setter_generic
const stored = new Atomic(0)

class C {
  static get x(): i64 {
    return stored.load()
  }

  static set x(v: i64) {
    stored.store(v)
  }
}

function add<T>(item: T, n: i64): T {
  C.x += n
  return item
}

function main() {
  add("a", 2)
  add(true, 3)
  print(C.x)
}
// expect: 5
// case: static_cycle
class A {
  static readonly x: i64 = A.y + 1
  static readonly y: i64 = A.x + 1
}

function main() {
  print(A.x)
}
// error: 'A.x' needs its own value to compute its value: 'A.x' reads 'A.y', which reads 'A.x'
// case: static_reverse_order
class First {
  static readonly total = Second.base * 2
}

class Second {
  static readonly base = 21
}

function main() {
  print(First.total)
}
// expect: 42
// case: static_for_update
const count = new Atomic(0)

class Counter {
  static get n(): i64 {
    return count.load()
  }

  static set n(v: i64) {
    count.store(v)
  }
}

function main() {
  for (let i = 0; i < 3; Counter.n++) i++
  for (let i = 0; i < 1; Counter.n--) i++
  print(Counter.n)
}
// expect: 2
// case: static_accessor_method_clash
class A {
  static get n(): i64 {
    return 1
  }

  static n(): i64 {
    return 2
  }
}

function main() {}
// error: duplicate property 'n'
// case: static_private_accessor
class B {
  private static get g(): i64 {
    return 1
  }
}

function main() {
  print(B.g)
}
// error: property 'g' is private and only accessible within class 'B'
// case: static_field_called
class C {
  static readonly x = 5
}

function main() {
  print(C.x())
}
// error: 'x' is a static field of 'C', not a method; read it as 'C.x'
