// A method that changes `this` can pass a mutable reference on to another one, repeatedly.
class Counter { n = 0 }
class W {
  total = 0
  add(this: Mut<this>, c: Mut<Counter>) {
    c.n = c.n + 1
    this.total = this.total + c.n
  }
  run(this: Mut<this>, c: Mut<Counter>) {
    this.add(c)
    this.add(c)
    c.n = c.n + 10
  }
}
function main() {
  let w = new W()
  let c = new Counter()
  w.add(c)
  w.add(c)
  c.n = c.n + 10
  w.run(c)
  print(w.total, c.n)
}
// expect: 30 24
