// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function main() {
  let o = new O(1)
  while (true) {
    try { take(o); break } finally { o = new O(2) }
  }
  print(o.n)
}
// expect: 2
