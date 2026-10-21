// Reading through '!' and '??' doesn't change anything, so it is allowed.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n }; peek(): i64 { return this.n } }
type H = { c: C | null }
function look(c: Ref<C>): i64 { return c.n }
function main() {
  const o: C | null = new C()
  const d = new C()
  print(look(o!), (o ?? d).n, (o ?? d).peek(), o!.peek(), o!.n)
  const h: H = { c: new C() }
  print(look(h.c!), h.c!.peek())
  print(o?.n, d.n)
}
// expect: 0 0 0 0 0
// expect: 0 0
// expect: 0 0
