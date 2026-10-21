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
