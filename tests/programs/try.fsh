// case: try_annotation
// A catch parameter's type comes from the try.
function f(): i64 throws i64 { return 1 }
function main() {
  try {
    f()
  } catch (e: i64) {}
}
// error: a catch parameter takes no type annotation
// case: try_catch
// A catch gets what its try raised, typed as the union of it; a rethrow propagates, and tries nest.
function parse(n: i64): i64 throws i64 {
  if (n < 0) throw n
  return n * 2
}
function check(b: boolean): boolean throws boolean {
  if (b) throw false
  return true
}
function relay(n: i64): i64 throws i64 {
  try {
    return parse(n)
  } catch (e) {
    print("relay caught", e)
    throw e * 10
  }
}
function main() throws i64 {
  try {
    print(parse(4))
    print(check(true))
    print("not reached")
  } catch (e) {
    if (typeof e === "number") print("number", e)
    else print("boolean", e)
  }
  try {
    try {
      parse(-2)
    } catch (inner) {
      print("inner", inner)
      throw 99
    }
  } catch {
    print("outer caught")
  }
  try {
    if (parse(1) > 0) throw 5
  } catch (e) {
    print("thrown", e)
  }
  print(relay(-3))
}
// expect: 8
// expect: boolean false
// expect: inner -2
// expect: outer caught
// expect: thrown 5
// expect: relay caught -3
// fails: Error: -30
// case: try_finally
// A finally runs however its try or catch is left: normally, after a catch, on return, break and
// continue, nested, and when an error propagates out.
function parse(n: i64): i64 throws i64 {
  if (n < 0) throw n
  return n
}
function early(n: i64): i64 {
  try {
    if (n > 5) return 100
    print("no early return")
  } finally {
    print("finally after return check", n)
  }
  return n
}
function pass(n: i64): i64 throws i64 {
  try {
    return parse(n) + 1
  } finally {
    print("pass finally", n)
  }
}
function main() throws i64 {
  try {
    print(parse(1))
  } catch (e) {
    print("caught", e)
  } finally {
    print("finally normal")
  }
  try {
    parse(-1)
  } catch (e) {
    print("caught", e)
  } finally {
    print("finally after catch")
  }
  print(early(9), early(2))
  let i = 0
  while (i < 5) {
    try {
      if (i === 2) break
      if (i === 0) {
        i++
        continue
      }
    } finally {
      print("loop finally", i)
    }
    i++
  }
  print(pass(3))
  try {
    try {
      parse(-7)
    } finally {
      print("inner finally")
    }
  } catch (e) {
    print("outer caught", e)
  } finally {
    print("outer finally")
  }
  print(pass(-4))
}
// expect: 1
// expect: finally normal
// expect: caught -1
// expect: finally after catch
// expect: finally after return check 9
// expect: no early return
// expect: finally after return check 2
// expect: 100 2
// expect: loop finally 1
// expect: loop finally 1
// expect: loop finally 2
// expect: pass finally 3
// expect: 4
// expect: inner finally
// expect: outer caught -7
// expect: outer finally
// expect: pass finally -4
// fails: Error: -4
// case: try_finally_after
// The code after a finally carries on from its normal way out.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(c: boolean) {
  const o = new O(1)
  try {
    if (c) {
      take(o)
      return
    }
  } finally {
    print("done")
  }
  print(o.n)
}
function main() { f(false) }
// expect: done
// expect: 1
// case: try_finally_moved
// A value moved on a way out is gone in the finally.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(c: boolean) {
  const o = new O(1)
  try {
    if (c) {
      take(o)
      return
    }
  } finally {
    print(o.n)
  }
}
function main() {}
// error: 'o.n' can't be used here because 'o' was moved
// case: try_moved
// A value moved into a call that failed is gone in the catch.
class O { constructor(public n: i64) {} }
function take(o: O): i64 throws i64 {
  if (o.n < 0) throw 1
  return o.n
}
function main() {
  const o = new O(1)
  try {
    take(o)
  } catch (e) {
    print(o.n)
  }
}
// error: 'o.n' can't be used here because 'o' was moved
// case: try_nothing
// A try that can't throw has nothing to catch.
function main() {
  try {
    print(1)
  } catch (e) {
    print(2)
  }
}
// error: nothing in this 'try' can throw, so its 'catch' never runs
// case: try_unmoved
// What the try didn't move stays usable in and after the catch.
class O { constructor(public n: i64) {} }
function take(o: O): i64 throws i64 { return o.n }
function main() {
  const o = new O(1)
  try {
    print(take(new O(2)))
  } catch (e) {
    print(o.n, e)
  }
  print(o.n)
}
// expect: 2
// expect: 1
