// case: throws_from
// An error the declared type doesn't take is wrapped by a class implementing From for it, when propagating and when thrown.
class DbError {
  constructor(public code: i64) {}
}
class ApiError implements From<DbError>, From<boolean> {
  constructor(public status: i64) {}
  static from(e: DbError | boolean): ApiError {
    if (typeof e === "boolean") return new ApiError(400)
    return new ApiError(500 + e.code)
  }
}
function query(n: i64): i64 throws DbError {
  if (n < 0) throw new DbError(7)
  return n
}
function handler(n: i64): i64 throws ApiError {
  return query(n) * 2
}
function strict(b: boolean): i64 throws ApiError {
  if (b) throw new DbError(1)
  throw true
}
function main() {
  try {
    print(handler(4))
    print(handler(-1))
  } catch (e) {
    print("api", e.status)
  }
  try {
    strict(true)
  } catch (e) {
    print("api", e.status)
  }
  try {
    strict(false)
  } catch (e) {
    print("api", e.status)
  }
}
// expect: 8
// expect: api 507
// expect: api 501
// expect: api 400
// case: throws_from_missing
// An error that neither fits nor wraps needs converting.
class ApiError { constructor(public status: i64) {} }
function q(): i64 throws boolean { return 1 }
function h(): i64 throws ApiError {
  return q()
}
function main() {}
// error: 'q' can throw 'boolean', which isn't the 'ApiError' that 'h' throws; convert it, or have 'ApiError' implement 'From<boolean>'
// case: throws_from_no_method
// A class implementing From needs a static from.
class DbError { constructor(public code: i64) {} }
class ApiError implements From<DbError> {
  constructor(public status: i64) {}
}
function q(): i64 throws DbError { return 1 }
function h(): i64 throws ApiError { return q() }
function main() {}
// error: class 'ApiError' implements 'From<DbError>', so it needs 'static from(e: DbError): ApiError'
// case: throws_interface
// A throwing method can't stand in for an interface's.
interface M { m(): i64 }
class A { m(): i64 throws i64 { throw 3 } }
function g<T extends M>(x: T): i64 { return x.m() }
function main() { print(g(new A())) }
// error: method 'm' can throw, and an interface's methods can't declare errors yet
// case: throws_literal
// A literal thrown takes the declared error type.
function g(): i64 throws u8 {
  throw 200
}
function main() throws u8 { print(g()) }
// fails: Error: 200
// case: throws_main_object
// An error that can't be printed shows its type.
class Bad { constructor(public code: i64) {} }
function main() throws Bad {
  throw new Bad(3)
}
// fails: Error: Bad
// case: throws_missing
// 'throw' needs a 'throws' clause.
function f() {
  throw 1
}
function main() {}
// error: 'f' must declare 'throws i64' after its return type to throw here
// case: throws_propagate
// A throwing function's error propagates through a function that declares it, and out of main, which prints it and exits 1.
function parse(n: i64): i64 throws i64 {
  if (n < 0) throw 7
  return n * 2
}
function twice(n: i64): i64 throws i64 {
  const a = parse(n)
  return a + parse(a)
}
class Store {
  limit = 10
  check(n: i64): boolean throws boolean {
    if (n > this.limit) throw false
    return true
  }
}
function main() throws i64 | boolean {
  print(twice(3))
  print(new Store().check(3))
  print(twice(-1))
  print("not reached")
}
// expect: 18
// expect: true
// fails: Error: 7
// case: throws_unhandled_call
// A call that can throw needs a 'throws' clause or a try/catch.
function g(): i64 throws i64 { return 1 }
function main() {
  print(g())
}
// error: 'main' must declare 'throws i64' after its return type since 'g' can throw 'i64'
// case: throws_wrong_type
// A thrown value must fit the declared error type.
function g(): i64 throws u8 {
  throw true
}
function main() {}
// error: this 'throw' throws 'boolean', which isn't the 'u8' that 'g' throws; convert it to 'u8'
