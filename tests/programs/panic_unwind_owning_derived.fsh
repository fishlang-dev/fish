function nil(): string { const o: string | null = null; return o! }
class B {
  s: string
  constructor(s: string) { this.s = s }
  eat(this: Own<this>, f: boolean): string { const t = this.s + "!"; if (f) nil(); return t }
  get g(): string { return this.s + nil() }
}
class D extends B {
  extra: string
  constructor(s: string, e: string) { super(s); this.extra = e }
}
function main() {
  const d = new D("x" + 1, "y" + 2)
  const e = new D("x" + 3, "y" + 4)
  print(e.eat(false))
  print(d.eat(true))
}
// expect: x3!
// panic: called `Option::unwrap()` on a `None` value
