// A closure that moves out a capture takes it over when made.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function main() {
  const o = new O(5)
  const once = () => take(o)
  print(o.n)
}
// error: 'o.n' can't be used here because 'o' was moved
