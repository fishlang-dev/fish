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
