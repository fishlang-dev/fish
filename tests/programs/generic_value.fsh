// case: generic_value_forms
// expect: 1 a o
// expect: 2 b
// expect: [ 1, 'x' ] [ true, 2 ]
// expect: 2 1
function id<T>(x: T): T {
  return x;
}
function count<T>(xs: T[]): i64 {
  return xs.length as i64;
}
function main() {
  const o = { id: <T>(x: T): T => x, name: "o" };
  console.log(o.id(1), o.id("a"), o.name);
  const g = id;
  console.log(g(2), g("b"));
  const pair = <A, B>(a: A, b: B): [A, B] => [a, b];
  const p = pair;
  console.log(p(1, "x"), pair(true, 2));
  const h = { f: count };
  console.log(h.f([5, 6]), h.f(["s"]));
}
// case: generic_value_returned
// expect: 3 c
function make() {
  return <T>(x: T): T => x;
}
function main() {
  const f = make();
  console.log(f(3), f("c"));
}
// case: generic_value_throws
// expect: caught bad
class Bad {
  message: string;
  constructor(m: string) { this.message = m; }
}
function check<T>(x: T, ok: boolean): T throws Bad {
  if (!ok) throw new Bad("bad");
  return x;
}
function main() {
  const c = check;
  try {
    console.log(c(1, true), c("s", false));
  } catch (e) {
    console.log("caught", e.message);
  }
}
// case: generic_value_captures
// error: this arrow is generic, so it is made apart from the function around it and can't use 'k' from there
function main() {
  const k = 2;
  const o = { f: <T>(x: T): i64 => k };
}
// case: generic_value_this
// error: this arrow is generic, so it is made anew for each call and can't use 'this'
class C {
  n: i64 = 1;
  make(): i64 {
    const o = { f: <T>(x: T): i64 => this.n };
    return 0;
  }
}
function main() {}
// case: generic_value_call_expression
// error: calls of a generic function value that isn't a name or a field are not supported yet
function make() {
  return <T>(x: T): T => x;
}
function main() {
  console.log(make()(1));
}
