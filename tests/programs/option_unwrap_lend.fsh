// Lending mutably through '!' would lend a copy.
class C { n: i64 = 0 }
function set(c: Mut<C>) { c.n = 9 }
function main() {
  let o: C | null = new C()
  set(o!)
  print(o?.n)
}
// error: can't lend this mutably through '!', which would lend a copy
