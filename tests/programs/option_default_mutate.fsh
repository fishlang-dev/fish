// A mutating call through '??' would change a copy.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function main() {
  let o: C | null = new C()
  print((o ?? new C()).next())
  print((o ?? new C()).next())
  print(o?.n)
}
// error: can't call 'next' through '??', which would change a copy
