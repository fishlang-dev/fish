// A temporary unwrapped with '!' may be changed.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function make(): C | null { return new C() }
function plain(): C { return new C() }
function main() {
  print(plain().next())
  print(make()?.next())
  print(make()!.next())
}
// expect: 1
// expect: 1
// expect: 1
