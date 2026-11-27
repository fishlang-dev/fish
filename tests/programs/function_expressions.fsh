// Function expressions as values: the arrows they amount to, and a named one calling itself.
// case: function_expression_values
// expect: 7
// expect: 12
// expect: 2,4,6
// expect: hi
// Anonymous, capturing, passed as a callback, generic, and typed by the const holding it.
function apply(f: (x: i64) => i64, x: i64): i64 {
  return f(x);
}
function main() {
  const add = function (a: i64, b: i64): i64 { return a + b; };
  console.log(add(3, 4));
  const base = 10;
  console.log(apply(function (x) { return x + base; }, 2));
  console.log([1, 2, 3].map(function (x: i64): i64 { return x * 2; }).join(","));
  const id = function <T>(x: T): T { return x; };
  console.log(id("hi"));
}
// case: function_expression_changes_captured
// expect: 2
// A function expression borrows what it changes, as an arrow does.
function main() {
  let n = 0;
  const inc = function () { n++; };
  inc();
  inc();
  console.log(n);
}
// case: function_expression_async
// expect: 5
async function main() {
  const later = async function (x: i64): Promise<i64> { return x; };
  console.log(await later(5));
}
// case: function_expression_recursive
// expect: 120 55
// A named one calls itself under its name, or the const's.
function main() {
  const fact = function fact(n: i64): i64 { return n <= 1 ? 1 : n * fact(n - 1); };
  const fib = function go(n: i64): i64 { return n < 2 ? n : go(n - 1) + fib(n - 2); };
  console.log(fact(5), fib(10));
}
// case: function_expression_recursive_top_level
// expect: 120
const fact = function f(n: i64): i64 { return n <= 1 ? 1 : n * f(n - 1); };
function main() {
  console.log(fact(5));
}
// case: function_expression_named_unused
// expect: 3
function main() {
  const g = function named(x: i64): i64 { return x + 1; };
  console.log(g(2));
}
// case: function_expression_own_this
// error: a function expression has a 'this' of its own
class C {
  v: i64 = 1;
  m(): () => i64 {
    return function () { return this.v; };
  }
}
function main() {
  console.log(new C().m()());
}
// case: function_expression_generator
// error: generator function expressions are not supported yet
function main() {
  const g = function* () { yield 1; };
}
// case: function_expression_recursive_unheld
// error: named function expressions calling themselves anywhere but a const's value are not supported yet
function apply(f: (x: i64) => i64): i64 {
  return f(3);
}
function main() {
  console.log(apply(function fact(n: i64): i64 { return n <= 1 ? 1 : n * fact(n - 1); }));
}
