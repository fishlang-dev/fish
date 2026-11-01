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
