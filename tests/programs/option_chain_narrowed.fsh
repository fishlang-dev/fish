// A method called through '?.' on a narrowed variable changes the variable.
class C { n: i64 = 0; bump(this: Mut<this>) { this.n += 1 } }
class D { m: i64 = 0 }
function main() {
  let x: C | D | null = new C()
  if (x instanceof D) return
  x?.bump()
  x?.bump()
  print(x?.n)
}
// expect: 2
