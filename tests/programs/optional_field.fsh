// A class's optional field is empty until assigned.
class C {
  n = 1
  tag?: boolean
}
function main() {
  const c = new C()
  print(c.n, c.tag)
}
// expect: 1 null
