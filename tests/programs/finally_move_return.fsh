// Or in a finally a return passes through next.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function f(): i64 {
  const o = new O(5)
  try {
    try {
      return 1
    } finally {
      take(o)
    }
  } finally {
    print("outer finally", o.n)
  }
}
function main() { print(f()) }
// error: 'o.n' can't be used here because 'o' was moved
