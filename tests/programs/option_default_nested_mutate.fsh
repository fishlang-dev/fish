// So would one through nested '??'s.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function main() {
  let o: C | null = null
  let p: C | null = new C()
  print(((o ?? p) ?? new C()).next())
  print(p?.n)
}
// error: can't call 'next' through '??', which would change a copy
