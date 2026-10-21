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
