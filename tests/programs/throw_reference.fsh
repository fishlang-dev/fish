// A reference can't be thrown, even to a catch.
class P { constructor(public x: i64) {} }
class Box { constructor(public p: P) {} 
  get(this: Ref<this>): Ref<P> { return this.p } }
function take(b: Box) { print("took") }
function main() {
  const b = new Box(new P(1))
  try {
    throw b.get()
  } catch (e) {
    take(b)
    print(e.x)
  }
}
// error: errors holding references are not supported yet
