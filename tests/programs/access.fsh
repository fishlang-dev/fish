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
