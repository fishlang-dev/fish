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
// case: generic_value_type_parameters
// expect: 1 a true 1 a true
// expect: 4
// expect: hi ann
// expect: 1 a true
type Id = <T>(x: T) => T;
function id<T>(x: T): T { return x; }
function both(f: <T>(x: T) => T): string {
  return `${f(1)} ${f("a")} ${f(true)}`;
}
function twice(f: Id, n: i64): i64 {
  return f(f(n));
}
interface Named { name: string }
function greet(f: <T extends Named>(x: T) => string): string {
  return f({ name: "ann" });
}
function main() {
  console.log(both(id), both(<T>(x: T): T => x));
  console.log(twice(id, 4));
  console.log(greet(<T extends Named>(x: T): string => "hi " + x.name));
  const o = { f: id };
  console.log(both(o.f));
}
// case: generic_value_type_not_generic
// error: it takes a generic function, one that works for every type, as '<T>(x: T) => T'
function both(f: <T>(x: T) => T): i64 {
  return f(1);
}
function main() {
  console.log(both((x: i64): i64 => x));
}
// case: generic_value_type_constraint
// error: type 'i64' does not satisfy the constraint 'Named' of 'T'
interface Named { name: string }
function greet(f: <T extends Named>(x: T) => string): string {
  return f(5);
}
function main() {}
// case: generic_value_type_uninferred
// error: can't infer a type for 'T' in this call of 'f'
function make(f: <T>() => T[]): i64 {
  const xs = f();
  return 0;
}
function main() {}
// case: generic_value_meets_function_type
// expect: [ 1, 2, 3 ] [ 'a' ]
// expect: 7 5 5
// expect: 5 3
// expect: z
function id<T>(x: T): T { return x; }
function apply(f: (x: i64) => i64): i64 { return f(5); }
function main() {
  const xs = [1, 2, 3];
  console.log(xs.map(id), ["a"].map(id));
  const f: (x: i64) => i64 = id;
  console.log(f(7), apply(<T>(x: T): T => x), apply(id));
  const g = id;
  console.log(apply(g), xs.filter(<T>(x: T): boolean => true).length);
  const s: { h: (x: string) => string } = { h: id };
  console.log(s.h("z"));
}
// case: generic_value_interface_methods
// expect: 5 n=4 true
interface Mapper<T> {
  map<U>(f: (x: T) => U): U;
}
class Box {
  v: i64;
  constructor(v: i64) { this.v = v; }
  map<U>(f: (x: i64) => U): U { return f(this.v); }
}
function use(m: Mapper<i64>): string {
  const n = m.map((x: i64): i64 => x + 1);
  const s = m.map((x: i64): string => "n=" + x);
  return `${n} ${s}`;
}
function bounded<M extends Mapper<i64>>(m: M): boolean {
  return m.map((x: i64): boolean => x > 3);
}
function main() {
  console.log(use(new Box(4)), bounded(new Box(5)));
}
// case: generic_value_interface_method_dyn
// error: 'map' is generic, a family of methods made one per call, and a Dyn's table holds one function per method, so it can't be called through a Dyn
interface Mapper {
  map<U>(f: (x: i64) => U): U;
}
class Box {
  v: i64 = 1;
  map<U>(f: (x: i64) => U): U { return f(this.v); }
}
function main() {
  const d: Dyn<Mapper> = new Box();
  console.log(d.map((x: i64): i64 => x));
}
// case: generic_value_interface_method_not_generic
// error: method 'map' must be generic with 1 type parameter, as 'Mapper' declares it
interface Mapper {
  map<U>(f: (x: i64) => U): U;
}
class Box {
  v: i64 = 1;
  map(f: (x: i64) => i64): i64 { return f(this.v); }
}
function use(m: Mapper): i64 { return 0; }
function main() {
  console.log(use(new Box()));
}
// case: generic_value_annotated_and_returned
// expect: 1 a
// expect: 2 b
function id<T>(x: T): T { return x; }
function make(): <T>(x: T) => T {
  return id;
}
function main() {
  const f: <T>(x: T) => T = id;
  console.log(f(1), f("a"));
  const g = make();
  console.log(g(2), g("b"));
}
// case: generic_value_field_refused
// error: a field can't hold a generic function type: that would box it in a Dyn, whose table holds one function
function id<T>(x: T): T { return x; }
class C {
  f: <T>(x: T) => T = id;
}
function main() {}
// case: generic_value_array_refused
// error: an array can't hold a generic function type
function main() {
  const xs: (<T>(x: T) => T)[] = [];
}
// case: generic_value_union_refused
// error: a union can't hold a generic function type
function main() {
  const u: (<T>(x: T) => T) | null = null;
}
// case: generic_value_annotated_not_generic
// error: it takes a generic function, one that works for every type
function main() {
  const f: <T>(x: T) => T = (x: i64): i64 => x;
}
// case: generic_value_declared_without_value
// error: 'w' needs its value where it is declared, since a generic function type describes the generic function it holds
function main() {
  let w: <T>(x: T) => T;
}
// case: generic_value_interface_borrow_mode
// error: types of method 'put' are incompatible
interface P {
  put<U>(x: Ref<U[]>): i64;
}
class K {
  put<U>(x: Mut<U[]>): i64 { x.pop(); return 1; }
}
function use(p: P): i64 { const xs = ["a", "b"]; const n = p.put(xs); console.log(xs); return n; }
function main() { console.log(use(new K())); }
// case: generic_value_interface_return_type
// error: types of method 'map' are incompatible
interface Mapper {
  map<U>(f: (x: i64) => U): U;
}
class Box {
  v: i64 = 1;
  map<U>(f: (x: i64) => U): string { f(this.v); return "str"; }
}
function use(m: Mapper): void {
  const n = m.map((x: i64): i64 => x);
  console.log(n);
}
function main() {
  use(new Box());
}
// case: generic_value_interface_bound
// error: its type parameters' bounds differ
interface Named { name: string }
interface Greeter {
  greet<U>(x: U): string;
}
class G {
  greet<U extends Named>(x: U): string { return "hi " + x.name; }
}
function use<M extends Greeter>(m: M): string {
  return m.greet(5);
}
function main() {
  console.log(use(new G()));
}
// case: generic_value_family_wrong_return
// error: it returns 'string', where '<T>(x: T) => T' returns 'T'
function k<T>(x: T): string { return "k"; }
function both(f: <T>(x: T) => T): string {
  return `${f(1) + 1}`;
}
function main() {
  console.log(both(k));
}
// case: generic_value_family_wrong_arity
// error: it takes 2 parameters, where '<T>(x: T) => T' takes 1
function two<T>(x: T, y: T): T { return y; }
function both(f: <T>(x: T) => T): i64 {
  return f(1);
}
function main() {
  console.log(both(two));
}
// case: generic_value_family_throws
// error: it can throw, which '<T>(x: T) => T' doesn't say
class Bad { message: string = "bad"; }
function boom<T>(x: T): T throws Bad { throw new Bad(); }
function both(f: <T>(x: T) => T): i64 {
  return f(1);
}
function main() {
  console.log(both(boom));
  console.log("after");
}
// case: generic_value_family_passed_on
// expect: 1
function id<T>(x: T): T { return x; }
function inner(f: <T>(x: T) => T): string { return `${f(1)}`; }
function outer(f: <T>(x: T) => T): string { return inner(f); }
function main() { console.log(outer(id)); }
// case: generic_value_through_getter
// error: calls of a generic function value read through a getter are not supported yet
function id<T>(x: T): T { return x; }
class C {
  get g() { console.log("getter ran"); return { f: id }; }
}
function main() {
  const c = new C();
  console.log(c.g.f(1));
}
// case: generic_value_family_returned
// expect: 1 q
function id<T>(x: T): T { return x; }
function pass(f: <T>(x: T) => T): <T>(x: T) => T { return f; }
function main() { const g = pass(id); console.log(g(1), g("q")); }
// case: generic_value_this_field
// expect: 1 a
function id<T>(x: T): T { return x; }
class C {
  o = { f: id };
  run(): string { return `${this.o.f(1)} ${this.o.f("a")}`; }
}
function main() { console.log(new C().run()); }
// case: generic_value_family_copies
// expect: in 2
function id<T>(x: T): T { return x; }
async function both(f: <T>(x: T) => T): Promise<string> {
  const h = spawn(async () => f("in"));
  await sleep(1);
  const a = await h;
  return `${a} ${f(2)}`;
}
async function main() {
  const v = await both(id);
  console.log(v);
}
