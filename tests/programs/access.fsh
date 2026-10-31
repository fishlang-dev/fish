// case: access
type HasValue = { value: i64 }

class Account {
  #pin: i64
  private balance = 0
  protected owner: i64

  constructor(pin: i64, private limit: i64, public value: i64) {
    this.#pin = pin
    this.owner = 7
  }

  deposit(this: Mut<this>, amount: i64, pin: i64) {
    if (pin !== this.#pin || this.over(amount)) return
    this.balance += amount
  }

  private over(amount: i64): boolean {
    return this.balance + amount > this.limit
  }

  report(): i64 {
    return this.balance * 1000 + this.owner
  }

  static make(): Account {
    let a = new Account(1234, 100, 5)
    a.balance = 1
    return a
  }
}

function read(v: HasValue): i64 {
  return v.value
}

function main() {
  let a = new Account(1234, 100, 5)
  a.deposit(50, 1234)
  a.deposit(60, 1234)
  a.deposit(10, 9999)
  print(a.report(), a.value)
  print(Account.make().report())
  // Only the public field counts toward the structural fit.
  print(read(a))
}
// expect: 50007 5
// expect: 1007
// expect: 5
// case: access_hash
class Account {
  #pin = 1
}

function main() {
  print(new Account().#pin)
}
// error: property '#pin' is not accessible outside class 'Account' because it has a private identifier
// case: access_hash_members
// expect: 26 10
// expect: Counter { x: 10 }
// expect: 1 2
// A '#name' is the class's own: it doesn't clash with a public 'x', and a subclass's '#n'
// and '#h' are separate from its base's.
class Counter {
  #count = 0
  x = 10
  #x = 20
  #helper(n: i64): i64 { return n * 2 }
  get #total(): i64 { return this.#count + this.#x }
  bump(this: Mut<this>) { this.#count = this.#helper(this.#count + 1) }
  get total(): i64 { return this.#total }
}

class A {
  #n = 1
  #h(): i64 { return this.#n }
  a(): i64 { return this.#h() }
}

class B extends A {
  #n = 2
  constructor() { super() }
  #h(): i64 { return this.#n }
  b(): i64 { return this.#h() }
}

function main() {
  let c = new Counter()
  c.bump()
  c.bump()
  print(c.total, c.x)
  print(c)
  const b = new B()
  print(b.a(), b.b())
}
// case: access_hash_shadowed
// expect: base 9
// expect: base 1
// expect: sub
// expect: base
// A base's '#tag' and '#m' stay the base's inside its code, even on a subclass value and in a
// method copied into each subclass, while the subclass's code reaches its own.
abstract class Base {
  #tag: string = "base"
  abstract n(): i64
  #m(): string { return "base" }
  both(): string { return `${this.#tag} ${this.n()}` }
  show(): string { return `${this.#m()} ${this.n()}` }
  peek(o: Ref<A>): string { return o.#tag }
}

class A extends Base {
  #tag: i64 = 1
  #m(): string { return "sub" }
  n(): i64 { return this.#tag }
  set(this: Mut<this>) { this.#tag = 9 }
  mine(): string { return this.#m() }
}

class Plain {
  #tag: string = "base"
  peek(o: Ref<Sub>): string { return o.#tag }
}

class Sub extends Plain {
  #tag: i64 = 3
}

function main() {
  let a = new A()
  a.set()
  print(a.both())
  const b = new A()
  print(b.show())
  print(b.mine())
  print(new Plain().peek(new Sub()))
}
// case: access_hash_method
class A {
  #m(): i64 { return 1 }
}

function main() {
  print(new A().#m())
}
// error: 6:9: error[E0709]: property '#m' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_accessor
class A {
  get #g(): i64 { return 1 }
}

function main() {
  print(new A().#g)
}
// error: 6:9: error[E0709]: property '#g' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_write
class A {
  #n = 1
}

function main() {
  let a = new A()
  a.#n = 2
}
// error: 7:3: error[E0709]: property '#n' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_subclass_field
class A {
  #n = 1
}

class B extends A {
  read(): i64 { return this.#n }
}

function main() {
  print(new B().read())
}
// error: 6:24: error[E0709]: property '#n' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_subclass_method
class A {
  #m(): i64 { return 1 }
}

class B extends A {
  read(): i64 { return this.#m() }
}

function main() {
  print(new B().read())
}
// error: 6:24: error[E0709]: property '#m' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_subclass_accessor
class A {
  get #g(): i64 { return 1 }
}

class B extends A {
  read(): i64 { return this.#g }
}

function main() {
  print(new B().read())
}
// error: 6:24: error[E0709]: property '#g' is not accessible outside class 'A' because it has a private identifier
// case: access_hash_in
class A {
  #n = 1
  has(o: Ref<A>): boolean { return #n in o }
}

function main() {
  print(new A().has(new A()))
}
// error: 3:36: error[E0802]: '#n in' can't be used: Fish has no run-time reflection, and a value's class is known while compiling
// case: access_hash_modifier
class Account {
  private #pin = 1
}

function main() {}
// error: an accessibility modifier can't be used with a private identifier
// case: access_private
class Account {
  private balance = 0
}

function main() {
  print(new Account().balance)
}
// error: property 'balance' is private and only accessible within class 'Account'
// case: access_private_method
class Account {
  private audit(): i64 {
    return 1
  }
}

function main() {
  print(new Account().audit())
}
// error: property 'audit' is private and only accessible within class 'Account'
// case: access_protected
class Account {
  protected owner = 1
}

function main() {
  let a = new Account()
  a.owner = 2
}
// error: property 'owner' is protected and only accessible within class 'Account' and its subclasses
// case: access_structural
class Account {
  constructor(private value: i64) {}
}

function read(v: { value: i64 }): i64 {
  return v.value
}

function main() {
  print(read(new Account(1)))
}
// error: argument of type 'Account' is not assignable to parameter of type '{ value: i64 }'
// case: access_hash_shadowed_read_only
class A {
  #x = 1
}

class B extends A {
  #x = 2
  f(): void { this.#x = 3 }
}

function main() {}
// error: 7:15: error[E0206]: cannot assign to 'this.#x' because 'this' is read-only here
