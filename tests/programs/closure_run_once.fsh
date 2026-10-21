// A closure that moves out a capture runs once, so calling it takes it over.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function main() {
  const o = new O(5)
  const once = () => take(o)
  once()
  once()
}
// error: 'once' was moved, so it can't be used here
