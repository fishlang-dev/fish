// case: dispose_declared
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  console.log(r.name);
}
// expect: a
// expect: dispose a
// case: dispose_read_only_receiver
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose]() { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  console.log(r.name);
}
// expect: a
// expect: dispose a
// case: dispose_parameter
class Res {
  [Symbol.dispose](this: Mut<this>, force: boolean): void {}
}
function main() {}
// error: 2:37: error[E0710]: a '[Symbol.dispose]' method takes no parameters
// case: dispose_type_parameter
class Res {
  [Symbol.dispose]<T>(): void {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method takes no type parameters
// case: dispose_async
class Res {
  async [Symbol.dispose](): Promise<void> {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be async, since a drop doesn't wait
// case: dispose_generator
class Res {
  *[Symbol.dispose](): Generator<i64> { yield 1; }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be a generator
// case: dispose_throws
class Res {
  [Symbol.dispose](): void throws Error { throw new Error("no"); }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't throw, since a drop has nowhere to send an error; handle it inside
// case: dispose_static
class Res {
  static [Symbol.dispose](): void {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be static, since it disposes one instance
// case: dispose_own_receiver
class Res {
  [Symbol.dispose](this: Own<this>): void {}
}
function main() {}
// error: 2:20: error[E0710]: a '[Symbol.dispose]' method borrows the instance being dropped, so it can't take 'this: Own<this>'
// case: dispose_returns_a_value
class Res {
  [Symbol.dispose](): i64 { return 1; }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method returns nothing; write it as '[Symbol.dispose](this: Mut<this>): void { ... }'
// case: dispose_unwritten_return
class Res {
  [Symbol.dispose]() { return 1; }
}
function main() {}
// error: 2:31: error[E0101]: type 'i64' is not assignable to return type 'void'
// case: dispose_by_hand
class Res {
  [Symbol.dispose](): void {}
}
function main() {
  const r = new Res();
  r[Symbol.dispose]();
}
// error: 6:3: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand, which would dispose the value twice
// case: dispose_by_hand_on_this
class Res {
  [Symbol.dispose](): void {}
  close(this: Mut<this>): void { this[Symbol.dispose](); }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand
// case: dispose_by_hand_quoted
class Res {
  [Symbol.dispose](): void {}
}
function main() {
  const r = new Res();
  r["[Symbol.dispose]"]();
}
// error: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand
// case: dispose_quoted_name
class Res {
  "[Symbol.dispose]"(): void {}
}
function main() {}
// error: error[E0120]: '[Symbol.dispose]' as a quoted name would name a '[Symbol.dispose]' method, which is only written as '[Symbol.dispose]'
// case: dispose_object_literal
function main() {
  const o = { [Symbol.dispose]() {} };
}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
// case: dispose_interface_member
interface Closer {
  [Symbol.dispose](): void;
}
function main() {}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
// case: dispose_field
class Res {
  [Symbol.dispose]: i64 = 1;
}
function main() {}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
// case: dispose_not_printed
class Res {
  name: string;
  private n: i64 = 2;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  console.log(r);
  console.log(Object.keys(r));
  const copy = { ...r };
  console.log(copy);
}
// expect: Res { name: 'a', n: 2 }
// expect: [ 'name' ]
// expect: { name: 'a' }
// expect: dispose a
// case: dispose_scope_end
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const a = new Res("a");
  const b = new Res("b");
  {
    const inner = new Res("inner");
    console.log("in block");
  }
  console.log("body");
}
// expect: in block
// expect: dispose inner
// expect: body
// expect: dispose b
// expect: dispose a
// case: dispose_early_return
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function run(early: boolean): void {
  const a = new Res("a");
  if (early) {
    console.log("early");
    return;
  }
  const b = new Res("b");
  console.log("late");
}
function main() {
  run(true);
  run(false);
}
// expect: early
// expect: dispose a
// expect: late
// expect: dispose b
// expect: dispose a
// case: dispose_break
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  for (let i = 0; i < 3; i++) {
    const r = new Res(`r${i}`);
    if (i === 1) break;
    console.log(`end ${i}`);
  }
  console.log("after");
}
// expect: end 0
// expect: dispose r0
// expect: dispose r1
// expect: after
// case: dispose_reassigned
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  let r = new Res("first");
  r = new Res("second");
  console.log(r.name);
}
// expect: dispose first
// expect: second
// expect: dispose second
// case: dispose_temporary
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function make(name: string): Res { return new Res(name); }
function main() {
  new Res("unbound");
  console.log("between");
  make("unused");
  console.log(make("read").name);
  console.log("after");
}
// expect: dispose unbound
// expect: between
// expect: dispose unused
// expect: read
// expect: dispose read
// expect: after
// case: dispose_moved_into_function
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function consume(r: Res): void { console.log(`consume ${r.name}`); }
function main() {
  const r = new Res("a");
  consume(r);
  console.log("back");
}
// expect: consume a
// expect: dispose a
// expect: back
// case: dispose_moved_out_and_back
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function pass(r: Res): Res {
  console.log("pass");
  return r;
}
function main() {
  const a = new Res("a");
  const b = pass(a);
  const c = b;
  console.log(c.name);
}
// expect: pass
// expect: a
// expect: dispose a
// case: dispose_borrowed
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  rename(this: Mut<this>, name: string): void { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function show(r: Ref<Res>): void { console.log(`show ${r.name}`); }
function change(r: Mut<Res>): void { r.rename("changed"); }
function main() {
  let r = new Res("a");
  show(r);
  change(r);
  show(r);
}
// expect: show a
// expect: show changed
// expect: dispose changed
// case: dispose_array_elements
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  let xs = [new Res("x"), new Res("y")];
  xs.push(new Res("z"));
  const last = xs.pop()!;
  console.log(`${xs.length} ${last.name}`);
}
// expect: 2 z
// expect: dispose z
// expect: dispose x
// expect: dispose y
// case: dispose_map_values
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  let m = new Map<string, Res>();
  m.set("k", new Res("v"));
  m.set("k", new Res("w"));
  console.log(m.size);
  m.delete("k");
  console.log("deleted");
  m.set("j", new Res("u"));
}
// expect: dispose v
// expect: 1
// expect: dispose w
// expect: deleted
// expect: dispose u
// case: dispose_field_of_another
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
class Holder {
  res: Res;
  label: string;
  constructor(res: Res) {
    this.res = res;
    this.label = "holder";
  }
}
function main() {
  const h = new Holder(new Res("inner"));
  const o = { res: new Res("in object"), n: 1 };
  const maybe: Res | null = new Res("in option");
  console.log(`${h.label} ${o.n}`);
}
// expect: holder 1
// expect: dispose in option
// expect: dispose in object
// expect: dispose inner
// case: dispose_generic_class
class Box<T> {
  label: string;
  v: T;
  constructor(label: string, v: T) {
    this.label = label;
    this.v = v;
  }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose box of ${this.label}`); }
}
function main() {
  const a = new Box<i64>("i64", 1);
  const b = new Box<string[]>("strings", ["s"]);
  const c = new Box<Box<i64>>("boxes", new Box<i64>("inner", 2));
  console.log("body");
}
// expect: body
// expect: dispose box of boxes
// expect: dispose box of inner
// expect: dispose box of strings
// expect: dispose box of i64
// case: dispose_subclass_and_base
class Base {
  id: i64;
  constructor(id: i64) { this.id = id; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose base ${this.id}`); }
}
class Sub extends Base {
  name: string;
  constructor(name: string) {
    super(1);
    this.name = name;
  }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose sub ${this.name}`); }
}
class Plain extends Base {}
class Leaf extends Sub {
  constructor() { super("leaf"); }
}
function main() {
  const s = new Sub("s");
  const p = new Plain(2);
  const l = new Leaf();
  console.log("body");
}
// expect: body
// expect: dispose sub leaf
// expect: dispose base 1
// expect: dispose base 2
// expect: dispose sub s
// expect: dispose base 1
// case: dispose_subclass_of_plain_base
class Plain {
  id: i64 = 7;
}
class Sub extends Plain {
  name: string = "sub";
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name} ${this.id}`); }
}
function main() {
  const s = new Sub();
  console.log("body");
}
// expect: body
// expect: dispose sub 7
// case: dispose_abstract_base
abstract class Shape {
  abstract label(): string;
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.label()}`); }
}
class Circle extends Shape {
  label(): string { return "circle"; }
}
function main() {
  const c = new Circle();
  console.log("body");
}
// expect: body
// expect: dispose circle
// case: dispose_constructor_panics
class Res {
  name: string;
  share: i64;
  constructor(name: string, parts: i64) {
    this.name = name + "!";
    this.share = 10 / parts;
  }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const ok = new Res("ok", 2);
  console.log("made one");
  const bad = new Res("bad", 0);
  console.log(bad.share);
}
// expect: made one
// expect: dispose ok!
// panic: attempt to divide by zero
// case: dispose_constructor_throws
class Res {
  name: string;
  constructor(name: string) throws Error {
    if (name === "") throw new Error("no name");
    this.name = name;
  }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  try {
    const a = new Res("a");
    const b = new Res("");
    console.log(b.name);
  } catch (e) {
    console.log(`caught ${e.message}`);
  }
}
// expect: dispose a
// expect: caught no name
// case: dispose_panic_unwinds
class Res {
  name: string;
  constructor(name: string) { this.name = name + "!"; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function deep(n: i64): i64 {
  const here = new Res(`level ${n}`);
  const xs: i64[] = [];
  if (n === 0) return xs[3]!;
  return deep(n - 1);
}
function main() {
  const r = new Res("main");
  console.log(deep(1));
}
// expect: dispose level 0!
// expect: dispose level 1!
// expect: dispose main!
// panic: index out of bounds
// case: dispose_panics_inside
class Res {
  name: string;
  parts: i64 = 0;
  constructor(name: string) { this.name = name + "!"; }
  [Symbol.dispose](this: Mut<this>): void {
    console.log(`dispose ${this.name}`);
    console.log(10 / this.parts);
  }
}
function main() {
  const r = new Res("a");
  console.log("body");
}
// expect: body
// expect: dispose a!
// panic: attempt to divide by zero
// case: dispose_across_await
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
async function work(n: i64): Promise<i64> {
  const held = new Res(`work ${n}`);
  await sleep(1);
  return n + 1;
}
async function main() {
  const r = new Res("a");
  const n = await work(1);
  console.log(`got ${n} with ${r.name}`);
}
// expect: dispose work 1
// expect: got 2 with a
// expect: dispose a
// case: dispose_clone_refused
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  const copy = r.clone();
}
// error: error[E0213]: can't clone a 'Res': it has a '[Symbol.dispose]' method, which would then run for the copy too; declare 'clone(): Res' on the class to say what a copy is
// case: dispose_clone_of_holder_refused
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const xs = [new Res("a")];
  const copy = xs.clone();
}
// error: error[E0213]: can't clone a 'Res', or a value holding one: it has a '[Symbol.dispose]' method
// case: dispose_own_clone
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  clone(): Res { return new Res(`${this.name} again`); }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  const copy = r.clone();
  console.log(copy.name);
}
// expect: a again
// expect: dispose a again
// expect: dispose a
// case: dispose_field_moved_out
class Res {
  tags: string[];
  constructor(tag: string) { this.tags = [tag]; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.tags.length}`); }
}
function keep(tags: string[]): void {}
function main() {
  const r = new Res("a");
  keep(r.tags);
}
// error: 9:8: error[E0214]: 'r.tags' can't be moved out of 'r': 'Res' has a '[Symbol.dispose]' method, which runs on the whole value when it is dropped; use 'r.tags.clone()', or have a method of 'Res' give it
// case: dispose_field_cloned
class Res {
  tags: string[];
  constructor(tag: string) { this.tags = [tag]; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.tags.length}`); }
}
function keep(tags: string[]): void { console.log(tags); }
function main() {
  const r = new Res("a");
  keep(r.tags.clone());
}
// expect: [ 'a' ]
// expect: dispose 1
// case: dispose_into_dyn
interface Named { name: string; }
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const d: Dyn<Named> = new Res("a");
  console.log(d.name);
}
// error: error[E0801]: values with a '[Symbol.dispose]' method held in a Dyn are not supported yet
// case: dispose_in_comptime
class Res {
  n: i64;
  constructor(n: i64) { this.n = n; }
  [Symbol.dispose](this: Mut<this>): void {}
}
function size(): i64 {
  const r = new Res(3);
  return r.n;
}
const SIZE = comptime size();
function main() {
  console.log(SIZE);
}
// error: a class with a '[Symbol.dispose]' method can't be made while compiling yet
// case: dispose_from_json
@derive(Json)
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void {}
}
function main() {
  const r = JSON.parse<Res>("{}");
}
// error: error[E0509]: a class with a '[Symbol.dispose]' method can't be read from JSON
// case: dispose_narrowed_to_an_object
class Res {
  name: string;
  tags: string[];
  constructor(name: string) {
    this.name = name;
    this.tags = [name];
  }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
type Named = { name: string };
function made(): Named { return new Res("returned"); }
function main() {
  const fresh: Named = new Res("fresh");
  console.log(`kept ${fresh.name}`);
  const r = new Res("place");
  const from: Named = r;
  console.log(`kept ${from.name}`);
  const xs: Named[] = [new Res("element")];
  console.log(`kept ${xs[0]!.name} and ${made().name}`);
}
// expect: dispose fresh
// expect: kept fresh
// expect: kept place
// expect: dispose element
// expect: dispose returned
// expect: kept element and returned
// expect: dispose place
// case: dispose_many_owners
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function pick(flag: boolean): Res | null { return flag ? new Res("picked") : null; }
function* held(): Generator<i64> {
  const r = new Res("in generator");
  yield 1;
  yield 2;
}
function main() {
  const either = pick(true) ?? new Res("fallback");
  const none = pick(false) ?? new Res("fallback");
  let g = held();
  console.log(g.next());
  const s = shared(new Res("shared"));
  const pair = { either, none };
  console.log("body");
}
// expect: { done: false, value: 1 }
// expect: body
// expect: dispose picked
// expect: dispose fallback
// expect: dispose shared
// expect: dispose in generator
// case: dispose_destructured_out
class Res {
  tags: string[];
  constructor(tag: string) { this.tags = [tag]; }
  [Symbol.dispose](this: Mut<this>): void {}
}
function main() {
  const r = new Res("a");
  const { tags } = r;
}
// error: error[E0214]: 'r.tags' can't be moved out of 'r'
// case: dispose_map_get_copies
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void {}
}
function main() {
  const m = new Map<string, Res>();
  const got = m.get("k");
}
// error: error[E0213]: can't clone a 'Res': it has a '[Symbol.dispose]' method
// case: dispose_abstract_base_and_subclass
abstract class Shape {
  abstract label(): string;
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.label()}`); }
}
class Circle extends Shape {
  label(): string { return "circle"; }
  [Symbol.dispose](this: Mut<this>): void { console.log("dispose circle itself"); }
}
function main() {}
// error: error[E0704]: 'Circle' can't declare a '[Symbol.dispose]' method: the one 'Shape' declares reaches an abstract member
// case: dispose_owned_receiver
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
  finish(this: Own<this>): void { console.log(`finish ${this.name}`); }
}
function main() {
  const r = new Res("a");
  r.finish();
  new Res("temporary").finish();
  console.log("end");
}
// expect: finish a
// expect: dispose a
// expect: finish temporary
// expect: dispose temporary
// expect: end
// case: dispose_in_a_stored_closure
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function make(): () => void {
  const r = new Res("captured");
  return () => console.log(r.name);
}
function main() {
  make()();
}
// error: error[E0801]: closures holding a value with a '[Symbol.dispose]' method, when stored or passed on as function values, are not supported yet
// case: dispose_borrowed_by_a_closure
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("local");
  const show = () => console.log(`show ${r.name}`);
  show();
  show();
}
// expect: show local
// expect: show local
// expect: dispose local
