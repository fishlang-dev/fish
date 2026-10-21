// A change through two '!'s would change a copy too.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
type W = { c: C | null }
function main() {
  let w: W | null = { c: new C() }
  print(w!.c!.next())
  print(w?.c?.n)
}
// error: can't call 'next' through '!', which would change a copy
