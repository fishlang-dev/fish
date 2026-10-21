// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(): i64 {
  let o = new O(1)
  try {
    try { take(o); return 1 } finally { o = new O(2) }
  } finally { print(o.n) }
}
function main() { print(f()) }
// expect: 2
// expect: 1
