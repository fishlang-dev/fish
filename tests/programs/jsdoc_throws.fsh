// case: jsdoc_throws_function
// A JSDoc @throws tag declares what a function throws, and callers propagate and catch it.
class NotFound {
  constructor(public key: string) {}
}
/**
 * Looks a key up.
 * @throws {NotFound} when the key is missing
 */
function lookup(key: string): i64 {
  if (key === "a") return 1
  throw new NotFound(key)
}
/** @throws {NotFound} */
export function twice(key: string): i64 {
  return lookup(key) * 2
}
function main() {
  try {
    print(twice("a"))
    print(twice("b"))
  } catch (e) {
    print("missing", e.key)
  }
}
// expect: 2
// expect: missing b
// case: jsdoc_throws_union
// Several tags declare the union of their types.
/**
 * @throws {string} on a bad name
 * @throws {i64} on a bad number
 */
function check(n: i64): i64 {
  if (n < 0) throw "negative"
  if (n > 9) throw n
  return n
}
function main() {
  for (const n of [1, -1, 10]) {
    try {
      print(check(n))
    } catch (e) {
      if (typeof e === "string") print("string", e)
      else print("number", e)
    }
  }
}
// expect: 1
// expect: string negative
// expect: number 10
// case: jsdoc_throws_members
// Methods, constructors, nested functions, async functions and arrows read the tag too.
class Account {
  balance: i64
  /** @throws {string} */
  constructor(balance: i64) {
    if (balance < 0) throw "negative balance"
    this.balance = balance
  }
  /** @throws {string} if there isn't enough */
  withdraw(this: Mut<this>, n: i64): i64 {
    if (n > this.balance) throw "not enough"
    this.balance -= n
    return this.balance
  }
}
/** @throws {string} */
async function later(n: i64): Promise<i64> {
  if (n === 0) throw "zero"
  return n
}
async function main() {
  /** @throws {string} */
  function inner(n: i64): i64 {
    if (n > 5) throw "too big"
    return n
  }
  /** @throws {string} */
  const half = (n: i64): i64 => {
    if (n % 2 === 1) throw "odd"
    return n / 2
  }
  try {
    let a = new Account(10)
    print(a.withdraw(4))
    print(inner(3))
    print(half(6))
    const l = await later(5)
    print(l)
    print(inner(7))
  } catch (e) {
    print("caught", e)
  }
  try {
    new Account(-1)
  } catch (e) {
    print("caught", e)
  }
  try {
    half(3)
  } catch (e) {
    print("caught", e)
  }
  try {
    await later(0)
  } catch (e) {
    print("caught", e)
  }
}
// expect: 6
// expect: 3
// expect: 3
// expect: 5
// expect: caught too big
// expect: caught negative balance
// expect: caught odd
// expect: caught zero
// case: jsdoc_throws_untyped
// A tag that only describes declares nothing, so throwing is still refused.
/** @throws if the number is negative */
function f(n: i64): i64 {
  if (n < 0) throw n
  return n
}
function main() { print(f(1)) }
// error: 'f' must declare 'throws i64' after its return type to throw here
// case: jsdoc_throws_none
// Without a tag or a clause, a throwing function is refused as before.
/** Checks a number. */
function f(n: i64): i64 {
  if (n < 0) throw n
  return n
}
function main() { print(f(1)) }
// error: 'f' must declare 'throws i64' after its return type to throw here
// case: jsdoc_throws_getter
// A getter can't throw yet, whichever way it says so.
class A {
  /** @throws {string} */
  get n(): i64 { return 1 }
}
function main() { print(new A().n) }
// error: jsdoc_throws_getter.fsh:3:16: error[E0801]: accessors that throw are not supported yet
// case: jsdoc_throws_agrees
// A written clause and a tag naming the same type agree.
/** @throws {i64} */
function f(n: i64): i64 throws i64 {
  if (n < 0) throw n
  return n
}
function main() throws i64 { print(f(1)) }
// expect: 1
// case: jsdoc_throws_conflict
// A tag and a written clause naming different types are refused.
/** @throws {string} */
function f(n: i64): i64 throws i64 {
  if (n < 0) throw n
  return n
}
function main() {}
// error: the JSDoc says '@throws {string}' but the function says 'throws i64'; make them the same type, or keep one
// case: jsdoc_throws_unknown
// A type the tag names resolves as a written clause's does, with the error inside the comment.
/** @throws {Missing} */
function f(): i64 { return 1 }
function main() { print(f()) }
// error: jsdoc_throws_unknown.fsh:2:14: error[E0105]: cannot find type 'Missing'
// case: jsdoc_throws_order_and_repeats
class A { message: string = "a"; }
class B { message: string = "b"; }
class C { message: string = "c"; }
/**
 * @throws {C} when c
 * @throws {A | B} otherwise
 * @throws {C} again
 */
function pick(n: i64): i64 throws A | B | C {
  if (n === 1) throw new A();
  if (n === 2) throw new C();
  return n;
}
function main(): void {
  try {
    console.log(pick(5));
    pick(2);
  } catch (e) {
    console.log(e.message);
  }
}
// expect: 5
// expect: c
// case: jsdoc_throws_still_conflicts
class A { message: string = "a"; }
class B { message: string = "b"; }
/** @throws {A | B} */
function pick(n: i64): i64 throws A {
  return n;
}
function main(): void {}
// error: the JSDoc says '@throws {A | B}' but the function says 'throws A'
