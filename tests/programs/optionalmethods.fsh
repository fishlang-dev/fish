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
