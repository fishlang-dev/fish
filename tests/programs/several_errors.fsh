// Several errors per build: the checker recovers at function boundaries, so each independent
// error is reported, in source order, then a line counting them.
// case: errors_in_three_functions
// errors: 3
// error: errors_in_three_functions.fsh:8:10: error[E0101]: type '"x"' is not assignable to return type 'i64'
// error: errors_in_three_functions.fsh:11:21: error[E0101]: type 'i64' is not assignable to type 'string'
// error: errors_in_three_functions.fsh:17:15: error[E0201]: 'v.length' can't be used here because 'v' was moved
// error: errors_in_three_functions.fsh:16:13: note: 'v' moved here
// error: error: could not compile due to 3 previous errors
function a(): i64 {
  return "x";
}
function b(): void {
  const s: string = 1;
  console.log(s);
}
function c(): void {
  const v = [1];
  const w = v;
  console.log(v.length, w.length);
}
function main(): void {
  console.log(a());
  b();
  c();
}
// case: errors_bad_signature_once
// error: errors_bad_signature_once.fsh:2:15: error[E0105]: cannot find type 'Nope'
function f(x: Nope): i64 {
  return 1;
}
function g(): i64 {
  return f(1);
}
function h(): i64 {
  return f(2) + 1;
}
function main(): void {
  console.log(g() + h());
}
// case: errors_failed_body_once
// error: errors_failed_body_once.fsh:3:10: error[E0401]: cannot find name 'missing'
function f() {
  return missing;
}
function g(): i64 {
  return f() + 1;
}
function main(): void {
  console.log(g() + f());
}
// case: errors_in_methods
// errors: 2
// error: error[E0101]: type '"a"' is not assignable to return type 'i64'
// error: error[E0101]: type 'boolean' is not assignable to return type 'i64'
// error: error: could not compile due to 2 previous errors
class C {
  m(): i64 {
    return "a";
  }
  n(): i64 {
    return true;
  }
}
function main(): void {
  const c = new C();
  console.log(c.m() + c.n());
}
// case: errors_in_declarations
// errors: 2
// error: error[E0404]: a top-level 'let' would be a global that changes
// error: error[E0402]: 'twice' is already defined
// error: error: could not compile due to 2 previous errors
let counter = 0;
function twice(): void {}
function twice(): void {}
function main(): void {
  console.log(missing);
}
// case: errors_after_calling_failed_function
// A call of a function whose body failed is typed by its written signature, so the caller's own
// errors are reported too, whichever is declared first.
// errors: 2
// error: error[E0101]: type '"no"' is not assignable to return type 'i64'
// error: error[E0101]: type 'i64' is not assignable to type 'string'
function f1(): i64 {
  return "no";
}
function main(): void {
  console.log(f1());
  const s: string = 5;
  console.log(s);
}
// case: errors_calling_failed_function_declared_after
// errors: 2
// error: error[E0101]: type 'i64' is not assignable to type 'string'
// error: error[E0101]: type '"no"' is not assignable to return type 'i64'
function main(): void {
  console.log(f1());
  const s: string = 5;
  console.log(s);
}
function f1(): i64 {
  return "no";
}
// case: errors_move_after_calling_failed_function
// errors: 2
// error: errors_move_after_calling_failed_function.fsh:6:59: error[E0201]: 'b.v' can't be used here because 'b' was moved
// error: errors_move_after_calling_failed_function.fsh:10:15: error[E0201]: 'b.v' can't be used here because 'b' was moved
class Box { v: i64 = 0; constructor() {} }
function take(b: Box): i64 { return b.v; }
function f1(): i64 { const b = new Box(); take(b); return b.v; }
function main() {
  const b = new Box();
  take(b);
  console.log(b.v);
  console.log(f1());
}
// case: errors_refused_implements_once
// A class refused for missing a method of the interface it implements is reported there only,
// not again at each use as that interface.
// error: errors_refused_implements_once.fsh:5:21: error[E0702]: class 'Sq' incorrectly implements 'Shape': method 'area' is missing
interface Shape { area(): i64; }
class Sq implements Shape { constructor() {} aria(): i64 { return 1; } }
function f(s: Shape): i64 { return s.area(); }
function a(): i64 { return f(new Sq()); }
function b(): i64 { return f(new Sq()) + 1; }
function main() { console.log(a(), b()); }
// case: errors_refused_implements_boxed
// A class refused for the interface it implements, boxed as a Dyn of it, is reported at the class.
// error: errors_refused_implements_boxed.fsh:4:21: error[E0702]: class 'Sq' incorrectly implements 'Shape': method 'area' is missing
interface Shape { area(): i64; }
class Sq implements Shape { constructor() {} aria(): i64 { return 1; } }
function f(s: Dyn<Shape>): i64 { return s.area(); }
function main() { const d: Dyn<Shape> = new Sq(); console.log(f(d)); }
// case: errors_refused_implements_field_boxed
// error: errors_refused_implements_field_boxed.fsh:3:20: error[E0702]: class 'P' incorrectly implements 'Named': property 'name' is missing
interface Named { name: string; }
class P implements Named { nam: string = "a"; constructor() {} }
function f(n: Named): string { return n.name; }
function main() { const d: Dyn<Named> = new P(); console.log(d.name); console.log(f(new P())); }
// case: errors_try_around_failed_function
// A 'try' around a call of a function whose body failed isn't refused for throwing nothing: the
// function's throws aren't known.
// error: errors_try_around_failed_function.fsh:4:39: error[E0101]: type 'i64' is not assignable to type 'string'
function f(): i64 { const s: string = 5; if (s === "a") { throw new Error("x"); } return 1; }
function main(): void {
  try { console.log(f()); } catch (e) { console.log("caught"); }
}
// case: errors_try_around_failed_method
// error: errors_try_around_failed_method.fsh:2:40: error[E0101]: type 'i64' is not assignable to type 'string'
class C { m(): i64 { const s: string = 5; if (s === "a") { throw new Error("x"); } return 1; } }
function main(): void {
  const c = new C();
  try { console.log(c.m()); } catch (e) { console.log("caught"); }
}
// case: errors_try_around_own_recursive_call
// A recursive function's 'try' that can't throw is reported, though the function it calls is itself.
// error: errors_try_around_own_recursive_call.fsh:3:27: error[E0603]: nothing in this 'try' can throw
function f(n: i64): i64 { try { return f(n - 1); } catch (e) { return 0; } }
function main() { console.log(f(3)); }
// case: errors_try_around_mutually_recursive_calls
// errors: 2
// error: errors_try_around_mutually_recursive_calls.fsh:4:27: error[E0603]: nothing in this 'try' can throw
// error: errors_try_around_mutually_recursive_calls.fsh:5:27: error[E0603]: nothing in this 'try' can throw
function f(n: i64): i64 { try { return g(n - 1); } catch (e) { return 0; } }
function g(n: i64): i64 { try { if (n > 0) { return f(n); } return 1; } catch (e) { return 0; } }
function main() { console.log(f(3)); }
// case: errors_refused_implements_other_interface
// A class refused for one interface is still reported where it meets another it doesn't fit.
// errors: 2
// error: errors_refused_implements_other_interface.fsh:7:21: error[E0702]: class 'Sq' incorrectly implements 'Shape'
// error: errors_refused_implements_other_interface.fsh:8:41: error[E0101]: type 'Sq' is not assignable to type 'Dyn<Label>'
interface Shape { area(): i64; }
interface Label { area(): boolean; }
class Sq implements Shape { constructor() {} area(): string { return "1"; } }
function main() { const l: Dyn<Label> = new Sq(); console.log(l.area()); }
