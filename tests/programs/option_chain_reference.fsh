// An Option can't hold a reference yet.
class C {
  n: i64 = 1
  r(): Ref<i64> { return this.n }
}
function main() {
  let o: C | null = new C()
  const x = o?.r()
  o = null
  const y: i64 = x!
  print(y)
}
// error: Options holding references are not supported yet
