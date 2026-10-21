// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function g(c: boolean): void throws i64 {
  const o = new O(1)
  while (true) {
    try { if (c) { take(o); throw 1 } break } finally { print("fin") }
  }
  print(o.n)
}
function main() throws i64 { g(false) }
// expect: fin
// expect: 1
