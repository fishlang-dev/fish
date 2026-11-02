// case: optionalmethods_satisfy
// expect: a 1
// expect: b 2
// expect: a
// expect: b
interface Handler {
  name(): string;
  onClose?(): void;
  size?(by: i64): i64;
}
class A implements Handler {
  name(): string { return "a"; }
  onClose(): void { console.log("closed a"); }
  size(by: i64): i64 { return by; }
}
class B implements Handler {
  name(): string { return "b"; }
}
function show(h: Handler, n: i64): void { console.log(h.name(), n); }
function main(): void {
  show(new A(), 1);
  show(new B(), 2);
  const hs: Dyn<Handler>[] = [new A(), new B()];
  for (const h of hs) console.log(h.name());
}
// case: optionalmethods_object
// expect: 3
type Sized = { n: i64; grow?(by: i64): void };
function f(x: Sized): i64 { return x.n; }
function main(): void { console.log(f({ n: 3 })); }
// case: optionalmethods_wrong_signature
// error: types of method 'onClose' are incompatible
interface Handler { onClose?(): void }
class A { onClose(code: i64): void {} }
function f(h: Handler): void {}
function main(): void { f(new A()); }
// case: optionalmethods_field_for_method
// error: method 'grow' is missing in type '{ grow: i64 }' but required in type '{ grow?(): void }'
function f(x: { grow?(): void }): void {}
function main(): void { f({ grow: 1 }); }
// case: optionalmethods_optional_for_required
// error: method 'onClose' is optional in type 'Maybe' but required in type 'Must'
interface Maybe { onClose?(): void }
interface Must { onClose(): void }
function g(h: Must): void {}
function f(h: Maybe): void { g(h); }
function main(): void {}
// case: optionalmethods_intersection
// error: method 'onClose' is missing in type 'B' but required in type 'Maybe & Must'
interface Maybe { onClose?(): void }
interface Must { onClose(): void }
class B {}
function f(h: Maybe & Must): void {}
function main(): void { f(new B()); }
// case: optionalmethods_call
// expect: closed a
// expect: 5
// expect: null
// expect: hi a
// expect: null
interface Handler {
  onClose?(): void;
  size?(by: i64): i64;
  greet?(s: string): string;
}
class A implements Handler {
  onClose(): void { console.log("closed a"); }
  size(by: i64): i64 { return by + 3; }
  greet(s: string): string { return s + " a"; }
}
class B implements Handler {}
function noisy(): string { console.log("evaluated"); return "hi"; }
function close(h: Handler): void { h.onClose?.(); }
function size(h: Handler): i64 | null { return h.size?.(2); }
function greet(h: Handler): string | null { return h.greet?.("hi" + ""); }
function lazy(h: Handler): string | null { return h.greet?.(noisy()); }
function main(): void {
  close(new A());
  close(new B());
  console.log(size(new A()));
  console.log(size(new B()));
  console.log(greet(new A()));
  console.log(lazy(new B()));
}
// case: optionalmethods_dyn_call
// expect: closed a
// expect: 5
// expect: null
// expect: hi a
// expect: null
interface Handler {
  onClose?(): void;
  size?(by: i64): i64;
  greet?(s: string): string;
}
class A implements Handler {
  onClose(): void { console.log("closed a"); }
  size(by: i64): i64 { return by + 3; }
  greet(s: string): string { return s + " a"; }
}
class B implements Handler {}
function main(): void {
  const hs: Dyn<Handler>[] = [new A(), new B()];
  for (const h of hs) h.onClose?.();
  for (const h of hs) console.log(h.size?.(2));
  for (const h of hs) console.log(h.greet?.("hi" + ""));
  for (const h of hs) h.greet?.("dropped" + "");
}
// case: optionalmethods_required_call
// error: 'name' is always there in 'Handler', so it is called without '?.'
interface Handler { name(): string; onClose?(): void }
function f(h: Handler): void { h.name?.(); }
function main(): void {}
// case: optionalmethods_plain_call
// error: 'onClose' may be missing, since 'Handler' declares it optional; call it as 'h.onClose?.()'
interface Handler { onClose?(): void }
function f(h: Handler): void { h.onClose(); }
function main(): void {}
// case: optionalmethods_function_call
// error: optional calls are not supported yet
function main(): void { const f = (): void => {}; f?.(); }
// case: optionalmethods_mut_call
// expect: 3
// expect: 0
// expect: 3
type Counter = { n: i64; add?(this: Mut<this>, by: i64): void };
class C {
  n: i64 = 0;
  add(this: Mut<this>, by: i64): void { this.n += by; }
}
function bump(c: Mut<Counter>): void { c.add?.(1); c.add?.(2); }
function grow(x: Counter): i64 { return x.n; }
function main(): void {
  let c = new C();
  bump(c);
  console.log(c.n);
  let o = { n: 0 };
  bump(o);
  console.log(o.n);
  console.log(grow(c));
}
// case: optionalmethods_presence
// expect: closed a
// expect: no onClose
// expect: 5
// expect: 0
// expect: true false
// expect: hi a
// expect: none
// expect: false true
interface Handler {
  onClose?(): void;
  size?(by: i64): i64;
  greet?(s: string): string;
}
class A implements Handler {
  onClose(): void { console.log("closed a"); }
  size(by: i64): i64 { return by + 3; }
  greet(s: string): string { return s + " a"; }
}
class B implements Handler {}
function close(h: Handler): void {
  if (h.onClose !== undefined) h.onClose();
  else console.log("no onClose");
}
function size(h: Handler): i64 {
  if (h.size === undefined) return 0;
  return h.size(2);
}
function has(h: Handler): boolean { return typeof h.greet === "function"; }
function greet(h: Handler): string { return typeof h.greet !== "function" ? "none" : h.greet("hi" + ""); }
function lacks(h: Handler): boolean { return h.size === null || !(h.onClose !== null && h.greet !== undefined); }
function main(): void {
  close(new A());
  close(new B());
  console.log(size(new A()));
  console.log(size(new B()));
  console.log(has(new A()), has(new B()));
  console.log(greet(new A()));
  console.log(greet(new B()));
  console.log(lacks(new A()), lacks(new B()));
}
// case: optionalmethods_dyn_presence
// expect: closed a
// expect: no onClose
// expect: 5
// expect: 0
// expect: true false
interface Handler {
  onClose?(): void;
  size?(by: i64): i64;
}
class A implements Handler {
  onClose(): void { console.log("closed a"); }
  size(by: i64): i64 { return by + 3; }
}
class B implements Handler {}
function main(): void {
  const hs: Dyn<Handler>[] = [new A(), new B()];
  for (const h of hs) {
    if (h.onClose !== undefined) h.onClose();
    else console.log("no onClose");
  }
  for (const h of hs) console.log(h.size !== undefined && h.size(2) > 0 ? h.size(2) : 0);
  const a: Dyn<Handler> = new A();
  const b: Dyn<Handler> = new B();
  console.log(typeof a.size === "function", typeof b.size === "function");
}
// case: optionalmethods_this_field
// expect: closed
// expect: done
interface Handler { onClose?(): void }
class A { onClose(): void { console.log("closed"); } }
class Conn<H extends Handler> {
  constructor(public h: H) {}
  close(): void {
    if (this.h.onClose !== undefined) this.h.onClose();
    console.log("done");
  }
}
function main(): void {
  new Conn(new A()).close();
}
// case: optionalmethods_check_forgotten
// error: 'onClose' may be missing, since 'Handler' declares it optional
interface Handler { onClose?(): void }
function f(h: Handler, other: Handler): void {
  if (other.onClose !== undefined) h.onClose();
}
function main(): void {}
// case: optionalmethods_check_reassigned
// error: 'onClose' may be missing, since 'Handler' declares it optional
interface Handler { onClose?(): void }
class A { onClose(): void {} }
class B {}
function main(): void {
  let d: Dyn<Handler> = new A();
  if (d.onClose !== undefined) {
    d = new B();
    d.onClose();
  }
}
