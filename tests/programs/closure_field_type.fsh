// A function type in a field holds a closure, boxed.
class H {
  f: () => i64
  constructor() { this.f = () => 1 }
}
function main() {
  const h = new H()
  print(h.f())
}
// expect: 1
