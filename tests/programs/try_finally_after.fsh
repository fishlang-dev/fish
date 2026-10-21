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
