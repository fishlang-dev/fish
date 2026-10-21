// What a finally moves is gone where an error it passes on is caught.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function fail(): void throws i64 { throw 1 }
function main() {
  const o = new O(5)
  try {
    try {
      fail()
    } finally {
      take(o)
    }
  } catch (e) {
    print("catch uses", o.n)
  }
}
// error: 'o.n' can't be used here because 'o' was moved
