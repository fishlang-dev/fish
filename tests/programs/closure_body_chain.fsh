// An arrow whose body is a call through '?.' gives the call's value.
class C {
  n = 2
  peek(): i64 { return this.n }
}
function main() {
  const o: C | null = new C()
  const g = () => o?.peek()
  print(g())
}
// expect: 2
