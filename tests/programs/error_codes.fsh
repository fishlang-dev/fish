// Error codes: each error renders its code after 'error', and its note's line has none.
// case: code_syntax
// error: code_syntax.fsh:3:18: error[E0001]: expected an expression, found ')'
function main() {
  console.log(1 +);
}
// case: code_mismatch
// error: error[E0101]: type '"five"' is not assignable to type 'i64'
function main() {
  const n: i64 = "five";
  console.log(n);
}
// case: code_moved
// error: code_moved.fsh:6:15: error[E0201]: 'a.length' can't be used here because 'a' was moved
// error: code_moved.fsh:5:13: note: 'a' moved here
function main() {
  const a = [1, 2, 3];
  const b = a;
  console.log(a.length, b.length);
}
// case: code_lazy_promise
// error: error[E0302]: this Promise does nothing until it's awaited
async function work() {
  console.log("working");
}
async function main() {
  work();
}
// case: code_unknown_name
// error: error[E0401]: cannot find name 'totl'; did you mean 'total'?
function main() {
  const total = 1;
  console.log(totl);
}
// case: code_unsupported
// error: error[E0801]: namespaces are not supported yet
namespace Util {
  export const two = 2;
}
function main() {}
// case: code_left_out
// error: error[E0802]: 'var' is not supported; use 'let' or 'const'
function main() {
  var n = 1;
  console.log(n);
}
