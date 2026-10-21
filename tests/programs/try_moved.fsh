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
