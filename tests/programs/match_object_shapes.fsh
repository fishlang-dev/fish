class Base {
  name: string;
  constructor(name: string) { this.name = name; }
}
class Kid extends Base {
  age: i64;
  constructor(name: string, age: i64) { super(name); this.age = age; }
}
class Other {
  name: string;
  id: i64;
  constructor(name: string, id: i64) { this.name = name; this.id = id; }
}
type V = { tag: "n"; v: i64 } | { tag: "s"; v: string } | { tag: "b"; v: boolean };
function kid(k: Ref<Kid>): string {
  return match (k) {
    case { name: "bob", age } => "bob " + age,
    case { name, age: 3 } => name + " three",
    case { name } => name,
  };
}
function either(x: Ref<Kid | Other>): string {
  return match (x) {
    case { age, name } => "kid " + name + age,
    case { id } => "other " + id,
  };
}
function names(x: Kid | Other): string {
  return match (x) {
    case { name } => name,
  };
}
function vv(x: Ref<V>): string {
  return match (x) {
    case { v: 1 } => "one",
    case { v: "s" } => "ess",
    case { v: true } => "yes",
    case { tag: "s", v } => "s" + v,
    case _ => "other",
  };
}
function opts(xs: Ref<(string | null)[]>): string {
  return match (xs) {
    case [Some(a), null] => "a then none " + a,
    case [Some(a), Some(b)] => a + b,
    case _ => "?",
  };
}
function main() {
  const k = new Kid("bob", 7);
  const j = new Kid("jo", 3);
  console.log(kid(k), kid(j));
  const e1: Kid | Other = new Kid("al", 5);
  const e2: Kid | Other = new Other("ot", 9);
  console.log(either(e1), either(e2));
  console.log(names(e1), names(e2));
  const a: V = { tag: "n", v: 1 };
  const b: V = { tag: "s", v: "s" };
  const c: V = { tag: "s", v: "zz" };
  const d: V = { tag: "b", v: false };
  console.log(vv(a), vv(b), vv(c), vv(d));
  const xs: (string | null)[] = ["x", null];
  const ys: (string | null)[] = ["x", "y"];
  console.log(opts(xs), opts(ys));
}
// expect: bob 7 jo three
// expect: kid al5 other 9
// expect: al ot
// expect: one ess szz other
// expect: a then none x xy
