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
