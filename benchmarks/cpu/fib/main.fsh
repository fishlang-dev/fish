// Calls and integer arithmetic.
function fib(n: i64): i64 {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

function main() {
  console.log(fib(40));
}
