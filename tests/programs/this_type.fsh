// case: owned_chain
// expect: 3
// A method taking 'this: Own<this>' and returning 'this' hands the object back, so calls chain by moving it.
class Builder {
  n: i64 = 0;
  add(this: Own<this>, x: i64): this {
    this.n += x;
    return this;
  }
}

function main() {
  const b = new Builder().add(1).add(2);
  console.log(b.n);
}

// case: borrowed_chain
// expect: 3 ab
// A method taking 'this: Mut<this>' and returning 'Mut<this>' changes the object in place and lends it on.
class Counter {
  n: i64 = 0;
  log: string = "";
  add(this: Mut<this>, x: i64): Mut<this> {
    this.n += x;
    return this;
  }
  note(this: Mut<this>, s: string): Mut<this> {
    this.log = this.log + s;
    return this;
  }
}

function main() {
  let c = new Counter();
  c.add(1).note("a").add(2).note("b");
  console.log(c.n, c.log);
}

// case: read_only_this
// expect: 7
class Box {
  n: i64 = 7;
  self(): Ref<this> {
    return this;
  }
}

function main() {
  const b = new Box();
  console.log(b.self().self().n);
}

// case: subclass_chain
// expect: 3 x
// expect: 3 sab
// An inherited method returning 'this' gives the subclass, so its own methods chain after it.
class Base {
  n: i64 = 0;
  add(this: Own<this>, x: i64): this {
    this.n += x;
    return this;
  }
  bump(this: Mut<this>, x: i64): Mut<this> {
    this.n += x;
    return this;
  }
}

class Sub extends Base {
  s: string = "s";
  tag(this: Own<this>, t: string): this {
    this.s = t;
    return this;
  }
  mark(this: Mut<this>, t: string): Mut<this> {
    this.s = this.s + t;
    return this;
  }
}

function main() {
  const s = new Sub().add(1).tag("x").add(2);
  console.log(s.n, s.s);
  let m = new Sub();
  m.bump(1).mark("a").bump(2).mark("b");
  console.log(m.n, m.s);
}

// case: deeper_subclass
// expect: 5 u
// expect: 22 c
// Two levels down, and through 'super' in an override, 'this' stays the class the call is on.
class Base {
  n: i64 = 0;
  add(this: Own<this>, x: i64): this {
    this.n += x;
    return this;
  }
  bump(this: Mut<this>): Mut<this> {
    this.n += 1;
    return this;
  }
}

class Mid extends Base {
  s: string = "";
  tag(this: Own<this>, t: string): this {
    this.s = t;
    return this;
  }
  mark(this: Mut<this>, t: string): Mut<this> {
    this.s = this.s + t;
    return this;
  }
}

class Leaf extends Mid {
  bump(this: Mut<this>): Mut<this> {
    this.n += 10;
    return super.bump();
  }
}

function main() {
  const u = new Leaf().add(5).tag("u");
  console.log(u.n, u.s);
  let t = new Leaf();
  t.bump().mark("c").bump();
  console.log(t.n, t.s);
}

// case: generic_class
// expect: 2
// expect: a,b
// expect: 2 z
// In a generic class, 'this' is the instance the method runs on.
class List<T> {
  items: T[] = [];
  push(this: Mut<this>, x: T): Mut<this> {
    this.items.push(x);
    return this;
  }
  with(this: Own<this>, x: T): this {
    this.items.push(x);
    return this;
  }
}

class Named<T> extends List<T> {
  name: string = "";
  rename(this: Mut<this>, n: string): Mut<this> {
    this.name = n;
    return this;
  }
}

function main() {
  let l = new List<i64>();
  l.push(1).push(2);
  console.log(l.items.length);
  const w = new List<string>().with("a").with("b");
  console.log(w.items.join(","));
  let n = new Named<i64>();
  n.push(3).rename("z").push(4);
  console.log(n.items.length, n.name);
}

// case: abstract_base
// expect: html p ab
// expect: xy
// An abstract base's chaining methods give each concrete subclass back as itself.
abstract class Doc {
  parts: string[] = [];
  abstract name(): string;
  part(this: Mut<this>, p: string): Mut<this> {
    this.parts.push(p);
    return this;
  }
  with(this: Own<this>, p: string): this {
    this.parts.push(p);
    return this;
  }
}

class Html extends Doc {
  tag: string = "div";
  name(): string { return "html"; }
  wrap(this: Mut<this>, t: string): Mut<this> {
    this.tag = t;
    return this;
  }
}

function main() {
  let h = new Html();
  h.part("a").wrap("p").part("b");
  console.log(h.name(), h.tag, h.parts.join(""));
  const w = new Html().with("x").with("y");
  console.log(w.parts.join(""));
}

// case: type_set_shape
// expect: 2 true false
// The chaining shape of a Set wrapper keyed by ids, as the compiler's own type tables have it.
class IdSet {
  private table = new Set<i64>();

  get size(): usize {
    return this.table.size;
  }

  has(id: i64): boolean {
    return this.table.has(id);
  }

  add(this: Mut<this>, id: i64): Mut<this> {
    this.table.add(id);
    return this;
  }
}

function main() {
  let s = new IdSet();
  s.add(1).add(2).add(1);
  console.log(s.size, s.has(2), s.has(3));
}

// case: owned_from_borrowed
// error: 'this' can't be moved, since it is only borrowed here
// Returning the object itself needs it owned: a borrowed receiver lends 'Mut<this>' instead.
class B {
  n: i64 = 0;
  add(this: Mut<this>, x: i64): this {
    this.n += x;
    return this;
  }
}

function main() {
  let b = new B();
  b.add(1);
}

// case: mut_from_read_only
// error: cannot mutably borrow 'this' because 'this' is read-only here; declare 'this: Mut<this>'
class B {
  n: i64 = 0;
  add(x: i64): Mut<this> {
    return this;
  }
}

function main() {
  let b = new B();
  b.add(1);
}

// case: reference_from_owned
// error: this function returns a reference but borrows nothing it could point into
class B {
  n: i64 = 0;
  add(this: Own<this>): Mut<this> {
    return this;
  }
}

function main() {
  new B().add();
}

// case: other_object_inherited
// error: type 'B' is not assignable to return type 'S': 'S' inherits this method, and its 'this' return type is the receiver's own class, so return 'this'
// 'this' as a return type promises the receiver's own class, which another object of the base isn't.
class B {
  n: i64 = 0;
  add(this: Own<this>): this {
    return new B();
  }
}

class S extends B {
  s: string = "s";
}

function main() {
  console.log(new S().add().s);
}

// case: static_this
// error: 'this' as a type is supported only in a class's instance methods
class B {
  static make(): this {
    return new B();
  }
}

function main() {
  B.make();
}

// case: generic_base_plain_subclass
// expect: ab 3
// A subclass naming its generic base's type arguments inherits a chaining method written over them.
class A<T> {
  v: T[] = [];
  put(this: Mut<this>, x: T): Mut<this> {
    this.v.push(x);
    return this;
  }
}

class B extends A<string> {
  z: i64 = 3;
}

function main() {
  let b = new B();
  b.put("a").put("b");
  console.log(b.v.join(""), b.z);
}

// case: borrowed_chain_on_temporary
// error: 'r' would keep borrowing this temporary, which is gone once its statement ends
// A 'Mut<this>' chain lends the object it started on, so it can't outlive a temporary.
class A {
  n: i64 = 0;
  a(this: Mut<this>): Mut<this> {
    this.n += 1;
    return this;
  }
}

class B extends A {
  s: string = "hello";
}

function main() {
  const r = new B().a().a();
  console.log(r.n, r.s);
}
