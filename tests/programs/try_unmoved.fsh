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
